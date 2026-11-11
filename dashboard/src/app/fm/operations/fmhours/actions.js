"use server";
import { revalidatePath } from "next/cache";
import { query, queryOne, run } from "../../../../lib/db.js";
import { requireActor } from "../../../../lib/requireActor.js";
import { pingChannel, sendDiscord, BASE_URL } from "../../../../lib/pings.js";
import { logAudit } from "../../../../lib/audit.js";
import { parseDate } from "../../../../../../shared/dates.js";
import { str, toInt, toNum, fail, isSnowflake } from "../../../../../../shared/validate.js";

// FM hours: one gate. Team leads (L2) see and record their own team; Leadership
// (L3) sees everyone and is the only level that posts the report.

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const ACTIVE_FM = "s.discord_id != '' AND s.discord_id NOT LIKE 'placeholder%' AND s.active = 1 AND s.clearance >= 1 AND s.team_name NOT LIKE '%Game Affairs%'";

function bump() {
  for (const p of ['/fm/operations/fmhours', '/v2/admin']) { try { revalidatePath(p); } catch {} }
}

/** L2 may only touch people on their own team. */
function canTouch(actor, discordId) {
  if (actor.level >= 3) return true;
  const s = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [discordId]);
  return !!s && !!actor.teamId && s.team_id === actor.teamId;
}

function periodParts(period) {
  const p = str(period);
  if (!PERIOD.test(p)) return null;
  const [y, m] = p.split('-').map(Number);
  return { period: p, year: y, month: m };
}

function sceneDateMatches(value, year, month) {
  const d = parseDate(value);
  return !!d && d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
}

// ── Character links ────────────────────────────────────────────
export async function getFMStaffWithLinks() {
  const actor = await requireActor(2);
  const staff = query(`
    SELECT s.discord_id, s.display_name, s.rank, s.clearance, s.team_id, s.team_name
    FROM staff s
    WHERE ${ACTIVE_FM}
    ORDER BY s.clearance DESC, s.display_name ASC
  `).filter(s => actor.level >= 3 || s.team_id === actor.teamId);
  const links = query("SELECT discord_id, character_name, category FROM fm_character_links");
  const linkMap = {};
  links.forEach(l => { linkMap[l.discord_id] = { character_name: l.character_name, category: l.category }; });
  return staff.map(s => ({
    ...s,
    character_name: linkMap[s.discord_id]?.character_name || '',
    // If manually set use that; otherwise derive from clearance
    category: linkMap[s.discord_id]?.category || (s.clearance >= 2 ? 'moderator' : 'support'),
  }));
}

export async function setCharacterLink(discordId, characterName, category) {
  const actor = await requireActor(2);
  const id = str(discordId);
  if (!isSnowflake(id) || !queryOne("SELECT 1 FROM staff WHERE discord_id = ?", [id])) return fail('That person is not on the staff roster.');
  if (!canTouch(actor, id)) return fail('You can only edit links for your own team.');
  const name = str(characterName, { max: 100 });
  const cat = ['support', 'moderator', 'non-fm'].includes(str(category)) ? str(category) : '';
  run(
    `INSERT INTO fm_character_links (discord_id, character_name, category, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(discord_id) DO UPDATE SET
       character_name=excluded.character_name,
       category=excluded.category,
       updated_at=excluded.updated_at`,
    [id, name, cat]
  );
  logAudit(actor.id, actor.name, 'EDIT', 'fm_character_link', id, name || '(cleared)', cat ? `Category: ${cat}` : 'Category: default');
  bump();
  return { ok: true };
}

// ── Hours log ──────────────────────────────────────────────────
export async function getFMHoursForPeriod(period) {
  const actor = await requireActor(2);
  const p = periodParts(period);
  if (!p) return [];
  const rows = query("SELECT h.discord_id, h.hours, s.team_id FROM fm_hours_log h LEFT JOIN staff s ON s.discord_id = h.discord_id WHERE h.period = ?", [p.period]);
  return rows.filter(r => actor.level >= 3 || r.team_id === actor.teamId).map(r => ({ discord_id: r.discord_id, hours: Number(r.hours) || 0 }));
}

