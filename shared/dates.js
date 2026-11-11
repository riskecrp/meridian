// One date vocabulary for the whole system.
//
// Storage: ISO 8601 UTC. Timestamps are `new Date().toISOString()`
// ("2026-11-10T19:46:28.000Z"); calendar dates are "YYYY-MM-DD". SQLite's own
// `datetime('now')` ("YYYY-MM-DD HH:MM:SS") sorts correctly next to both.
//
// The Sheets era left four other formats in the database ("31/OCT/2026",
// "14/SEPT/2026", "30/01/2026, 23:07", epoch strings). parseDate() reads every
// one of them so old rows and new rows compare, and migration 016 rewrites the
// stored values. Display formatting is the UI's job (legacyDate() gives the
// familiar DD/MON/YYYY look); nothing should write a legacy format again.

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_ALIASES = { SEPT: 'SEP', JUNE: 'JUN', JULY: 'JUL', MARC: 'MAR', APRI: 'APR' };

function monthIndex(token) {
  const up = String(token).toUpperCase();
  const key = MONTH_ALIASES[up.slice(0, 4)] || up.slice(0, 3);
  return MONTHS.indexOf(key);
}

/** Parse any date format Meridian has ever stored. Returns a Date or null. */
export function parseDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  const s = String(value).trim();
  let m;
  if (/^\d{12,14}$/.test(s)) return new Date(Number(s));                       // epoch ms as text
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d; }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)))
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  if ((m = s.match(/^(\d{1,2})\/([A-Za-z]{3,5})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?$/))) {
    const mi = monthIndex(m[2]);
    if (mi < 0) return null;
    return new Date(Date.UTC(+m[3], mi, +m[1], +(m[4] || 0), +(m[5] || 0)));
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?$/)))      // en-GB locale strings, day first
    return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function nowIso() { return new Date().toISOString(); }
export function todayIso() { return nowIso().slice(0, 10); }
export function nowSqlite() { return nowIso().slice(0, 19).replace('T', ' '); }

/** Full ISO timestamp, or null when unparseable. */
export function toIso(value) { const d = parseDate(value); return d ? d.toISOString() : null; }
/** "YYYY-MM-DD HH:MM:SS" (SQLite datetime shape), or null. */
export function toSqlite(value) { const d = parseDate(value); return d ? d.toISOString().slice(0, 19).replace('T', ' ') : null; }
/** "YYYY-MM-DD", or null. */
export function toDateOnly(value) { const d = parseDate(value); return d ? d.toISOString().slice(0, 10) : null; }
export function isIsoLike(value) { return /^\d{4}-\d{2}-\d{2}/.test(String(value ?? '')); }

/** The familiar DD/MON/YYYY look, for display only. Unparseable input is echoed back. */
export function legacyDate(value) {
  const d = parseDate(value);
  if (!d) return value == null ? '' : String(value);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
}

/** "YYYY-MM" of a date, for review months and reports. */
export function monthKey(value = new Date()) { const d = parseDate(value); return d ? d.toISOString().slice(0, 7) : ''; }
