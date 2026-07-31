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

// ── Thread titles ──────────────────────────────────────────────────────────────
//
// The status lives in the thread NAME, so the channel list shows where every item
// stands without opening any of them. Both intakes use the same ladder, so the
// tags live here and stay consistent between them.

const THREAD_NAME_LIMIT = 100;

export const STATUS_TAGS = {
  new: '[Pending Acknowledgement]',   // nobody has picked it up yet
  claimed: '[Pending Review]',        // acknowledged, the outcome is outstanding
  completed: '[Completed]',
  cancelled: '[Cancelled]',
};

// Longest first, so '[Pending Acknowledgement]' is never half-matched by a
// shorter tag when a title is being re-tagged.
const ALL_TAGS = [...new Set(Object.values(STATUS_TAGS))].sort((a, b) => b.length - a.length);

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
  const parts = [];
  const used = new Set();
  for (const pattern of form.title || []) {
    const hit = valueByHeader(header, row, pattern);
    if (hit && !used.has(hit.index)) { parts.push(hit.value); used.add(hit.index); }
  }
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
  let contact = null;
  for (const pattern of form.contact || []) {
    contact = valueByHeader(header, row, pattern)?.value;
    if (contact) break;
  }
  return {
    title: parts.join(' · ') || 'Untitled submission',
    contact: contact || 'not provided',
  };
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

/**
 * Read a response sheet as CSV.
 *
 * Returns `{ rows }` or `{ error }` — never throws and never returns partial
 * rows, because every failure mode here looks like an empty sheet to a careless
 * caller, and an empty sheet is indistinguishable from "nothing new" right up
 * until the poller decides it has caught up.
 *
 * The HTML check is the important one: a sheet that is not link-viewable answers
 * a CSV request with a sign-in page, HTTP 200 and all. Parsing that as CSV would
 * quietly look like a sheet that had suddenly gone empty.
 */
export async function fetchSheetRows(sheetId, gid) {
  let text;
  try {
    const res = await fetch(sheetCsvUrl(sheetId, gid), { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      return { error: res.status === 401 || res.status === 403
        ? 'the sheet is not shared — set it to "Anyone with the link can view"'
        : `the sheet returned HTTP ${res.status}` };
    }
    text = await res.text();
  } catch (e) {
    return { error: `could not reach the sheet (${e.message})` };
  }
  if (/^\s*<!doc|^\s*<html/i.test(text)) {
    return { error: 'the sheet is not shared — set it to "Anyone with the link can view"' };
  }
  return { rows: parseCsv(text) };
}
