import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { execFile } from "child_process";
import { promisify } from "util";
import Database from "better-sqlite3";
import { requireActor, requireOwner } from "../../../lib/requireActor.js";
import { logAudit } from "../../../lib/audit.js";
import { getDb, query } from "../../../lib/db.js";
import { buildZip } from "../../../lib/zip.js";
import { isCore, realTableNames, schemaSql, rowCount, tableCSV, csvCell, colsOf, scrub, assertTable, redactDatabaseCopy, TRANSIENT, REDACT } from "../../../lib/handoverExport.js";
import { TABLE_DOCS } from "../../../lib/handoverContent.js";

/*
 * Handover downloads for Admin › Handover and /fm/handover (policy 14).
 * Everything a successor needs to take Meridian elsewhere, as browser
 * downloads (no server access needed):
 *   ?what=db                  a consistent copy of the live database with every
 *                             login token blanked (streamed, then deleted)
 *   ?what=sheets[&scope=all]  zip of one CSV per table + import notes, for Google Sheets
 *   ?what=table&name=<table>  one table as CSV (streamed row by row)
 *   ?what=code                the source at the deployed commit — OWNER only, and
 *                             only on a git checkout; everyone else uses GitHub
 * L3-gated like /api/backup; every download is audit-logged.
 */
export const dynamic = "force-dynamic";
const execFileP = promisify(execFile);

const stamp = () => new Date().toISOString().slice(0, 10);

