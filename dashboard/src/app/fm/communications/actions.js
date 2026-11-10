"use server";
import { query, run, transaction } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";
import { logAudit } from "../../../lib/audit.js";
import { pingChannel, sendPing, sendDiscord } from "../../../lib/pings.js";
import { writableFactionIds } from "../../../lib/access.js";
import { str, toInt, oneOf, fail } from "../../../../../shared/validate.js";

/*
 * Leadership → faction Discord messaging (policy 6).
 *   - Sending needs L2+. A team lead may message only the factions led by
 *     someone on their team (lib/access.js); L3 may message every faction.
 *     Lead Storytellers and Event Team cannot send (or see this area).
 *   - Every send — delivered, partly delivered or failed — is mirrored to the
 *     FM log route (comms.announcement.fm / comms.ic.fm) listing delivered and
 *     failed factions separately, so leadership always sees what went out.
 *   - A send that attempts nothing (no channel configured for the chosen type)
 *     is rejected up front and never logged as a send.
 */

const CHANNEL_TYPES = ['command', 'faction', 'both'];
const FANOUT_CONCURRENCY = 5;
const MAX_MESSAGE = 4000;      // Discord embed description limit is 4096
const MAX_LINK = 2000;
const MAX_IMAGE_BASE64 = 16 * 1024 * 1024;
const EMBED_COLOR = 0xa07ef5;

const TARGET_COLUMNS = `f.id AS faction_id, f.name, f.tier,
       bsc.id AS config_id, bsc.guild_id, bsc.guild_name,
       bsc.comms_channel_id, bsc.comms_channel_name,
       bsc.faction_channel_id, bsc.faction_channel_name`;

// Returns the faction announcement targets the current user may message.
// Each row: { faction_id, name, tier, config_id, guild_id, guild_name,
//             comms_channel_id, comms_channel_name, faction_channel_id, faction_channel_name }
// Reads nothing the actor can't write to: the same team scoping as every
// other faction write (lib/access.js). Archived factions are never listed.
export async function getAnnouncementTargets() {
  const actor = await requireActor(2);
  return targetsFor(actor);
}

function targetsFor(actor) {
  const rows = query(`
    SELECT ${TARGET_COLUMNS}
    FROM factions f
    JOIN bot_server_configs bsc ON bsc.faction_id = f.id
    WHERE f.archived = 0
    ORDER BY f.tier DESC, f.name ASC
  `);
  const ids = writableFactionIds(actor);
  return ids === null ? rows : rows.filter(r => ids.has(r.faction_id));
}

// Resolve the destination channels for a faction target given the chosen channel type.
// Returns [{ type, id }] for whichever exist.
function resolveChannels(t, channelType) {
  const wantCommand = channelType === 'command' || channelType === 'both';
  const wantFaction = channelType === 'faction' || channelType === 'both';
  const chans = [];
  if (wantCommand && t.comms_channel_id)   chans.push({ type: 'Command', id: t.comms_channel_id });
  if (wantFaction && t.faction_channel_id) chans.push({ type: 'Faction-wide', id: t.faction_channel_id });
  return chans;
}
function channelTypeLabel(channelType) {
  return channelType === 'faction' ? 'Faction-wide' : channelType === 'both' ? 'Command + Faction-wide' : 'Command';
}

// Turn a failed Discord API response into a human string like "HTTP 403: Missing Access".
async function discordError(res) {
  let msg = '';
  try { const j = await res.json(); msg = j?.message || ''; } catch { /* body already consumed / non-JSON */ }
  return `HTTP ${res.status}${msg ? `: ${msg}` : ''}`;
}