/** `entries`: [{ discord_id, hours }]. Hours must be finite numbers ≥ 0; unknown people are skipped and reported. */
export async function saveFMHours(period, entries) {
  const actor = await requireActor(2);
  const p = periodParts(period);
  if (!p) return fail('Period must look like YYYY-MM.');
  if (!Array.isArray(entries) || !entries.length) return fail('Missing data.');
  const skipped = [];
  const rows = [];
  for (const e of entries) {
    const id = str(e?.discord_id);
    const hours = toNum(e?.hours);
    if (!isSnowflake(id) || !queryOne("SELECT 1 FROM staff WHERE discord_id = ?", [id])) { skipped.push(`${id || '?'}: not on the roster`); continue; }
    if (!canTouch(actor, id)) { skipped.push(`${id}: not on your team`); continue; }
    if (hours === null || hours < 0 || hours > 744) { skipped.push(`${id}: hours "${e?.hours}" is not a number between 0 and 744`); continue; }
    rows.push({ id, hours: Math.round(hours * 100) / 100 });
  }
  if (!rows.length) return fail(`Nothing saved. ${skipped.join('; ')}`.trim());
  for (const r of rows) {
    run(
      `INSERT INTO fm_hours_log (discord_id, period, hours)
       VALUES (?, ?, ?)
       ON CONFLICT(discord_id, period) DO UPDATE SET hours=excluded.hours`,
      [r.id, p.period, r.hours]
    );
  }
  logAudit(actor.id, actor.name, 'EDIT', 'fm_hours', p.period, `${rows.length} staff`, `Hours saved for ${p.period}${skipped.length ? `; skipped ${skipped.length}` : ''}`);
  bump();
  return { ok: true, saved: rows.length, skipped };
}

// ── Scene counts ───────────────────────────────────────────────
export async function getFMScenesForPeriod(year, month) {
  await requireActor(2);
  const y = toInt(year), m = toInt(month, { min: 1, max: 12 });
  if (!y || !m) return {};
  const scenes    = query("SELECT id, author_id, date FROM scene_logs WHERE author_id != ''");
  const assists   = query(`SELECT sa.staff_id, sl.date FROM scene_assistants sa JOIN scene_logs sl ON sa.scene_id = sl.id`);
  const counts = {};
  for (const sc of scenes) {
    if (!sc.author_id || !sceneDateMatches(sc.date, y, m)) continue;
    counts[sc.author_id] = (counts[sc.author_id] || 0) + 1;
  }
  for (const a of assists) {
    if (!a.staff_id || !sceneDateMatches(a.date, y, m)) continue;
    counts[a.staff_id] = (counts[a.staff_id] || 0) + 1;
  }
  return counts; // { discord_id: count }
}

// ── OOC meeting counts ─────────────────────────────────────────
export async function getFMMeetingsForPeriod(year, month) {
  await requireActor(2);
  const y = toInt(year), m = toInt(month, { min: 1, max: 12 });
  if (!y || !m) return {};
  const notes = query("SELECT author_id, date, attendees_json FROM ooc_notes");
  const counts = {};
  for (const n of notes) {
    if (!sceneDateMatches(n.date, y, m)) continue;
    // Credit every attendee listed in attendees_json
    let attendees = [];
    try { attendees = JSON.parse(n.attendees_json || '[]'); } catch {}
    if (!Array.isArray(attendees)) attendees = [];
    // Also always credit the author if not already in the list
    if (n.author_id && !attendees.includes(n.author_id)) attendees.push(n.author_id);
    for (const id of attendees) {
      if (!id) continue;
      counts[id] = (counts[id] || 0) + 1;
    }
  }
  return counts; // { discord_id: meetingCount }
}

