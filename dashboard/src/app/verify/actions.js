"use server";
import { cookies } from 'next/headers';
import { query } from '../../lib/db.js';
import { validateVerifySession, VERIFY_COOKIE } from '../../lib/verifySession.js';
import { monthKey } from '../../../../shared/dates.js';
import { toInt } from '../../../../shared/validate.js';

// The activity-verification portal: an external audience (the management
// server's verifiers) checks that FM staff were active in a month. It shows
// hours, scene counts, meeting COUNTS and scene notes. Meeting minutes
// (ooc_notes text) are not part of the payload: they are internal FM records.

function authError() { const e = new Error('Not authenticated'); e.code = 'AUTH_REQUIRED'; return e; }

async function requireVerifier() {
  const cookieStore = await cookies();
  const session = validateVerifySession(cookieStore.get(VERIFY_COOKIE)?.value);
  if (!session) throw authError();
  return session;
}

/** "YYYY-MM" for a (year, month) pair, or null when the period is not a real month. */
function periodKey(year, month) {
  const y = toInt(year, { min: 2000, max: 2100 });
  const m = toInt(month, { min: 1, max: 12 });
  return y && m ? `${y}-${String(m).padStart(2, '0')}` : null;
}

export async function getVerifySession() {
  try { return await requireVerifier(); } catch { return null; }
}

export async function getVerifyActivity(year, month) {
  await requireVerifier();
  const period = periodKey(year, month);
  if (!period) return [];

  const staff = query(`
    SELECT s.discord_id, s.display_name, s.clearance, s.team_name,
           cl.character_name, cl.category
    FROM staff s
    LEFT JOIN fm_character_links cl ON cl.discord_id = s.discord_id
    WHERE s.discord_id != '' AND s.discord_id NOT LIKE 'placeholder%'
      AND COALESCE(s.active, 1) = 1
      AND s.team_name NOT LIKE '%Game Affairs%'
      AND (cl.category IS NULL OR cl.category != 'non-fm')
    ORDER BY s.display_name ASC
  `);

  const hoursMap = {};
  for (const h of query("SELECT discord_id, hours FROM fm_hours_log WHERE period = ?", [period])) hoursMap[h.discord_id] = h.hours;

  const sceneCounts = {};
  for (const sc of query("SELECT author_id, date FROM scene_logs WHERE author_id != ''")) {
    if (monthKey(sc.date) === period) sceneCounts[sc.author_id] = (sceneCounts[sc.author_id] || 0) + 1;
  }
  for (const a of query("SELECT sa.staff_id, sl.date FROM scene_assistants sa JOIN scene_logs sl ON sa.scene_id = sl.id")) {
    if (monthKey(a.date) === period) sceneCounts[a.staff_id] = (sceneCounts[a.staff_id] || 0) + 1;
  }

  // Meeting attendance is counted; the minutes themselves stay internal.
  const meetingCounts = {};
  for (const n of query("SELECT author_id, date, attendees_json FROM ooc_notes")) {
    if (monthKey(n.date) !== period) continue;
    let attendees = [];
    try { attendees = JSON.parse(n.attendees_json || '[]'); } catch {}
    if (!Array.isArray(attendees)) attendees = [];
    if (n.author_id && !attendees.includes(n.author_id)) attendees.push(n.author_id);
    for (const id of attendees) if (id) meetingCounts[id] = (meetingCounts[id] || 0) + 1;
  }

  return staff.map(m => ({
    discord_id:     m.discord_id,
    display_name:   m.display_name,
    character_name: m.character_name || '',
    // staff.clearance is the truth: L2+ are moderators, L1 support.
    category:       m.category || (Number(m.clearance) >= 2 ? 'moderator' : 'support'),
    team_name:      m.team_name || '',
    hours:          +(Number(hoursMap[m.discord_id] || 0)).toFixed(1),
    scenes:         sceneCounts[m.discord_id] || 0,
    meetings:       meetingCounts[m.discord_id] || 0,
  }));
}

/** Scenes logged in the month, with assistants, newest first. Notes are plain text. */
export async function getVerifyScenes(year, month) {
  await requireVerifier();
  const period = periodKey(year, month);
  if (!period) return [];
  const scenes = query(`
    SELECT sl.id, sl.date, sl.logged_by, sl.author_id, sl.notes, f.name as faction_name
    FROM scene_logs sl JOIN factions f ON sl.faction_id = f.id
    ORDER BY sl.date DESC, sl.created_at DESC
  `).filter(s => monthKey(s.date) === period);
  if (!scenes.length) return [];
  const ids = scenes.map(s => s.id);
  const byScene = {};
  for (const a of query(`SELECT scene_id, staff_name FROM scene_assistants WHERE scene_id IN (${ids.map(() => '?').join(',')}) ORDER BY added_at`, ids)) {
    (byScene[a.scene_id] ||= []).push(a.staff_name);
  }
  return scenes.map(s => ({ ...s, assistants: byScene[s.id] || [] }));
}

/** Meetings held in the month: when, who, which faction — never the minutes. */
export async function getVerifyMeetings(year, month) {
  await requireVerifier();
  const period = periodKey(year, month);
  if (!period) return [];
  const notes = query(`
    SELECT n.id, n.date, n.author, n.author_id, n.attendees_json, n.meeting_type, n.duration_hours,
           n.target_type, n.target_label, f.name as faction_name
    FROM ooc_notes n LEFT JOIN factions f ON n.faction_id = f.id
    ORDER BY n.date DESC, n.created_at DESC
  `).filter(n => monthKey(n.date) === period);
  const ids = new Set();
  const parsed = notes.map(n => {
    let attendees = [];
    try { attendees = JSON.parse(n.attendees_json || '[]'); } catch {}
    if (!Array.isArray(attendees)) attendees = [];
    attendees.filter(id => id && id !== n.author_id).forEach(id => ids.add(id));
    return { n, attendees };
  });
  const list = [...ids];
  const names = {};
  if (list.length) for (const r of query(`SELECT discord_id, display_name FROM staff WHERE discord_id IN (${list.map(() => '?').join(',')})`, list)) names[r.discord_id] = r.display_name;
  return parsed.map(({ n, attendees }) => ({
    id: n.id,
    date: n.date,
    author: n.author,
    meeting_type: n.meeting_type,
    duration_hours: n.duration_hours,
    label: n.target_type === 'faction' ? (n.faction_name || 'Unknown faction') : (n.target_label || 'Meeting'),
    present: attendees.filter(id => id && id !== n.author_id).map(id => names[id] || id),
  }));
}
