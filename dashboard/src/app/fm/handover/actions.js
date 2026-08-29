"use server";
import { query } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";
import { REDACT, isCore, realTableNames, tableSql, q, assertTable, colsOf, rowCount, scrub, toCSV, sqlLiteral } from "../../../lib/handoverExport.js";

/*
 * Full-database export for the handover pages (/fm/handover and the v2 Admin
 * › Handover view). L3-only (FM Leadership / Game Affairs Management). Reads
 * every user table so the successor keeps all the data even if they drop the
 * dashboard. Live auth tokens are the only thing redacted. The table helpers
 * live in lib/handoverExport.js, shared with the api/handover download route.
 */

// ── public actions ──
export async function listTables() {
  await requireActor(3);
  return realTableNames().map((name) => ({
    name,
    rows: rowCount(name),
    redacted: !!REDACT[name],
    core: isCore(name),
  }));
}

// One table → copyable text. `limit` caps the inline preview; total is reported
// so the UI can flag truncation (full data is always available via download).
export async function getTableExport(tableName, format = "csv", limit = 0) {
  await requireActor(3);
  const allowed = new Set(realTableNames());
  const qn = assertTable(tableName, allowed);
  const total = rowCount(tableName);
  const rows = scrub(tableName, query("SELECT * FROM " + qn + (limit > 0 ? " LIMIT " + Number(limit) : "")));
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
  const all = tableSql();
  const master = scope === "all" ? all : all.filter((t) => isCore(t.name));
  const excluded = scope === "all" ? [] : all.filter((t) => !isCore(t.name)).map((t) => t.name);
  const stamp = new Date().toISOString();

  if (format === "json") {
    const out = {};
    for (const t of master) {
      out[t.name] = scrub(t.name, query("SELECT * FROM " + q(t.name)));
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
    const qn = q(t.name);
    const cols = colsOf(t.name);
    const rows = scrub(t.name, query("SELECT * FROM " + qn));
    lines.push("-- " + t.name + " (" + rows.length + " rows)");
    if (t.sql) lines.push(t.sql.trim() + ";");
    const colList = cols.map((c) => '"' + c.replace(/"/g, '""') + '"').join(", ");
    for (const row of rows) {
      lines.push(
        "INSERT INTO " + qn + " (" + colList + ") VALUES (" + cols.map((c) => sqlLiteral(row[c])).join(", ") + ");"
      );
    }
    lines.push("");
  }
  lines.push("COMMIT;");
  return lines.join("\n");
}