// ── Post report ────────────────────────────────────────────────

export async function postFMReport({ period, testMode } = {}) {
  const actor = await requireActor(3);
  const p = periodParts(period);
  if (!p) return fail('Period must look like YYYY-MM.');
  const { year, month } = p;
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: 'UTC' });

  const staff    = await getFMStaffWithLinks();
  const hours    = await getFMHoursForPeriod(p.period);
  const scenes   = await getFMScenesForPeriod(year, month);
  const meetings = await getFMMeetingsForPeriod(year, month);

  const hoursMap = {};
  hours.forEach(h => { hoursMap[h.discord_id] = Number(h.hours) || 0; });

  const support = staff.filter(s => s.category === "support").sort((a, b) => a.display_name.localeCompare(b.display_name));
  const modPlus = staff.filter(s => s.category === "moderator").sort((a, b) => a.display_name.localeCompare(b.display_name));
  // Members marked "non-fm" are excluded from both sections

  const SEP = "\n\n";
  const fmtMember = (m) => {
    const h  = (Number(hoursMap[m.discord_id]) || 0).toFixed(1);
    const sc = scenes[m.discord_id]   || 0;
    const mt = meetings[m.discord_id] || 0;
    return `**${m.display_name}**\n${h}h · ${sc}sc · ${mt}mt`;
  };
  const fieldValue = (list) => list.length ? "​\n" + list.map(fmtMember).join(SEP) : "*None*";

  // Split support into two columns if the list is long
  const supportFields = [];
  if (support.length === 0) {
    supportFields.push({ name: "🟣 Support", value: "*None*", inline: true });
  } else if (support.length > 8) {
    const mid  = Math.ceil(support.length / 2);
    supportFields.push({ name: "🟣 Support", value: fieldValue(support.slice(0, mid)), inline: true });
    supportFields.push({ name: "Support (cont.)", value: fieldValue(support.slice(mid)), inline: true });
  } else {
    supportFields.push({ name: "🟣 Support", value: fieldValue(support), inline: true });
  }

  const embed = {
    title:       `Faction Management — ${monthName}`,
    description: `-# Average scene ≈ 2 hours\n-# Average meeting ≈ 1 hour\n-# ⏱ hrs = Meridian RP  ·  🎬 sc = scenes  ·  📋 mt = meetings\n​\n[Click here to see more information regarding stats.](${BASE_URL}/verify)`,
    color:       0xa07ef5,
    thumbnail:   { url: process.env.FM_REPORT_THUMBNAIL || "https://i.ibb.co/Y73wVkR9/Meridian.png" },
    fields: [
      ...supportFields,
      {
        name:   "🟢 Moderator+",
        value:  fieldValue(modPlus),
        inline: true,
      },
    ],
    timestamp: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
    footer:    { text: "Faction Management · Monthly Report" },
  };

  const routeKey = testMode ? 'fmhours.report.test' : 'fmhours.report.prod';
  const channelId = pingChannel(routeKey);
  if (!channelId) return fail("The FM hours report ping is switched off in Admin › Pings.");
  if (!process.env.DISCORD_BOT_TOKEN) return fail("Discord bot token not configured.");

  const sent = await sendDiscord(channelId, '', [embed]);
  if (!sent) {
    logAudit(actor.id, actor.name, 'CREATE', 'fm_hours_report', p.period, monthName, `${testMode ? 'TEST' : 'LIVE'} post to ${channelId} FAILED`);
    return fail('Discord rejected the report — check the bot can post in that channel.');
  }
  logAudit(actor.id, actor.name, 'CREATE', 'fm_hours_report', p.period, monthName, `${testMode ? 'Test' : 'LIVE'} report posted to ${channelId} (${staff.length} staff)`);
  return { ok: true, testMode: !!testMode, channel: channelId };
}
