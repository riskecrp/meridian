"use server";
import { createHash, randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { queryOne, run, transaction } from '../../lib/db.js';
import { logAudit } from '../../lib/audit.js';
import { formDef, validateSubmission, HONEYPOT_FIELD } from '../../lib/formDefs.js';
import { identify, valueByHeader } from '../../../../bot/lib/formIntake.js';
import { nowIso, nowSqlite } from '../../../../shared/dates.js';
import { str, fail } from '../../../../shared/validate.js';
import { getSessionSecret } from '../../../../shared/secret.js';

// The public intake forms. No login: these replace Google Forms, and the people
// filling them in are players and applicants, not staff. What stands in for a
// login is the honeypot, the per-IP rate limit and strict validation against
// the field definitions in lib/formDefs.js.
//
// A submission becomes the SAME row the bot's sheet poller would have written
// (payload keyed by question text, title/contact resolved by the bot's own
// identify()), with source = 'web', thread_id NULL and a negative sheet_row.
// The bot posts rows with thread_id NULL on its next poll — thread, card,
// checklist, nudges, exactly as for a sheet row — and fills thread_id in
// (bot/formSubmissions.js postWebRows, bot/factionFeedback.js postWebFeedback).

// More than this many submissions of one form from one address in an hour is
// not a person. Hashed with a server salt so the stored value identifies
// nothing on its own.
const RATE_LIMIT = 3;
const RATE_WINDOW = "-1 hour";
// First nudge, matching the bot's REMINDER_HOURS. The bot sets due_at itself
// for sheet rows; a web row needs it set here so the nudge clock starts when
// the submission arrives, not when it is posted.
const REMINDER_HOURS = 48;

function salt() {
  const s = (process.env.NOTIFY_SECRET || '').trim();
  if (s) return s;
  try { return getSessionSecret(); } catch { return 'meridian'; }
}

async function clientIp() {
  try {
    const h = await headers();
    const fwd = h.get('x-forwarded-for') || '';
    const first = fwd.split(',')[0].trim();
    return first || h.get('x-real-ip') || h.get('cf-connecting-ip') || 'unknown';
  } catch { return 'unknown'; }
}

function hashSubmitter(ip, formKey) {
  return createHash('sha256').update(`${salt()}|${formKey}|${ip}`).digest('hex').slice(0, 40);
}

const plusHours = (h) => new Date(Date.now() + h * 3600000).toISOString().slice(0, 19).replace('T', ' ');

// The code shown on the thank-you screen and stored in row_key ('web:<code>')
// so staff can find the record from it.
function newReference(def) {
  const code = randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
  return { code, reference: `${def.prefix}-${code}`, rowKey: `web:${code}` };
}

/**
 * Submit one of the hosted forms.
 *
 *   submitPublicForm('garage_request', { 'What faction…': 'The Vanguard', … }, { [HONEYPOT_FIELD]: '' })
 *   → { ok: true, reference: 'GAR-1A2B3C4D' }
 *   → { ok: false, error, errors: { [field]: message } }
 *
 * `meta` carries the honeypot (anything in it is a bot: the call reports
 * success and writes nothing). Returns { ok:false } for an unknown form, a
 * failed validation and a tripped rate limit; never throws on bad input.
 */
export async function submitPublicForm(key, values, meta = {}) {
  const def = formDef(str(key));
  if (!def) return fail('Unknown form.');

  const honey = str(meta?.[HONEYPOT_FIELD] ?? values?.[HONEYPOT_FIELD]);
  if (honey) return { ok: true, reference: `${def.prefix}-${randomBytes(4).toString('hex').toUpperCase()}`, dropped: true };

  const v = validateSubmission(def, values);
  if (!v.ok) return { ok: false, error: v.error, errors: v.errors };

  const ipHash = hashSubmitter(await clientIp(), def.key);
  const table = def.key === 'faction_feedback' ? 'faction_feedback' : 'form_submissions';
  const recent = queryOne(
    `SELECT count(*) AS n FROM ${table} WHERE submitter_ip_hash = ? AND created_at >= datetime('now', ?)${table === 'form_submissions' ? ' AND form_key = ?' : ''}`,
    table === 'form_submissions' ? [ipHash, RATE_WINDOW, def.key] : [ipHash, RATE_WINDOW]);
  if ((recent?.n || 0) >= RATE_LIMIT) return fail('Too many submissions from this connection in the last hour. Try again later.');

  // The row as the sheet poller writes it: Timestamp first (Google's own column,
  // which the bot shows as "Submitted" and never as a question), then every
  // question in form order.
  const submittedAt = nowIso();
  const payload = { Timestamp: submittedAt, ...v.clean };
  const header = Object.keys(payload);
  const row = header.map((h) => payload[h]);
  const { reference, rowKey } = newReference(def);
  const sheetRow = -Date.now();
  let id;

  if (table === 'faction_feedback') {
    const pick = (re) => valueByHeader(header, row, re)?.value || '';
    const faction = pick(def.identify.faction) || 'Unknown faction';
    const character = pick(def.identify.character) || 'Unknown';
    const discord = pick(def.identify.discord) || 'not provided';
    const occurred = pick(def.identify.occurred);
    transaction(() => {
      id = run(
        `INSERT INTO faction_feedback (sheet_row, row_key, faction, character_name, discord_username, occurred, submitted_at, payload,
           thread_id, status, due_at, created_at, source, submitter_ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'new', ?, ?, 'web', ?)`,
        [sheetRow, rowKey, faction, character, discord, occurred, submittedAt, JSON.stringify(payload),
         plusHours(REMINDER_HOURS), nowSqlite(), ipHash]).lastInsertRowid;
      logAudit('', 'Website form', 'CREATE', 'feedback', id, `${faction} — ${character}`, `Submission received from the website form (${reference})`);
    });
  } else {
    const { title, contact } = identify(def.identify, header, row);
    transaction(() => {
      id = run(
        `INSERT INTO form_submissions (form_key, sheet_row, row_key, title, contact, submitted_at, payload,
           thread_id, status, due_at, created_at, source, submitter_ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'new', ?, ?, 'web', ?)`,
        [def.key, sheetRow, rowKey, title, contact, submittedAt, JSON.stringify(payload),
         plusHours(REMINDER_HOURS), nowSqlite(), ipHash]).lastInsertRowid;
      logAudit('', 'Website form', 'CREATE', 'form_submission', id, `${def.title} — ${title}`, `Submission received from the website form (${reference})`);
    });
  }
  return { ok: true, reference };
}
