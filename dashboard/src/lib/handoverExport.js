import { query, queryOne } from "./db.js";

/*
 * Table-level export helpers shared by the handover server actions
 * (fm/handover/actions.js) and the download route (api/handover). Reads only.
 * Live auth tokens are the one thing redacted; CSV cells are guarded against
 * spreadsheet formula injection.
 */

// column values scrubbed from every text export (live session tokens)
export const REDACT = { sessions: ["token"], mdb_sessions: ["token"] };
const REDACTED = "«redacted»";

// Any column whose name looks like a credential is blanked in the .db copy,
// on top of the static REDACT map (so a new token column is never shipped).
export const SECRET_COLUMN = /(^|_)(token|secret|password|api_?key)(s|_hash)?($|_)/i;

// Hard cap on rows a server action hands to the browser in one go. Bigger
// tables go through /api/handover?what=table (a real download).
export const MAX_ACTION_ROWS = 20000;

// Transient / operational churn that does NOT need to survive a handover:
// pings, tasks, reminders, message + audit + join/leave logs, bot channel
// state, auth sessions. Everything NOT in this set is core transition data
// (factions, history, properties, npcs, scenes, arsenal, inventory, fleet,
// treasury, staff, config, docs, KB, intel, the RP-change pipeline, managed
// forum posts…).
export const TRANSIENT = new Set([
  "discord_messages", "edited_message_logs", "deleted_message_logs",
  "mentions", "role_mentions", "watch_role_mentions",
  "member_join_leave_logs", "site_audit_log",
  "tasks", "task_log", "task_questions",
  "reminders", "recurring_reminders", "recurring_reminder_instances",
  "sent_recurring_reminders", "reminder_purge_channels",
  "channel_sync_state", "channel_purge_schedules", "auto_delete_channels",
  "conversation_summaries", "forwarded_dms",
  "keyword_alerts", "server_log_keywords", "bot_watch_roles",
  "sessions", "mdb_sessions",
  "deletion_requests",
]);
export const isCore = (name) => !TRANSIENT.has(name);

export function realTableNames() {
  return query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).map((r) => r.name);
}

// The whole schema — tables, then indexes, views and triggers — as one SQL
// text, so a restore has the unique indexes and the views the dashboard reads.
export function schemaSql() {
  const rows = query(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name"
  );
  return rows.map((r) => r.sql.trim() + ";").join("\n\n") + "\n";
}

export const q = (name) => '"' + name.replace(/"/g, '""') + '"';

// table name can't be a bound parameter, so validate against the live list and
// escape any embedded quote before interpolating.
export function assertTable(name, allowed) {
  if (!allowed.has(name)) throw new Error("Unknown table: " + name);
  return q(name);
}

export function colsOf(table) {
  return query("SELECT name FROM pragma_table_info(?) ORDER BY cid", [table]).map((r) => r.name);
}

export function rowCount(table) {
  return queryOne("SELECT COUNT(*) AS c FROM " + q(table)).c;
}

export function scrub(table, rows) {
  const cols = REDACT[table];
  if (!cols) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const c of cols) if (c in copy) copy[c] = REDACTED;
    return copy;
  });
}

export function tableRows(table) {
  return scrub(table, query("SELECT * FROM " + q(table)));
}

// Blank every credential-looking column in a database COPY (never the live
// file): the static REDACT map plus any column matching SECRET_COLUMN, in
// every table. Unique / primary-key columns get a per-row placeholder so the
// constraints still hold. secure_delete + VACUUM make sure the old bytes do
// not linger in free pages. Returns { table: [columns] } of what was blanked.
export function redactDatabaseCopy(copy) {
  const done = {};
  copy.pragma("secure_delete = ON");
  const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  const tx = copy.transaction(() => {
    for (const t of tables) {
      const cols = copy.prepare("SELECT name FROM pragma_table_info(?)").all(t).map((r) => r.name);
      const hit = cols.filter((c) => (REDACT[t] || []).includes(c) || SECRET_COLUMN.test(c));
      if (!hit.length) continue;
      const sets = hit.map((c) => q(c) + " = 'redacted-' || rowid").join(", ");
      copy.prepare("UPDATE " + q(t) + " SET " + sets).run();
      done[t] = hit;
    }
  });
  tx();
  copy.exec("VACUUM");
  return done;
}

// ── formatters ──
// A cell starting with = + - @ (or a tab / CR) would be run as a formula by
// Google Sheets / Excel, so it is prefixed with a quote. Faction names, notes
// and messages are user-supplied, hence the guard.
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(cols, rows) {
  const head = cols.map(csvCell).join(",");
  if (!rows.length) return head;
  return head + "\n" + rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\n");
}
export function tableCSV(table) {
  const rows = tableRows(table);
  const cols = rows.length ? Object.keys(rows[0]) : colsOf(table);
  return toCSV(cols, rows);
}