// One embed to one channel with the bot token. Never throws; a 429 is retried
// once after Discord's retry_after (capped at 5 s). Returns { ok, error }.
async function postEmbed(channelId, embed, botToken, { content, allowedMentions } = {}) {
  const body = { embeds: [embed], allowed_mentions: allowedMentions || { parse: [] } };
  if (content) body.content = content;
  const attempt = async () => fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  try {
    let res = await attempt();
    if (res.status === 429) {
      let wait = 1000;
      try { const j = await res.clone().json(); wait = Math.min(5000, Math.max(250, Number(j?.retry_after || 1) * 1000)); } catch { /* use default */ }
      await new Promise(r => setTimeout(r, wait));
      res = await attempt();
    }
    if (res.ok) return { ok: true, error: '' };
    return { ok: false, error: await discordError(res) };
  } catch (e) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

// Validate and normalise the recipient list against what the actor may message.
// Returns { targets } or { error }. Unknown, archived or out-of-team config ids
// are an error — never silently dropped (a dropped id would read as "sent").
function resolveTargets(actor, configIds) {
  if (!Array.isArray(configIds)) return { error: 'Recipients must be a list.' };
  const ids = [...new Set(configIds.map(id => toInt(id, { min: 1 })))];
  if (ids.some(id => id == null)) return { error: 'Invalid recipient id.' };
  const allowed = new Map(targetsFor(actor).map(t => [t.config_id, t]));
  const unknown = ids.filter(id => !allowed.has(id));
  if (unknown.length) return { error: `${unknown.length} selected recipient${unknown.length === 1 ? ' is' : 's are'} not a faction you can message (archived, unknown or outside your team).` };
  return { targets: ids.map(id => allowed.get(id)) };
}

// Fan the embed out to every (faction, channel) pair: parallel, capped at
// FANOUT_CONCURRENCY in flight. Returns the per-delivery results plus the set
// of faction ids reached at least once. Targets with no channel of the chosen
// type are reported as failed deliveries so History shows why nothing arrived.
async function fanOut(targets, channelType, embed, botToken) {
  const label = channelTypeLabel(channelType);
  const results = [];
  const jobs = [];
  for (const t of targets) {
    const chans = resolveChannels(t, channelType);
    if (!chans.length) {
      const err = `No ${label} channel configured`;
      results.push({ name: t.name, faction_id: t.faction_id, faction_name: t.name, channel_type: label, ok: false, error: err, reason: err });
      continue;
    }
    for (const c of chans) jobs.push({ t, c });
  }
  const delivered = new Set();
  for (let i = 0; i < jobs.length; i += FANOUT_CONCURRENCY) {
    const batch = jobs.slice(i, i + FANOUT_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(({ c }) => postEmbed(c.id, embed, botToken)));
    settled.forEach((s, k) => {
      const { t, c } = batch[k];
      const r = s.status === 'fulfilled' ? s.value : { ok: false, error: s.reason?.message || 'Send failed' };
      if (!r.ok) console.error(`[COMMS] ${t.name} ${c.type}: ${r.error}`);
      results.push({ name: `${t.name} (${c.type})`, faction_id: t.faction_id, faction_name: t.name, channel_type: c.type, ok: r.ok, error: r.error, reason: r.error });
      if (r.ok) delivered.add(t.faction_id);
    });
  }
  return { results, delivered, attempted: jobs.length };
}

// Delivered / Failed fields for the FM mirror embed.
function deliveryFields(results) {
  const cut = (arr) => { const s = arr.join('\n'); return s.length > 1000 ? s.slice(0, 990) + '\n…' : s; };
  const ok = results.filter(r => r.ok).map(r => `✓ ${r.name}`);
  const bad = results.filter(r => !r.ok).map(r => `✗ ${r.name} — ${r.error || 'failed'}`);
  return [
    { name: `Delivered (${ok.length})`, value: ok.length ? cut(ok) : '—', inline: false },
    { name: `Failed (${bad.length})`, value: bad.length ? cut(bad) : '—', inline: false },
  ];
}

// Persist one send event + its per-delivery outcomes so the Communications
// History panel can replay who was reached and what failed. Best-effort: a
// logging failure must never break an otherwise-successful send.
function recordSend({ kind, actor, channelType, message, link = '', postedToFM = false, results }) {
  try {
    return transaction(() => {
      const sent = results.filter(r => r.ok).length;
      const info = run(
        `INSERT INTO announcement_log
           (kind, author_id, author_name, channel_type, message, link, posted_to_fm, sent_count, total_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [kind, actor.id, actor.name, channelType, message || '', link || '', postedToFM ? 1 : 0, sent, results.length]
      );
      const logId = Number(info.lastInsertRowid);
      for (const r of results) {
        run(
          `INSERT INTO announcement_deliveries (log_id, faction_id, faction_name, channel_type, ok, error)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [logId, r.faction_id ?? null, r.faction_name || r.name || '', r.channel_type || '', r.ok ? 1 : 0, r.error || '']
        );
      }
      return logId;
    });
  } catch (e) {
    console.error('[ANNOUNCE] history log failed:', e.message);
    return null;
  }
}

