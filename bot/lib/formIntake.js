/**
 * Shared plumbing for the form intakes — faction feedback (factionFeedback.js)
 * and the four FM forms (formSubmissions.js).
 *
 * Both do the same thing to different sheets: read a Google Form's responses as
 * CSV, open a Discord thread per new row, and move that thread through one
 * status ladder. Everything in here is the part that is genuinely identical —
 * pure helpers and the REST wrapper. Anything a form gets to decide for itself
 * (which columns matter, how a nudge is worded, who may press the buttons)
 * deliberately stays in the calling module.
 */

import { createHash } from 'node:crypto';
import { getDb, queryOne, run } from './db.js';

// ── Time ───────────────────────────────────────────────────────────────────────
// SQLite-friendly 'YYYY-MM-DD HH:MM:SS' in UTC, matching the rest of the schema.

export const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
export const plusHours = (h) => new Date(Date.now() + h * 3600000).toISOString().slice(0, 19).replace('T', ' ');
export const plusDays = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 19).replace('T', ' ');

// ── Discord REST ───────────────────────────────────────────────────────────────
//
// Raw REST rather than the discord.js client: these run from cron ticks, where
// there is no interaction and no guaranteed cache, and a thread that was created
// minutes ago by another process is not in it.

const API = 'https://discord.com/api/v10';

export async function discordFetch(method, path, body) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('no bot token');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Discord ${method} ${path} → ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

export const discordPost = (path, body) => discordFetch('POST', path, body);
export const discordPatch = (path, body) => discordFetch('PATCH', path, body);
export const discordDelete = (path) => discordFetch('DELETE', path);

/**
 * Remove a concluded thread's card from the parent channel's message flow.
 *
 * Opening a thread with no starter message makes Discord post a THREAD_CREATED
 * (type 18) system message into the channel body, and that message STAYS there
 * after the thread is archived — so a channel that works its items as threads
 * fills up with cards for finished work, interleaved with the live ones. Worse,
 * the card carries the thread's name AS IT WAS AT CREATION, so a completed item
 * still reads '[Open]' in the flow.
 *
 * For a thread created this way the system message's id IS the thread id, and
 * deleting it does NOT delete the thread: verified against the live guild
 * 2026-08-02 — thread, history and archived listing all survived. (This is only
 * true for standalone threads. A thread started FROM a message is owned by that
 * message and deleting it takes the thread with it, so never point this at one.)
 *
 * Needs Manage Messages in the parent channel. Failure is logged and swallowed:
 * the item is already concluded, and a card left in the flow is untidy, not
 * broken.
 */
export async function hideThreadCard(threadId, parentId, tag = 'INTAKE') {
  if (!threadId || !parentId) return false;
  try {
    await discordDelete(`/channels/${parentId}/messages/${threadId}`);
    return true;
  } catch (e) {
    console.error(`[${tag}] could not hide thread card ${threadId}:`, e.message);
    return false;
  }
}

// ── Thread titles ──────────────────────────────────────────────────────────────
//
// The status lives in the thread NAME, so the channel list shows where every item
// stands without opening any of them. Both intakes use the same ladder, so the
// tags live here and stay consistent between them.

const THREAD_NAME_LIMIT = 100;

// Faction feedback, where contacting the submitter is a tracked step of its own
// because it is the part nobody sees if it is skipped.
export const STATUS_TAGS = {
  new: '[Pending Acknowledgement]',   // nobody has picked it up yet
  claimed: '[Pending Review]',        // acknowledged, the outcome is outstanding
  completed: '[Completed]',
  cancelled: '[Cancelled]',
};

// The four FM intake forms, which have no acknowledgement step: an item is open
// until the work is done and someone says so.
export const OPEN_STATUS_TAGS = {
  new: '[Open]',
  completed: '[Completed]',
  cancelled: '[Cancelled]',
};

// Forms that are decided before they are worked — currently the Recognized
// Criminal Faction application, which is accepted or rejected first and only
// then has setup to complete.
export const DECISION_STATUS_TAGS = {
  new: '[Open]',
  accepted: '[Accepted]',
  completed: '[Completed]',
  rejected: '[Rejected]',
  cancelled: '[Cancelled]',
};

// Every tag any intake can put on a thread. Retagging has to be able to strip a
// tag written by a ladder other than its own, or a thread whose form later
// changes shape keeps its old prefix and gains a second one. Longest first, so
// '[Pending Acknowledgement]' is never half-matched by a shorter tag.
const ALL_TAGS = [...new Set([
  ...Object.values(STATUS_TAGS),
  ...Object.values(OPEN_STATUS_TAGS),
  ...Object.values(DECISION_STATUS_TAGS),
])].sort((a, b) => b.length - a.length);

