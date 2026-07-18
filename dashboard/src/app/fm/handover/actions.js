"use server";
import { query, queryOne } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";

/*
 * Full-database export for the handover page. L3-only (FM Leadership / Game
 * Affairs Management). Reads every user table so the successor keeps all the
 * data (properties, npcs, inventory, treasury, …) even if they drop the
 * dashboard. Live auth tokens are the only thing redacted.
 */

// column values scrubbed from every export (live session tokens)
const REDACT = { sessions: ["token"], mdb_sessions: ["token"] };
const REDACTED = "«redacted»";

// Transient / operational churn that does NOT need to survive the handover:
// pings, tasks, reminders, message + audit + join/leave logs, bot channel
// state, auth sessions. Everything NOT in this set is treated as core
// transition data (factions, history, properties, npcs, scenes, arsenal,
// inventory, fleet, treasury, staff, config, docs, KB, intel…) and is what the
// "Full database" bundle exports.
const TRANSIENT = new Set([
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
const isCore = (name) => !TRANSIENT.has(name);

function realTableNames() {
  return query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).map((r) => r.name);
}

// table name can't be a bound parameter, so validate against the live list and
// escape any embedded quote before interpolating.
function assertTable(name, allowed) {
  if (!allowed.has(name)) throw new Error("Unknown table: " + name);
  return '"' + name.replace(/"/g, '""') + '"';
}

function colsOf(table) {
  return query("SELECT name FROM pragma_table_info(?) ORDER BY cid", [table]).map((r) => r.name);
}

function scrub(table, rows) {
  const cols = REDACT[table];
  if (!cols) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    for (const c of cols) if (c in copy) copy[c] = REDACTED;
    return copy;
  });
}

// ── formatters ──
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(cols, rows) {
  const head = cols.map(csvCell).join(",");
  if (!rows.length) return head;
  return head + "\n" + rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\n");
}
function sqlLiteral(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (Buffer.isBuffer(v)) return "X'" + v.toString("hex") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// ── public actions ──
export async function listTables() {
  await requireActor(3);
  const names = realTableNames();
  return names.map((name) => ({
    name,
    rows: queryOne('SELECT COUNT(*) AS c FROM "' + name.replace(/"/g, '""') + '"').c,
    redacted: !!REDACT[name],
    core: isCore(name),
  }));
}

// One table → copyable text. `limit` caps the inline preview; total is reported
// so the UI can flag truncation (full data is always available via download).
export async function getTableExport(tableName, format = "csv", limit = 0) {
  await requireActor(3);
  const allowed = new Set(realTableNames());
  const q = assertTable(tableName, allowed);
  const total = queryOne("SELECT COUNT(*) AS c FROM " + q).c;
  const rows = scrub(tableName, query("SELECT * FROM " + q + (limit > 0 ? " LIMIT " + Number(limit) : "")));
  const cols = rows.length ? Object.keys(rows[0]) : colsOf(tableName);
  const text = format === "json" ? JSON.stringify(rows, null, 2) : toCSV(cols, rows);
  return { text, returned: rows.length, total, cols };
}

// Curated handover bundle in one artifact — CORE transition tables only
// (transient churn is excluded; pass scope="all" to include everything).
//  - "sql":  CREATE TABLE + INSERTs, rebuildable with `sqlite3 new.db < dump.sql`
//  - "json": { tables: { tableName: [ ...rows ] } }
export async function getFullDump(format = "sql", scope = "core") {
  const actor = await requireActor(3);
  const all = query(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const master = scope === "all" ? all : all.filter((t) => isCore(t.name));
  const excluded = scope === "all" ? [] : all.filter((t) => !isCore(t.name)).map((t) => t.name);
  const stamp = new Date().toISOString();

  if (format === "json") {
    const out = {};
    for (const t of master) {
      out[t.name] = scrub(t.name, query('SELECT * FROM "' + t.name.replace(/"/g, '""') + '"'));
    }
    return JSON.stringify({ _exportedAt: stamp, _exportedBy: actor.name, _scope: scope, _excludedTables: excluded, tables: out }, null, 2);
  }

  const lines = [
    "-- Meridian handover export (SQL) — scope: " + scope,
    "-- Generated: " + stamp + " by " + actor.name,
    "-- Rebuild with:  sqlite3 meridian-restored.db < this-file.sql",
    "-- Redacted: sessions.token / mdb_sessions.token.",
    excluded.length ? "-- Excluded (transient/logs): " + excluded.join(", ") : "-- Scope: all tables.",
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
    "",
  ];
  for (const t of master) {
    const q = '"' + t.name.replace(/"/g, '""') + '"';
    const cols = colsOf(t.name);
    const rows = scrub(t.name, query("SELECT * FROM " + q));
    lines.push("-- " + t.name + " (" + rows.length + " rows)");
    if (t.sql) lines.push(t.sql.trim() + ";");
    const colList = cols.map((c) => '"' + c.replace(/"/g, '""') + '"').join(", ");
    for (const row of rows) {
      lines.push(
        "INSERT INTO " + q + " (" + colList + ") VALUES (" + cols.map((c) => sqlLiteral(row[c])).join(", ") + ");"
      );
    }
    lines.push("");
  }
  lines.push("COMMIT;");
  return lines.join("\n");
}