// Recent send events with their per-faction deliveries. Pass kind ('announcement'
// or 'ic') to scope to one area — Announcements and IC are tracked separately.
// L3 sees everything; team leads see only their own sends.
export async function getAnnouncementHistory(kind = null, limit = 50) {
  const actor = await requireActor(2);
  const k = oneOf(kind, ['announcement', 'ic'], null);
  const lim = toInt(limit, { min: 1, max: 200, def: 50 });
  const conds = [];
  const params = [];
  if (k) { conds.push('kind = ?'); params.push(k); }
  if (actor.level < 3) { conds.push('author_id = ?'); params.push(actor.id); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const logs = query(
    `SELECT * FROM announcement_log ${where} ORDER BY id DESC LIMIT ?`,
    [...params, lim]
  );
  if (!logs.length) return [];
  const ph = logs.map(() => '?').join(',');
  const dels = query(
    `SELECT * FROM announcement_deliveries WHERE log_id IN (${ph}) ORDER BY faction_name ASC, channel_type ASC`,
    logs.map(l => l.id)
  );
  const byLog = new Map();
  for (const d of dels) {
    if (!byLog.has(d.log_id)) byLog.set(d.log_id, []);
    byLog.get(d.log_id).push(d);
  }
  return logs.map(l => ({ ...l, deliveries: byLog.get(l.id) || [] }));
}

// The IC memos one faction has received, newest first (the per-faction IC
// thread on the History view). Read from faction_ic_messages, which every
// successful IC send writes. Team leads see their own team's factions only.
export async function getFactionICThread(factionId, limit = 50) {
  const actor = await requireActor(2);
  const fid = toInt(factionId, { min: 1 });
  if (fid == null) return [];
  const ids = writableFactionIds(actor);
  if (ids !== null && !ids.has(fid)) return [];
  const lim = toInt(limit, { min: 1, max: 200, def: 50 });
  return query(
    "SELECT * FROM faction_ic_messages WHERE faction_id = ? ORDER BY id DESC LIMIT ?",
    [fid, lim]
  );
}

export async function sendAnnouncement(configIds, message, postToFM = false, channelType = 'command') {
  const actor = await requireActor(2);
  const text = str(message, { max: MAX_MESSAGE });
  if (!text) return fail('Message cannot be empty.');
  const ct = oneOf(channelType, CHANNEL_TYPES, 'command');
  const wantFM = !!postToFM;
  if (wantFM && actor.level < 3) return fail('Only leadership (L3) can post announcements to the FM Discord.');
  if (!Array.isArray(configIds) && configIds != null) return fail('Recipients must be a list.');
  const requested = Array.isArray(configIds) ? configIds : [];
  if (!requested.length && !wantFM) return fail('No recipients selected.');

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return fail('Bot token not configured.');

  const resolved = resolveTargets(actor, requested);
  if (resolved.error) return fail(resolved.error);
  const targets = resolved.targets;
  const label = channelTypeLabel(ct);

  const embed = {
    title: 'A Message from Faction Management',
    description: text,
    color: EMBED_COLOR,
    footer: { text: `Sent by ${actor.name}` },
    timestamp: new Date().toISOString(),
  };

  // Faction channels (command and/or faction-wide per channelType), in parallel.
  const { results, delivered, attempted } = await fanOut(targets, ct, embed, botToken);
  if (!attempted && !wantFM) {
    // Nothing could be attempted: no selected faction has a channel of this type.
    // Not a send — nothing is logged.
    const names = results.map(r => r.faction_name).join(', ');
    return fail(`None of the selected factions has a ${label} channel configured (${names}). Fix it under Admin › Faction Channels or pick another channel type.`, { failed: results });
  }

  // Store once per faction (not per channel) so the portal Messages tab isn't duplicated.
  for (const t of targets) {
    if (!delivered.has(t.faction_id)) continue;
    run(
      "INSERT INTO faction_public_messages (faction_id, faction_name, author_name, author_id, message, is_pinned) VALUES (?, ?, ?, ?, ?, 0)",
      [t.faction_id, t.name, actor.name, actor.id, text]
    );
  }

  // FM mirror (policy 6): every send is copied to the FM announcement route
  // with a delivery report. When leadership ticked "Also post in FM Discord"
  // the copy carries the route's role mention (a real announcement TO FM);
  // otherwise it is a quiet log entry.
  const sent = results.filter(r => r.ok).length;
  const fmChannel = pingChannel('comms.announcement.fm');
  let postedToFM = false;
  let fmError = '';
  let mirrored = false;
  if (fmChannel) {
    const mirror = {
      ...embed,
      title: wantFM && !targets.length ? 'A Message from Faction Management'
        : sent === results.length ? 'Announcement sent to factions'
        : sent > 0 ? 'Announcement partly delivered'
        : 'Announcement FAILED — nothing delivered',
      fields: [
        ...(results.length ? deliveryFields(results) : []),
        { name: 'Channel', value: label, inline: true },
      ],
    };
    if (wantFM) {
      postedToFM = await sendPing('comms.announcement.fm', '', { embeds: [mirror] });
      mirrored = postedToFM;
      if (!postedToFM) fmError = 'FM Discord post failed';
    } else {
      mirrored = await sendDiscord(fmChannel, null, [mirror], null, { allowedMentions: { parse: [] } });
    }
  } else if (wantFM) {
    fmError = 'FM announcement route is muted or has no channel';
  }

  // An announcement sent to no faction that still posts to the FM Discord is an
  // announcement TO Faction Management — record it as the delivery so History
  // shows it as such instead of an empty "0/0 sent".
  if (wantFM && !results.length) {
    results.push({ name: 'Faction Management', faction_id: null, faction_name: 'Faction Management',
      channel_type: 'FM Discord', ok: postedToFM, error: fmError, reason: fmError });
  }

  const sentTotal = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  const ok = sentTotal > 0;
  const logId = recordSend({ kind: 'announcement', actor, channelType: ct, message: text, postedToFM, results });
  logAudit(actor.id, actor.name, 'CREATE', 'announcement', logId,
    `${ok ? 'Sent' : 'FAILED'} ${sentTotal}/${results.length} ${label} channels${postedToFM ? ' + FM Discord' : ''}`, text.substring(0, 100));

  const base = { sent: sentTotal, failed, total: results.length, postedToFM, fmOnly: wantFM && !targets.length, mirrored, channelType: ct, channelLabel: label, logId };
  if (!ok) return { ok: false, error: failed.length === 1 && failed[0].channel_type === 'FM Discord' ? fmError || 'FM Discord post failed' : `Nothing was delivered (${failed.length} failed).`, ...base };
  return { ok: true, ...base };
}

export async function uploadToImgbb(base64Data, filename) {
  await requireActor(2);
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) return fail('IMGBB_API_KEY is not configured on the server.');
  const data = typeof base64Data === 'string' ? base64Data.trim() : '';
  if (!data) return fail('No image data.');
  if (data.length > MAX_IMAGE_BASE64) return fail('Image is too large (16 MB max).');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) return fail('Image data is not valid base64.');

  const form = new URLSearchParams();
  form.append('key', apiKey);
  form.append('image', data);
  const name = str(filename, { max: 120 });
  if (name) form.append('name', name.replace(/\.[^.]+$/, ''));

  try {
    const res  = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
    const json = await res.json();
    if (!json.success) return fail(json.error?.message || 'imgbb upload failed.');
    return { ok: true, url: json.data.url };
  } catch (e) {
    return fail(e.message);
  }
}