function attachmentHeaders(filename, type, length) {
  const h = {
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
  if (length != null) h["Content-Length"] = String(length);
  return h;
}

function attachment(buf, filename, type) {
  return new NextResponse(buf, { headers: attachmentHeaders(filename, type, buf.length) });
}

// Stream a temp file to the client and delete it once the stream is done.
function streamFile(tmpPath, filename, type) {
  const size = fs.statSync(tmpPath).size;
  const rs = fs.createReadStream(tmpPath);
  const cleanup = () => { try { fs.unlinkSync(tmpPath); } catch {} };
  rs.on("close", cleanup);
  rs.on("error", cleanup);
  return new NextResponse(Readable.toWeb(rs), { headers: attachmentHeaders(filename, type, size) });
}

const SHEETS_README = (scope, tables) => `Meridian data export — ${new Date().toISOString()}
Scope: ${scope === "all" ? "every table" : "core data (everyday clutter such as pings, tasks, reminders, message and audit logs, logins is left out)"}

WHAT'S IN HERE
  One .csv file per table (${tables.length} tables). A table is one kind of information —
  factions, members, properties, scene logs, and so on. TABLES.csv lists each one with a
  plain-English description, its row count and whether it is in this bundle, so start
  there. schema.sql is the technical column list (tables, indexes and views) for
  developers; you can ignore it.

GETTING A TABLE INTO GOOGLE SHEETS
  1. Open a Google Sheet (new or existing).
  2. File → Import → Upload, pick a .csv file.
  3. Choose "Insert new sheet(s)" and leave the separator on "Detect automatically".
  4. Repeat for each table you want — every CSV becomes its own tab.
  Want all of them at once? Upload this whole folder to Google Drive with
  Settings → "Convert uploaded files to Google Docs editor format" switched on;
  each CSV becomes its own spreadsheet.

DATES AND TIMES
  Columns like created_at are in UTC. A column called epoch_ms is a big number
  (milliseconds since 1970). To turn it into a real date in Sheets, in a new column enter
      =A2/86400000 + DATE(1970,1,1)
  (replace A2 with the epoch_ms cell) and format the cell as a date.

SAFETY
  A cell that starts with = + - or @ has a quote (') put in front of it so a spreadsheet
  never runs it as a formula; remove the quote if you need the raw text.

PRIVACY
  Live login tokens are blanked out («redacted»). Everything else is exactly what the
  dashboard holds, including leadership-only material (documents marked Leadership only,
  leadership notes, intel) — treat the files accordingly.
`;

async function sheetsBundle(scope) {
  const names = realTableNames().filter((n) => scope === "all" || isCore(n));
  const entries = [];
  const index = [["table", "rows", "included", "what it holds"]];
  for (const n of names) {
    entries.push({ name: `${n}.csv`, data: tableCSV(n) });
  }
  for (const n of realTableNames()) {
    const included = scope === "all" || isCore(n);
    index.push([n, String(rowCount(n)), included ? "yes" : "no (transient/log)", TABLE_DOCS[n] || ""]);
  }
  entries.unshift({ name: "TABLES.csv", data: index.map((r) => r.map(csvCell).join(",")).join("\n") });
  entries.unshift({ name: "README.txt", data: SHEETS_README(scope, names) });
  entries.push({ name: "schema.sql", data: schemaSql() });
  return buildZip(entries);
}

// A consistent single-file copy of the live database (VACUUM INTO folds the
// WAL in and drops free pages), with every credential column blanked in the
// COPY before it leaves the box. Returns { tmp, redacted }.
async function redactedDbCopy() {
  const tmp = path.join(os.tmpdir(), `meridian-handover-${process.pid}-${Date.now()}.db`);
  try {
    getDb().prepare("VACUUM INTO ?").run(tmp);
    const copy = new Database(tmp);
    let redacted;
    try { redacted = redactDatabaseCopy(copy); } finally { copy.close(); }
    for (const t of Object.keys(REDACT)) if (!redacted[t]) throw new Error(`Redaction check failed for ${t}`);
    return { tmp, redacted };
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// One table as CSV, streamed row by row so a large log table never sits in memory.
function tableCsvStream(name) {
  const qn = assertTable(name, new Set(realTableNames()));
  const cols = colsOf(name);
  const stmt = getDb().prepare("SELECT * FROM " + qn);
  async function* gen() {
    yield Buffer.from(cols.map(csvCell).join(",") + "\n");
    for (const row of stmt.iterate()) {
      const [r] = scrub(name, [row]);
      yield Buffer.from(cols.map((c) => csvCell(r[c])).join(",") + "\n");
    }
  }
  return Readable.toWeb(Readable.from(gen()));
}

function repoRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

async function codeArchive() {
  const root = repoRoot();
  if (!root) {
    const e = new Error("This install is not a git checkout, so the code can't be bundled here. Get it from the GitHub repository instead.");
    e.status = 503; throw e;
  }
  try { await execFileP("git", ["--version"]); } catch {
    const e = new Error("git is not installed on this server, so the code can't be bundled here. Get it from the GitHub repository instead.");
    e.status = 503; throw e;
  }
  const { stdout } = await execFileP("git", ["archive", "--format=zip", "--prefix=meridian/", "HEAD"], {
    cwd: root, encoding: "buffer", maxBuffer: 512 * 1024 * 1024,
  });
  return stdout;
}

export async function GET(request) {
  let actor;
  try {
    actor = await requireActor(3);
  } catch (e) {
    if (e.code === "AUTH_REQUIRED") {
      const host = request.headers.get("host");
      const proto = host?.includes("localhost") ? "http" : "https";
      return NextResponse.redirect(new URL("/login", `${proto}://${host}`));
    }
    return new NextResponse("Leadership (L3) access required.", { status: 403 });
  }

  const url = new URL(request.url);
  const what = url.searchParams.get("what");
  const scope = url.searchParams.get("scope") === "all" ? "all" : "core";
  try {
    if (what === "sheets") {
      const buf = await sheetsBundle(scope);
      const name = `meridian-sheets-${scope}-${stamp()}.zip`;
      logAudit(actor.id, actor.name, "EXPORT", "handover", null, name, `Downloaded CSV bundle for Sheets (${scope}; ${TRANSIENT.size} transient tables ${scope === "all" ? "included" : "excluded"})`);
      return attachment(buf, name, "application/zip");
    }
    if (what === "db") {
      const { tmp, redacted } = await redactedDbCopy();
      const name = `meridian-${stamp()}.db`;
      const blanked = Object.entries(redacted).map(([t, cols]) => `${t}.${cols.join("/")}`).join(", ");
      logAudit(actor.id, actor.name, "EXPORT", "handover", null, name, `Downloaded database copy (login tokens blanked: ${blanked})`);
      return streamFile(tmp, name, "application/vnd.sqlite3");
    }
    if (what === "table") {
      const table = url.searchParams.get("name") || "";
      if (!realTableNames().includes(table)) return new NextResponse("Unknown table.", { status: 404 });
      const name = `${table}-${stamp()}.csv`;
      logAudit(actor.id, actor.name, "EXPORT", "handover", null, name, `Downloaded table ${table} as CSV (${rowCount(table)} rows${REDACT[table] ? ", tokens redacted" : ""})`);
      return new NextResponse(tableCsvStream(table), { headers: attachmentHeaders(name, "text/csv; charset=utf-8") });
    }
    if (what === "code") {
      try { await requireOwner(); } catch {
        return new NextResponse("The code download is for the site owner only. Everyone else gets the code from the GitHub repository (ask the owner for access).", { status: 403 });
      }
      const buf = await codeArchive();
      const name = `meridian-code-${stamp()}.zip`;
      logAudit(actor.id, actor.name, "EXPORT", "handover", null, name, "Downloaded source code archive");
      return attachment(buf, name, "application/zip");
    }
  } catch (e) {
    console.error("[handover]", e);
    return new NextResponse("Export failed: " + (e.message || e), { status: e.status || 500 });
  }
  return new NextResponse("Unknown export. Use ?what=db|sheets|table|code", { status: 400 });
}
