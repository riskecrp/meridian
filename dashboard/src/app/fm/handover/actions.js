"use server";
import { query } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";
import { REDACT, isCore, realTableNames, assertTable, colsOf, rowCount, scrub, toCSV, MAX_ACTION_ROWS } from "../../../lib/handoverExport.js";
import { toInt, oneOf } from "../../../../../shared/validate.js";

/*
 * Per-table previews for the handover pages (/fm/handover and the v2 Admin ›
 * Handover view). L3-only (FM Leadership / Game Affairs Management). The real
 * downloads — the .db copy, the CSV bundle and single-table CSVs — are served
 * by /api/handover as attachments (policy 14); these actions only feed the
 * on-page table list and the capped inline preview.
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

// One table → copyable text. `limit` caps the inline preview (default and
// maximum MAX_ACTION_ROWS); `total` is reported so the UI can flag truncation,
// and `downloadUrl` is where the full table comes from.
export async function getTableExport(tableName, format = "csv", limit = 0) {
  await requireActor(3);
  const allowed = new Set(realTableNames());
  const qn = assertTable(String(tableName ?? ""), allowed);
  const fmt = oneOf(format, ["csv", "json"], "csv");
  const lim = Math.min(toInt(limit, { min: 1, def: MAX_ACTION_ROWS }), MAX_ACTION_ROWS);
  const total = rowCount(tableName);
  const rows = scrub(tableName, query("SELECT * FROM " + qn + " LIMIT " + lim));
  const cols = rows.length ? Object.keys(rows[0]) : colsOf(tableName);
  const text = fmt === "json" ? JSON.stringify(rows, null, 2) : toCSV(cols, rows);
  return {
    text, returned: rows.length, total, cols, truncated: total > rows.length,
    downloadUrl: `/api/handover?what=table&name=${encodeURIComponent(tableName)}`,
  };
}