export async function sendICCommunication(configIds, link, message, channelType = 'command') {
  const actor = await requireActor(2);
  const url = str(link, { max: MAX_LINK });
  if (!url) return fail('An image link is required.');
  if (!/^https:\/\/\S+$/i.test(url)) return fail('The image link must be an https:// URL.');
  const text = str(message, { max: MAX_MESSAGE });
  const ct = oneOf(channelType, CHANNEL_TYPES, 'command');
  if (!Array.isArray(configIds) || !configIds.length) return fail('No recipients selected.');

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return fail('Bot token not configured.');

  const resolved = resolveTargets(actor, configIds);
  if (resolved.error) return fail(resolved.error);
  const targets = resolved.targets;
  const label = channelTypeLabel(ct);

  // Embed for faction channels — title, optional message, image all in one box
  const icEmbed = {
    title: 'A Message from Meridian',
    color: EMBED_COLOR,
    image: { url },
    footer: { text: `Sent by ${actor.name}` },
    timestamp: new Date().toISOString(),
  };
  if (text) icEmbed.description = text;

  const { results, delivered, attempted } = await fanOut(targets, ct, icEmbed, botToken);
  if (!attempted) {
    const names = results.map(r => r.faction_name).join(', ');
    return fail(`None of the selected factions has a ${label} channel configured (${names}). Fix it under Admin › Faction Channels or pick another channel type.`, { failed: results });
  }

  // One row per faction reached — the per-faction IC thread (History › IC thread).
  for (const t of targets) {
    if (!delivered.has(t.faction_id)) continue;
    run(
      "INSERT INTO faction_ic_messages (faction_id, faction_name, author_name, author_id, link, message) VALUES (?, ?, ?, ?, ?, ?)",
      [t.faction_id, t.name, actor.name, actor.id, url, text]
    );
  }

  // FM IC log (policy 6): always filed, success or not, with the real outcome.
  const sent = results.filter(r => r.ok).length;
  const mirrored = await sendPing('comms.ic.fm', '', {
    embeds: [{
      title: sent === results.length ? 'IC Communication Sent' : sent > 0 ? 'IC Communication partly delivered' : 'IC Communication FAILED — nothing delivered',
      description: text || undefined,
      color: EMBED_COLOR,
      image: { url },
      fields: [...deliveryFields(results), { name: 'Channel', value: label, inline: true }],
      footer: { text: `Sent by ${actor.name}` },
      timestamp: new Date().toISOString(),
    }],
    allowedMentions: { parse: [] },
  });

  const failed = results.filter(r => !r.ok);
  const ok = sent > 0;
  const logId = recordSend({ kind: 'ic', actor, channelType: ct, message: text, link: url, results });
  logAudit(actor.id, actor.name, 'CREATE', 'ic_communication', logId,
    `IC ${ok ? 'sent' : 'FAILED'} ${sent}/${results.length} ${label} channels`, url.substring(0, 100));

  const base = { sent, failed, total: results.length, mirrored, channelType: ct, channelLabel: label, logId };
  if (!ok) return { ok: false, error: `Nothing was delivered (${failed.length} failed).`, ...base };
  return { ok: true, ...base };
}