/** '<tag> <base>', trimming the base so the whole thing fits Discord's limit. */
export function titled(base, tag) {
  const room = THREAD_NAME_LIMIT - tag.length - 1;
  return `${tag} ${base.slice(0, room).trimEnd()}`;
}

/** Swap whatever status tag a thread carries now for a new one. */
export function retag(name, tag) {
  let base = name;
  for (const t of ALL_TAGS) {
    if (base.startsWith(t + ' ')) { base = base.slice(t.length + 1); break; }
  }
  return titled(base, tag);
}

// ── Text ───────────────────────────────────────────────────────────────────────

/** Split long text at newline boundaries so every piece fits one message. */
export function chunks(text, limit = 1900) {
  const parts = [];
  let rest = String(text || '').trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

// ── Sheets ─────────────────────────────────────────────────────────────────────

/**
 * A minimal CSV reader. Google's export quotes any field containing a comma,
 * newline or quote, and escapes quotes by doubling them — so a submission
 * containing either (they routinely contain both) has to be parsed rather than
 * split on commas.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── Reading a response row ─────────────────────────────────────────────────────

// Google Forms' own column, handled as "Submitted" rather than as a question.
export const TIMESTAMP_HEADER = /^timestamp$/i;

// An answer at or under this length is a field, not an essay: it belongs on one
// line in the header block. Anything longer earns its own section. This is what
// keeps a form with fifteen one-word questions from becoming fifteen messages,
// without anyone having to say which of its columns are which.
export const SHORT_ANSWER_LIMIT = 120;

// A thread title has to stay scannable in the channel list, and some of what
// these forms ask for is free text — "which faction are you a CI against" gets
// answered with a paragraph. A part longer than this is dropped from the title
// and left to the body, where there is room for it.
const TITLE_PART_LIMIT = 40;

/** First column whose header matches `pattern` and whose value is non-empty. */
export function valueByHeader(header, row, pattern) {
  for (let i = 0; i < header.length; i++) {
    const value = String(row[i] ?? '').trim();
    if (value && pattern.test(String(header[i] || '').trim())) return { value, index: i };
  }
  return null;
}

/**
 * The thread's name and the handle to follow up on, resolved from the sheet's
 * HEADER TEXT rather than from column indexes — these forms are edited by hand,
 * and a question inserted in the middle would silently re-point every index
 * below it.
 *
 * Both fall back rather than failing: an unmatched title pattern drops to the
 * first short answer in the sheet, which for a Google Form is all but always the
 * thing being named. A form can therefore be wired up before anyone has read its
 * headers, and the worst case is a thread titled slightly oddly rather than a
 * submission that does not arrive.
 */
export function identify(form, header, row) {
  const candidates = [];
  const used = new Set();
  for (const pattern of form.title || []) {
    const hit = valueByHeader(header, row, pattern);
    if (hit && !used.has(hit.index)) { candidates.push(hit.value); used.add(hit.index); }
  }
  // Overlong parts are dropped rather than truncated — a title ending in a
  // sentence fragment reads worse than one that simply names the applicant.
  let parts = candidates.filter((p) => p.length <= TITLE_PART_LIMIT);
  // Unless dropping leaves nothing, in which case a trimmed part beats no title.
  if (!parts.length && candidates.length) parts = [candidates[0].slice(0, TITLE_PART_LIMIT).trimEnd() + '…'];
  if (!parts.length) {
    for (let i = 0; i < header.length; i++) {
      const value = String(row[i] ?? '').trim();
      if (value && !TIMESTAMP_HEADER.test(String(header[i] || '')) && value.length <= SHORT_ANSWER_LIMIT) {
        parts.push(value);
        break;
      }
    }
  }
  // Tried in order, most specific first, so a blank "Discord username" falls
  // through to the next candidate rather than to whatever column merely has the
  // word Discord in its header — on these forms that is the invite link, which
  // is not a person anyone can message.
  // A value that is a link (the faction's invite URL) is never a contact,
  // whatever its header says (BOT-19).
  let contact = null;
  for (const pattern of form.contact || []) {
    for (let i = 0; i < header.length; i++) {
      const value = String(row[i] ?? '').trim();
      if (!value || !pattern.test(String(header[i] || '').trim())) continue;
      if (/^https?:\/\//i.test(value) || /discord\.gg\//i.test(value)) continue;
      contact = value;
      break;
    }
    if (contact) break;
  }
  return {
    title: parts.join(' · ') || 'Untitled submission',
    // Empty, not "not provided" — whether we have a way to reach the submitter
    // changes what the acknowledgement prompt can sensibly ask for, so callers
    // need to be able to tell the difference.
    contact: contact || '',
  };
}

/**
 * The whole row as {question: answer}, for storing alongside the record so a
 * later edit to the form's questions cannot rewrite what was already received.
 *
 * Headers repeat in practice — a question deleted and re-added leaves Google's
 * placeholder names behind, and the CI sheet carries "Column 7" twice — so
 * repeats are suffixed rather than allowed to overwrite each other. Unnamed
 * trailing columns are dropped; they are spreadsheet padding, not questions.
 */
export function rowPayload(header, row) {
  const payload = {};
  for (let i = 0; i < Math.min(header.length, row.length); i++) {
    const question = String(header[i] || '').trim();
    if (!question) continue;
    let key = question;
    for (let n = 2; key in payload; n++) key = `${question} (${n})`;
    payload[key] = row[i];
  }
  return payload;
}

/**
 * Split a row's answered questions into the one-line fields that make up the
 * header block and the long answers that each get their own section, keeping the
 * order the form asks them in.
 */
export function splitAnswers(header, row) {
  const shortLines = [];
  const longAnswers = [];
  for (let i = 0; i < header.length; i++) {
    const question = String(header[i] || '').trim();
    const answer = String(row[i] ?? '').trim();
    if (!question || !answer || TIMESTAMP_HEADER.test(question)) continue;
    if (answer.length <= SHORT_ANSWER_LIMIT) shortLines.push(`**${question}:** ${answer}`);
    else longAnswers.push({ question, answer });
  }
  return { shortLines, longAnswers };
}

export function sheetCsvUrl(sheetId, gid) {
  const base = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
  return gid ? `${base}&gid=${gid}` : base;
}

const NOT_SHARED = 'the sheet is not shared — set it to "Anyone with the link can view" (or set GOOGLE_SHEETS_API_KEY and share it with the key\'s project)';

/** The CSV export path: works for any link-viewable sheet, no credentials. */
export async function fetchSheetRowsCsv(sheetId, gid) {
  let text;
  try {
    const res = await fetch(sheetCsvUrl(sheetId, gid), { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      return { error: res.status === 401 || res.status === 403 ? NOT_SHARED : `the sheet returned HTTP ${res.status}` };
    }
    text = await res.text();
  } catch (e) {
    return { error: `could not reach the sheet (${e.message})` };
  }
  if (/^\s*<!doc|^\s*<html/i.test(text)) return { error: NOT_SHARED };
  return { rows: parseCsv(text), via: 'csv' };
}

/**
 * The Sheets API path (GOOGLE_SHEETS_API_KEY). Reads the tab named by `gid`
 * (or the first tab) through values.get, so the sheet no longer has to be
 * published as CSV. Returns { rows } or { error }; never throws.
 */
export async function fetchSheetRowsApi(sheetId, gid, apiKey) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  const opts = { signal: AbortSignal.timeout(30000) };
  const explain = async (res) => {
    const body = await res.json().catch(() => null);
    const msg = body?.error?.message || `HTTP ${res.status}`;
    return res.status === 403 || res.status === 401 ? `Sheets API refused the key (${msg})` : res.status === 404 ? `Sheets API: spreadsheet not found (${msg})` : `Sheets API error (${msg})`;
  };
  try {
    const meta = await fetch(`${base}?key=${encodeURIComponent(apiKey)}&fields=sheets.properties(sheetId,title)`, opts);
    if (!meta.ok) return { error: await explain(meta) };
    const sheets = (await meta.json())?.sheets?.map(s => s.properties) || [];
    if (!sheets.length) return { error: 'Sheets API: the spreadsheet has no tabs' };
    const tab = gid ? sheets.find(s => String(s.sheetId) === String(gid)) : sheets[0];
    if (!tab) return { error: `Sheets API: no tab with gid ${gid}` };
    const range = encodeURIComponent(`'${String(tab.title).replace(/'/g, "''")}'`);
    const vals = await fetch(`${base}/values/${range}?key=${encodeURIComponent(apiKey)}&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, opts);
    if (!vals.ok) return { error: await explain(vals) };
    const values = (await vals.json())?.values;
    if (!Array.isArray(values)) return { error: 'Sheets API returned no values' };
    return { rows: values.map(r => r.map(v => (v == null ? '' : String(v)))), via: 'api' };
  } catch (e) {
    return { error: `could not reach the Sheets API (${e.message})` };
  }
}

/**
 * Read a response sheet.
 *
 * With GOOGLE_SHEETS_API_KEY set the Sheets API is tried first and the CSV
 * export is the fallback; without it the CSV export is used alone. Returns
 * `{ rows, via }` or `{ error }` — never throws and never returns partial
 * rows, because every failure mode looks like an empty sheet to a careless
 * caller, and an empty sheet is indistinguishable from "nothing new".
 *
 * The HTML check in the CSV path is the important one: a sheet that is not
 * link-viewable answers a CSV request with a sign-in page, HTTP 200 and all.
 */
export async function fetchSheetRows(sheetId, gid) {
  if (!sheetId) return { error: 'no sheet id configured (see .env.example)' };
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (apiKey) {
    const viaApi = await fetchSheetRowsApi(sheetId, gid, apiKey);
    if (!viaApi.error) return viaApi;
    console.warn(`[SHEETS] API read failed (${viaApi.error}); falling back to CSV export`);
    const viaCsv = await fetchSheetRowsCsv(sheetId, gid);
    return viaCsv.error ? { error: `${viaApi.error}; CSV fallback: ${viaCsv.error}` } : viaCsv;
  }
  return fetchSheetRowsCsv(sheetId, gid);
}

// ── Row identity ───────────────────────────────────────────────────────────────
//
// A response is identified by its own timestamp — Google Forms stamps every
// submission to the second — not by where it sits in the sheet, so deleting or
// reordering rows neither re-posts old submissions nor hides new ones (BOT-10).
// Two submissions in the same second are told apart by their order; a sheet
// with no Timestamp column falls back to a hash of the row's contents. Either
// way a key survives questions being added, renamed or reordered.

/** Content hash of one row (the no-timestamp fallback): sha1 of the trimmed cells, 24 hex chars. */
export function rowKey(row) {
  const cells = (row || []).map(v => String(v ?? '').trim());
  while (cells.length && !cells[cells.length - 1]) cells.pop();
  return createHash('sha1').update(cells.join('\u001f')).digest('hex').slice(0, 24);
}

/** Stable keys for every data row of a sheet, in order. */
export function rowKeys(header, data) {
  const tsCol = (header || []).findIndex(h => TIMESTAMP_HEADER.test(String(h || '').trim()));
  const seen = new Map();
  return (data || []).map(row => {
    const ts = tsCol >= 0 ? String(row[tsCol] ?? '').trim() : '';
    if (!ts) return rowKey(row);
    const n = seen.get(ts) || 0;
    seen.set(ts, n + 1);
    return createHash('sha1').update(`${ts}#${n}`).digest('hex').slice(0, 24);
  });
}

/**
 * The intake bookkeeping schema, applied idempotently at the first poll so a
 * database the migrations have not reached yet still works. The same change
 * is a migration in migrations/ (see fixes/bot.md) for fresh bootstraps.
 */
let schemaReady = false;
export function ensureIntakeSchema() {
  if (schemaReady) return;
  const db = getDb();
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
  const add = (table, col, ddl) => { if (!has(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); };
  add('faction_feedback', 'row_key', 'TEXT');
  add('form_submissions', 'row_key', 'TEXT');
  add('faction_feedback_failures', 'row_key', 'TEXT');
  add('form_submission_failures', 'row_key', 'TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_faction_feedback_row_key ON faction_feedback(row_key) WHERE row_key IS NOT NULL`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_form_submissions_row_key ON form_submissions(form_key, row_key) WHERE row_key IS NOT NULL`);
  db.exec(`CREATE TABLE IF NOT EXISTS sheet_rows_seen (
    source    TEXT NOT NULL,
    row_key   TEXT NOT NULL,
    sheet_row INTEGER NOT NULL DEFAULT 0,
    record_id INTEGER,
    seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source, row_key)
  )`);
  schemaReady = true;
}

export function rowSeen(source, key) {
  return !!queryOne('SELECT 1 FROM sheet_rows_seen WHERE source = ? AND row_key = ?', [source, key]);
}

export function markRowSeen(source, key, sheetRow, recordId = null) {
  run(`INSERT INTO sheet_rows_seen (source, row_key, sheet_row, record_id, seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source, row_key) DO UPDATE SET sheet_row = excluded.sheet_row, record_id = COALESCE(excluded.record_id, sheet_rows_seen.record_id)`,
    [source, key, sheetRow || 0, recordId, nowStr()]);
}

/** Mark every current row as history (first run: no backfill). */
export function markAllRowsSeen(source, header, data) {
  const keys = rowKeys(header, data);
  for (let idx = 0; idx < data.length; idx++) markRowSeen(source, keys[idx], idx + 2);
  return keys.length;
}

/**
 * A sheet_row value that satisfies the record table's UNIQUE(sheet_row): the
 * row's current position when free, otherwise the next number above anything
 * stored — the position is informational now, row_key is the identity.
 */
export function freeSheetRow(table, sheetRow, extraWhere = '', params = []) {
  const taken = queryOne(`SELECT 1 FROM ${table} WHERE sheet_row = ? ${extraWhere}`, [sheetRow, ...params]);
  if (!taken) return sheetRow;
  const max = queryOne(`SELECT MAX(sheet_row) AS m FROM ${table} WHERE 1=1 ${extraWhere}`, params)?.m || 0;
  return Math.max(max, sheetRow) + 1;
}
