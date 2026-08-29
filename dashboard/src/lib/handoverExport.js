import { query, queryOne } from "./db.js";

/*
 * Table-level export helpers shared by the handover server actions
 * (fm/handover/actions.js) and the download route (api/handover). Reads only.
 * Live auth tokens are the one thing redacted.
 */

// column values scrubbed from every export (live session tokens)
export const REDACT = { sessions: ["token"], mdb_sessions: ["token"] };
const REDACTED = "«redacted»";

// Transient / operational churn that does NOT need to survive a handover:
// pings, tasks, reminders, message + audit + join/leave logs, bot channel
// state, auth sessions. Everything NOT in this set is core transition data
// (factions, history, properties, npcs, scenes, arsenal, inventory, fleet,
// treasury, staff, config, docs, KB, intel…).
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
  "pending_executions", "deletion_requests", "managed_forum_posts",
]);
export const isCore = (name) => !TRANSIENT.has(name);

export function realTableNames() {
  return query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).map((r) => r.name);
}

export function tableSql() {
  return query(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
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

// ── formatters ──
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
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
export function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return "X'" + v.toString("hex") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}
