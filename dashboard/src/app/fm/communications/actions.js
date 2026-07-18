"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";
import { logAudit } from "../../../lib/audit.js";

const FM_ANNOUNCE_CHANNEL = '1503178123993157633';
const FM_IC_CHANNEL       = '1460432301878935725';
const FM_GUILD_ID         = '1457188814916423855';

// Returns all faction announcement targets accessible to the current user.
// Each row: { faction_id, name, tier, config_id, guild_name, comms_channel_id, comms_channel_name, faction_channel_id, faction_channel_name }
export async function getAnnouncementTargets() {
  const actor = await requireActor(1, {allowLeadStoryteller: true});

  // L3 and Lead Storytellers work with every faction → all factions, not team-scoped.
  if (actor.level >= 3 || actor.isLeadStoryteller) {
    return query(`
      SELECT f.id as faction_id, f.name, f.tier,
             bsc.id as config_id, bsc.guild_id, bsc.guild_name,
             bsc.comms_channel_id, bsc.comms_channel_name,
             bsc.faction_channel_id, bsc.faction_channel_name
      FROM factions f
      JOIN bot_server_configs bsc ON bsc.faction_id = f.id
      WHERE f.archived = 0
      ORDER BY f.tier DESC, f.name ASC
    `);
  }

  // Guides/leads: team's factions only
  const staff = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [actor.id]);
  if (!staff?.team_id) return [];
  const teamIds = query("SELECT discord_id FROM staff WHERE team_id = ?", [staff.team_id]).map(r => r.discord_id);
  if (!teamIds.length) return [];
  const p = teamIds.map(() => '?').join(',');
  return query(`
    SELECT f.id as faction_id, f.name, f.tier,
           bsc.id as config_id, bsc.guild_id, bsc.guild_name,
           bsc.comms_channel_id, bsc.comms_channel_name
    FROM factions f
    JOIN bot_server_configs bsc ON bsc.faction_id = f.id
    WHERE f.archived = 0 AND f.lead_discord_id IN (${p})
    ORDER BY f.tier DESC, f.name ASC
  `, teamIds);
}

const FM_ALL_ROLE = '1457229857749729363'; // fm_team_guide — all FM staff

// Resolve the destination channels for a faction target given the chosen channel type.
// channelType: 'command' | 'faction' | 'both'. Returns [{ type, id }] for whichever exist.
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

// Persist one send event + its per-delivery outcomes so the Communications
// History panel can replay who was reached and what failed. Best-effort: a
// logging failure must never break an otherwise-successful send.
function recordSend({ kind, actor, channelType, message, link = '', postedToFM = false, results }) {
  try {
    const sent = results.filter(r => r.ok).length;
    const info = run(
      `INSERT INTO announcement_log
         (kind, author_id, author_name, channel_type, message, link, posted_to_fm, sent_count, total_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [kind, actor.id, actor.name, channelType, message || '', link || '', postedToFM ? 1 : 0, sent, results.length]
    );
    const logId = info.lastInsertRowid;
    for (const r of results) {
      run(
        `INSERT INTO announcement_deliveries (log_id, faction_id, faction_name, channel_type, ok, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [logId, r.faction_id ?? null, r.faction_name || r.name || '', r.channel_type || '', r.ok ? 1 : 0, r.error || '']
      );
    }
  } catch (e) {
    console.error('[ANNOUNCE] history log failed:', e.message);
  }
}

