"use server";
import { query, queryOne, run } from "../../../../lib/db.js";
import { requireActor } from "../../../../lib/requireActor.js";
import { pingChannel } from "../../../../lib/pings.js";

// Opened from owner-only to all FM Leadership (owner ruling 2026-08-04).
async function guard() {
  await requireActor(3);
}

// Month abbreviations for DD/Mon/YYYY date parsing
const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseSceneDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  // DD/Mon/YYYY  e.g. 04/MAY/2026
  const dmy = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (dmy) return new Date(+dmy[3], MON[dmy[2].toLowerCase()] ?? 0, +dmy[1]);
  // YYYY-MM-DD ISO  e.g. 2026-04-26
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  return null;
}

// ── Character links ────────────────────────────────────────────
export async function getFMStaffWithLinks() {
  await guard();
  const staff = query(`
    SELECT s.discord_id, s.display_name, s.rank, s.clearance, s.team_name
    FROM staff s
    WHERE s.discord_id != '' AND s.discord_id NOT LIKE 'placeholder%'
      AND s.team_name NOT LIKE '%Game Affairs%'
    ORDER BY s.clearance DESC, s.display_name ASC
  `);
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
  await guard();
  run(
    `INSERT INTO fm_character_links (discord_id, character_name, category, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(discord_id) DO UPDATE SET
       character_name=excluded.character_name,
       category=excluded.category,
       updated_at=excluded.updated_at`,
    [discordId, characterName.trim(), category || '']
  );
  return { ok: true };
}

// ── Hours log ──────────────────────────────────────────────────
export async function getFMHoursForPeriod(period) {
  await guard();
  return query("SELECT discord_id, hours FROM fm_hours_log WHERE period = ?", [period]);
}

export async function saveFMHours(period, entries) {
  await guard();
  if (!period || !entries?.length) return { ok: false, error: "Missing data." };
  for (const e of entries) {
    run(
      `INSERT INTO fm_hours_log (discord_id, period, hours)
       VALUES (?, ?, ?)
       ON CONFLICT(discord_id, period) DO UPDATE SET hours=excluded.hours`,
      [e.discord_id, period, e.hours]
    );
  }
  return { ok: true, saved: entries.length };
}

// ── Scene counts ───────────────────────────────────────────────
export async function getFMScenesForPeriod(year, month) {
  await guard();
  const scenes    = query("SELECT id, author_id, date FROM scene_logs WHERE author_id != ''");
  const assists   = query(`SELECT sa.staff_id, sl.date FROM scene_assistants sa JOIN scene_logs sl ON sa.scene_id = sl.id`);
  const counts = {};
  for (const sc of scenes) {
    const d = parseSceneDate(sc.date);
    if (!d || d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    if (!sc.author_id) continue;
    counts[sc.author_id] = (counts[sc.author_id] || 0) + 1;
  }
  for (const a of assists) {
    const d = parseSceneDate(a.date);
    if (!d || d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    if (!a.staff_id) continue;
    counts[a.staff_id] = (counts[a.staff_id] || 0) + 1;
  }
  return counts; // { discord_id: count }
}

// ── OOC meeting counts ─────────────────────────────────────────
export async function getFMMeetingsForPeriod(year, month) {
  await guard();
  const notes = query("SELECT author_id, date, attendees_json FROM ooc_notes");
  const counts = {};
  for (const n of notes) {
    const d = parseSceneDate(n.date);
    if (!d || d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    // Credit every attendee listed in attendees_json
    let attendees = [];
    try { attendees = JSON.parse(n.attendees_json || '[]'); } catch {}
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


export async function postFMReport({ period, testMode }) {
  await guard();
  if (!period) return { ok: false, error: "Period required." };

  const [yearStr, monthStr] = period.split("-");
  const year  = parseInt(yearStr);
  const month = parseInt(monthStr);
  const monthName = new Date(year, month - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });

  const staff    = await getFMStaffWithLinks();
  const hours    = await getFMHoursForPeriod(period);
  const scenes   = await getFMScenesForPeriod(year, month);
  const meetings = await getFMMeetingsForPeriod(year, month);

  const hoursMap = {};
  hours.forEach(h => { hoursMap[h.discord_id] = h.hours; });

  const support = staff.filter(s => s.category === "support").sort((a, b) => a.display_name.localeCompare(b.display_name));
  const modPlus = staff.filter(s => s.category === "moderator").sort((a, b) => a.display_name.localeCompare(b.display_name));
  // Members marked "non-fm" are excluded from both sections

  const SEP = "\n\n";
  const fmtMember = (m) => {
    const h  = (hoursMap[m.discord_id] || 0).toFixed(1);
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
    description: `-# Average scene ≈ 2 hours\n-# Average meeting ≈ 1 hour\n-# ⏱ hrs = Meridian RP  ·  🎬 sc = scenes  ·  📋 mt = meetings\n​\n[Click here to see more information regarding stats.](https://ecrpfm.com/verify)`,
    color:       0xa07ef5,
    thumbnail:   { url: "https://i.ibb.co/Y73wVkR9/Meridian.png" },
    fields: [
      ...supportFields,
      {
        name:   "🟢 Moderator+",
        value:  fieldValue(modPlus),
        inline: true,
      },
    ],
    timestamp: new Date(year, month - 1, 1).toISOString(),
    footer:    { text: "Faction Management · Monthly Report" },
  };

  const channelId = pingChannel(testMode ? 'fmhours.report.test' : 'fmhours.report.prod');
  if (!channelId) return { ok: false, error: "The FM hours report ping is switched off in Admin › Pings." };
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: "Bot token not configured." };

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return { ok: false, error: `Discord error ${res.status}: ${err}` };
  }
  return { ok: true, testMode, channel: channelId };
}
