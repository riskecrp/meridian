// Input validation for server actions and bot handlers.
//
// Every mutation should validate at the top and return { ok: false, error }
// rather than letting SQLite throw a constraint error into the browser or a
// Discord interaction. These helpers never throw.

export const SNOWFLAKE = /^\d{17,20}$/;

export function isSnowflake(v) { return SNOWFLAKE.test(String(v ?? '').trim()); }

/** Trimmed string, '' when absent. `max` truncates. */
export function str(v, { max = 0 } = {}) {
  const s = v == null ? '' : String(v).trim();
  return max > 0 ? s.slice(0, max) : s;
}

/** Integer or `def` (null by default). Enforces min/max when given. */
export function toInt(v, { min = null, max = null, def = null } = {}) {
  if (v === '' || v == null) return def;
  const n = typeof v === 'number' ? v : parseInt(String(v).trim(), 10);
  if (!Number.isFinite(n)) return def;
  if (min != null && n < min) return def;
  if (max != null && n > max) return def;
  return n;
}

/** Finite number or `def`. */
export function toNum(v, { def = null } = {}) {
  if (v === '' || v == null) return def;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : def;
}

/** First missing/blank field name from `fields`, or null. */
export function missing(obj, fields) {
  const o = obj && typeof obj === 'object' ? obj : {};
  for (const f of fields) {
    const v = o[f];
    if (v == null || (typeof v === 'string' && v.trim() === '')) return f;
  }
  return null;
}

export function oneOf(v, list, def = null) { return list.includes(v) ? v : def; }

/** { ok:false, error } helper so call sites read `return fail('…')`. */
export function fail(error, extra = {}) { return { ok: false, error, ...extra }; }

// Shared vocabularies. Anything stored in these columns must come from here.
export const TASK_TARGET_TYPES = ['Role', 'User'];
export const TASK_STATUSES = ['open', 'completed', 'removed'];
export const RP_STATUSES = ['PENDING', 'APPROVED', 'RP_DONE', 'EXECUTED', 'DENIED'];
export const RP_TYPES = ['NPC', 'HQ', 'TURF', 'Other'];
export const REVIEW_RECOMMENDATIONS = ['Promote', 'Hold', 'Demote', 'Remove'];
export const REVIEW_STATUSES = ['Pending Discussion', 'Confirmed Promote', 'Confirmed Hold', 'Confirmed Demote', 'Confirmed Remove'];
export const IC_CONTACT_STATUSES = ['pending_discussion', 'pending_roleplay', 'completed'];
export const KB_ENTRY_TYPES = ['lore', 'command'];
export const CHANGE_TYPES = ['drop_location', 'black_market_doctor'];
export const CHANGE_ACTIONS = ['', 'Added', 'Moved', 'Removed'];
export const SCENE_LIBRARY_STATUSES = ['idea', 'approved'];
export const SPAWN_ITEM_TYPES = ['item', 'weapon', 'ammo', 'component', 'attachment', 'vehicle'];
export const DOC_LEVELS = [1, 2, 3];
export const PROPERTY_TYPES = ['Property', 'HQ', 'Warehouse', 'Business', 'Garage', 'Other'];

/** Clamp a document level to 1..3. */
export function docLevel(v) { return toInt(v, { min: 1, max: 3, def: 1 }); }