// Recent send events with their per-faction deliveries. Pass kind ('announcement'
// or 'ic') to scope to one area — Announcements and IC are tracked separately.
// L3 / Lead Storytellers see everything; guides/leads see only their own sends.
export async function getAnnouncementHistory(kind = null, limit = 50) {
  const actor = await requireActor(1, { allowLeadStoryteller: true });
  const canSeeAll = actor.level >= 3 || actor.isLeadStoryteller;
  const conds = [];
  const params = [];
  if (kind) { conds.push('kind = ?'); params.push(kind); }
  if (!canSeeAll) { conds.push('author_id = ?'); params.push(actor.id); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const logs = query(
    `SELECT * FROM announcement_log ${where} ORDER BY id DESC LIMIT ?`,
    [...params, limit]
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

export async function sendAnnouncement(configIds, message, postToFM = false, channelType = 'command') {
  const actor = await requireActor(1, {allowLeadStoryteller: true});
  if (!message?.trim()) return { ok: false, error: 'Message cannot be empty.' };
  if (!configIds?.length && !postToFM) return { ok: false, error: 'No recipients selected.' };
  if (!['command', 'faction', 'both'].includes(channelType)) channelType = 'command';

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return { ok: false, error: 'Bot token not configured.' };

  const embed = {
    title: 'A Message from Faction Management',
    description: message.trim(),
    color: 0xa07ef5,
    footer: { text: `Sent by ${actor.name}` },
    timestamp: new Date().toISOString(),
  };

  // Send to faction channels (command and/or faction-wide per channelType)
  const results = [];
  if (configIds?.length) {
    const allowed = await getAnnouncementTargets();
    const allowedMap = new Map(allowed.map(t => [t.config_id, t]));
    const targets = configIds.map(id => allowedMap.get(id)).filter(Boolean);
    const label = channelTypeLabel(channelType);

    for (const t of targets) {
      const chans = resolveChannels(t, channelType);
      if (!chans.length) {
        const err = `No ${label} channel configured`;
        results.push({ name: t.name, faction_id: t.faction_id, faction_name: t.name, channel_type: label, ok: false, error: err, reason: err });
        continue;
      }
      let deliveredOnce = false;
      for (const c of chans) {
        let ok = false, error = '';
        try {
          const res = await fetch(`https://discord.com/api/v10/channels/${c.id}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
          });
          ok = res.ok;
          if (!ok) { error = await discordError(res); console.error(`[ANNOUNCE] Failed ${t.name} ${c.type}: ${error}`); }
        } catch (e) {
          error = e.message;
        }
        results.push({ name: `${t.name} (${c.type})`, faction_id: t.faction_id, faction_name: t.name, channel_type: c.type, ok, error, reason: error });
        if (ok) deliveredOnce = true;
        await new Promise(r => setTimeout(r, 300));
      }
      // Store once per faction (not per channel) so the portal Messages tab isn't duplicated.
      if (deliveredOnce) {
        run(
          "INSERT INTO faction_public_messages (faction_id, faction_name, author_name, author_id, message, is_pinned) VALUES (?, ?, ?, ?, ?, 0)",
          [t.faction_id, t.name, actor.name, actor.id, message.trim()]
        );
      }
    }
  }

  // FM Leadership only — post to FM Discord announcement channel with @all-FM ping
  let postedToFM = false;
  if (postToFM && actor.level >= 3) {
    try {
      const res = await fetch(`https://discord.com/api/v10/channels/${FM_ANNOUNCE_CHANNEL}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `<@&${FM_ALL_ROLE}>`, embeds: [embed] }),
      });
      postedToFM = res.ok;
      if (!res.ok) console.error('[ANNOUNCE] FM channel post failed:', res.status);
    } catch (e) { console.error('[ANNOUNCE] FM channel post failed:', e.message); }
  }

  // An announcement sent to no faction that still posts to the FM Discord is an
  // announcement TO Faction Management — record it as the delivery so History
  // shows it as such instead of an empty "0/0 sent".
  if (postToFM && actor.level >= 3 && !results.length) {
    const fmErr = postedToFM ? '' : 'FM Discord post failed';
    results.push({ name: 'Faction Management', faction_id: null, faction_name: 'Faction Management',
      channel_type: 'FM Discord', ok: postedToFM, error: fmErr, reason: fmErr });
  }

  const sent   = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  const label  = channelTypeLabel(channelType);
  logAudit(actor.id, actor.name, 'CREATE', 'announcement', null,
    `Sent to ${sent}/${results.length} ${label} channels${postedToFM ? ' + FM Discord' : ''}`, message.trim().substring(0, 100));

  recordSend({ kind: 'announcement', actor, channelType, message: message.trim(), postedToFM, results });

  return { ok: true, sent, failed, total: results.length, postedToFM, channelType, channelLabel: label };
}

export async function uploadToImgbb(base64Data, filename) {
  await requireActor(1, {allowLeadStoryteller: true});
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) return { ok: false, error: 'IMGBB_API_KEY is not configured on the server.' };

  const form = new URLSearchParams();
  form.append('key', apiKey);
  form.append('image', base64Data);
  if (filename) form.append('name', filename.replace(/\.[^.]+$/, ''));

  try {
    const res  = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
    const json = await res.json();
    if (!json.success) return { ok: false, error: json.error?.message || 'imgbb upload failed.' };
    return { ok: true, url: json.data.url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function sendICCommunication(configIds, link, message, channelType = 'command') {
  const actor = await requireActor(1, {allowLeadStoryteller: true});
  if (!link?.trim()) return { ok: false, error: 'A link is required.' };
  if (!configIds?.length) return { ok: false, error: 'No recipients selected.' };
  if (!['command', 'faction', 'both'].includes(channelType)) channelType = 'command';

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return { ok: false, error: 'Bot token not configured.' };

  // Verify every config ID is accessible to this actor
  const allowed = await getAnnouncementTargets();
  const allowedMap = new Map(allowed.map(t => [t.config_id, t]));
  const targets = configIds.map(id => allowedMap.get(id)).filter(Boolean);
  if (!targets.length) return { ok: false, error: 'No valid targets.' };
  const label = channelTypeLabel(channelType);

  // Embed for faction channels — title, optional message, image all in one box
  const icEmbed = {
    title: 'A Message from Meridian',
    color: 0xa07ef5,
    image: { url: link.trim() },
    footer: { text: `Sent by ${actor.name}` },
    timestamp: new Date().toISOString(),
  };
  if (message?.trim()) icEmbed.description = message.trim();

  const results = [];
  for (const t of targets) {
    const chans = resolveChannels(t, channelType);
    if (!chans.length) {
      const err = `No ${label} channel configured`;
      results.push({ name: t.name, faction_id: t.faction_id, faction_name: t.name, channel_type: label, ok: false, error: err, reason: err });
      continue;
    }
    let deliveredOnce = false;
    for (const c of chans) {
      let ok = false, error = '';
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${c.id}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [icEmbed] }),
        });
        ok = res.ok;
        if (!ok) { error = await discordError(res); console.error(`[IC] Failed ${t.name} ${c.type}: ${error}`); }
      } catch (e) {
        error = e.message;
      }
      results.push({ name: `${t.name} (${c.type})`, faction_id: t.faction_id, faction_name: t.name, channel_type: c.type, ok, error, reason: error });
      if (ok) deliveredOnce = true;
      await new Promise(r => setTimeout(r, 300));
    }
    // Store once per faction for the portal Messages tab.
    if (deliveredOnce) {
      run(
        "INSERT INTO faction_ic_messages (faction_id, faction_name, author_name, author_id, link, message) VALUES (?, ?, ?, ?, ?, ?)",
        [t.faction_id, t.name, actor.name, actor.id, link.trim(), message?.trim() || '']
      );
    }
  }

  // Post to FM IC log channel as an embed
  const sentTo = targets.map(t => t.name).join(', ');
  try {
    await fetch(`https://discord.com/api/v10/channels/${FM_IC_CHANNEL}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: 'IC Communication Sent',
          description: message?.trim() || undefined,
          color: 0xa07ef5,
          image: { url: link.trim() },
          fields: [
            { name: 'Sent To', value: sentTo },
            { name: 'Channel', value: label },
          ],
          footer: { text: `Sent by ${actor.name}` },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch (e) { console.error('[IC] FM channel post failed:', e.message); }

  const sent   = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  logAudit(actor.id, actor.name, 'CREATE', 'ic_communication', null,
    `IC sent to ${sent}/${results.length} ${label} channels`, link.trim().substring(0, 100));

  recordSend({ kind: 'ic', actor, channelType, message: message?.trim() || '', link: link.trim(), results });

  return { ok: true, sent, failed, total: results.length, channelType, channelLabel: label };
}
