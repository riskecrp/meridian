"use server";
import { cookies } from 'next/headers';
import { query, queryOne } from '../../lib/db.js';
import { validateVerifySession } from '../../lib/verifySession.js';

const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const dmy = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (dmy) return new Date(+dmy[3], MON[dmy[2].toLowerCase()] ?? 0, +dmy[1]);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  return null;
}

async function requireVerifier() {
  const cookieStore = await cookies();
  const token = cookieStore.get('meridian_verify_session')?.value;
  const session = validateVerifySession(token);
  if (!session) throw new Error('Not authenticated');
  return session;
}

export async function getVerifySession() {
  try { return await requireVerifier(); } catch { return null; }
}

export async function getVerifyActivity(year, month) {
  await requireVerifier();

  const staff = query(`
    SELECT s.discord_id, s.display_name, s.rank, s.team_name,
           cl.character_name, cl.category
    FROM staff s
    LEFT JOIN fm_character_links cl ON cl.discord_id = s.discord_id
    WHERE s.discord_id != '' AND s.discord_id NOT LIKE 'placeholder%'
      AND s.team_name NOT LIKE '%Game Affairs%'
      AND (cl.category IS NULL OR cl.category != 'non-fm')
    ORDER BY s.display_name ASC
  `);

  const period   = `${year}-${String(month).padStart(2, '0')}`;
  const hours    = query("SELECT discord_id, hours FROM fm_hours_log WHERE period = ?", [period]);
  const hoursMap = {};
  hours.forEach(h => { hoursMap[h.discord_id] = h.hours; });

  const scenes  = query("SELECT id, author_id, date FROM scene_logs WHERE author_id != ''");
  const assists = query("SELECT sa.staff_id, sl.date FROM scene_assistants sa JOIN scene_logs sl ON sa.scene_id = sl.id");
  const sceneCounts = {};
  for (const sc of scenes) {
    const d = parseDate(sc.date);
    if (!d || d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    sceneCounts[sc.author_id] = (sceneCounts[sc.author_id] || 0) + 1;
  }
  for (const a of assists) {
    const d = parseDate(a.date);
    if (!d || d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    sceneCounts[a.staff_id] = (sceneCounts[a.staff_id] || 0) + 1;
  }

  const notes = query("SELECT author_id, date, attendees_json FROM ooc_notes");
  const meetingCounts = {};
  for (const n of notes) {
    const d = parseDate(n.date);
    if (!d || d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
    let attendees = [];
    try { attendees = JSON.parse(n.attendees_json || '[]'); } catch {}
    if (n.author_id && !attendees.includes(n.author_id)) attendees.push(n.author_id);
    for (const id of attendees) {
      if (!id) continue;
      meetingCounts[id] = (meetingCounts[id] || 0) + 1;
    }
  }

  return staff.map(m => ({
    discord_id:     m.discord_id,
    display_name:   m.display_name,
    character_name: m.character_name || '',
    category:       m.category || (m.rank === 'Team Lead' || m.rank === 'Management' ? 'moderator' : 'support'),
    team_name:      m.team_name || '',
    hours:          +(hoursMap[m.discord_id] || 0).toFixed(1),
    scenes:         sceneCounts[m.discord_id] || 0,
    meetings:       meetingCounts[m.discord_id] || 0,
  }));
}

export async function getVerifyNotes(year, month) {
  await requireVerifier();
  const notes = query(`
    SELECT n.id, n.date, n.author, n.author_id, n.text as content, n.attendees_json,
           n.target_type, n.target_label, f.name as faction_name
    FROM ooc_notes n
    LEFT JOIN factions f ON n.faction_id = f.id
    ORDER BY n.created_at DESC
  `);
  return notes.filter(n => {
    const d = parseDate(n.date);
    return d && d.getFullYear() === year && d.getMonth() + 1 === month;
  }).map(n => {
    // Team/group meetings have no faction — show their stored label instead.
    n.faction_name = n.target_type === 'faction'
      ? (n.faction_name || 'Unknown faction')
      : (n.target_label || 'Meeting');
    let attendeeIds = [];
    try { attendeeIds = JSON.parse(n.attendees_json || '[]'); } catch {}
    // Resolve names, excluding the author (shown separately)
    const present = attendeeIds
      .filter(id => id && id !== n.author_id)
      .map(id => queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [id])?.display_name || id);
    return { ...n, present };
  });
}

export async function getVerifyScenes(year, month) {
  await requireVerifier();
  const scenes = query(`
    SELECT sl.id, sl.date, sl.logged_by, sl.author_id, sl.notes,
           f.name as faction_name
    FROM scene_logs sl
    JOIN factions f ON sl.faction_id = f.id
    ORDER BY sl.created_at DESC
  `);
  return scenes.filter(s => {
    const d = parseDate(s.date);
    return d && d.getFullYear() === year && d.getMonth() + 1 === month;
  }).map(s => {
    const assistants = query(
      "SELECT staff_name FROM scene_assistants WHERE scene_id = ?", [s.id]
    ).map(a => a.staff_name);
    return { ...s, assistants };
  });
}
