import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireActor } from "../../../lib/requireActor.js";
import { logAudit } from "../../../lib/audit.js";
import { getDb } from "../../../lib/db.js";
import { buildZip } from "../../../lib/zip.js";
import { isCore, realTableNames, tableSql, rowCount, tableCSV, TRANSIENT } from "../../../lib/handoverExport.js";
import { TABLE_DOCS } from "../../../lib/handoverContent.js";

/*
 * Handover downloads for Admin › Handover. Everything a successor needs to
 * take Meridian elsewhere, as browser downloads (no server access needed):
 *   ?what=sheets[&scope=all]  zip of one CSV per table + import notes, for Google Sheets
 *   ?what=db                  a consistent copy of the live database (plain .db, not gzipped)
 *   ?what=code                the source code at the deployed commit (git archive)
 * L3-gated like /api/backup; every download is audit-logged.
 */
export const dynamic = "force-dynamic";
const execFileP = promisify(execFile);

const stamp = () => new Date().toISOString().slice(0, 10);

function attachment(buf, filename, type) {
  return new NextResponse(buf, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}

const SHEETS_README = (scope, tables) => `Meridian data export — ${new Date().toISOString()}
Scope: ${scope === "all" ? "every table" : "core data (everyday clutter such as pings, tasks, reminders, message and audit logs, logins is left out)"}

WHAT'S IN HERE
  One .csv file per table (${tables.length} tables). A table is one kind of information —
  factions, members, properties, scene logs, and so on. TABLES.csv lists each one with a
  plain-English description and its row count, so start there. schema.sql is the technical
  column list for developers; you can ignore it.

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

PRIVACY
  Live login tokens are blanked out («redacted»). Everything else is exactly what the
  dashboard holds, including leadership-only material — treat the files accordingly.
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
  const csvEsc = (s) => (/[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  entries.unshift({ name: "TABLES.csv", data: index.map((r) => r.map(csvEsc).join(",")).join("\n") });
  entries.unshift({ name: "README.txt", data: SHEETS_README(scope, names) });
  entries.push({ name: "schema.sql", data: tableSql().map((t) => (t.sql || "").trim() + ";").join("\n\n") + "\n" });
  return buildZip(entries);
}

async function liveDbCopy() {
  const tmp = path.join(os.tmpdir(), `meridian-handover-${process.pid}-${Date.now()}.db`);
  try {
    await getDb().backup(tmp);
    return fs.readFileSync(tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
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
  if (!root) throw new Error("This install is not a git checkout, so the code can't be bundled here. Get it from GitHub instead.");
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
      const buf = await liveDbCopy();
      const name = `meridian-${stamp()}.db`;
      logAudit(actor.id, actor.name, "EXPORT", "handover", null, name, "Downloaded live database copy");
      return attachment(buf, name, "application/vnd.sqlite3");
    }
    if (what === "code") {
      const buf = await codeArchive();
      const name = `meridian-code-${stamp()}.zip`;
      logAudit(actor.id, actor.name, "EXPORT", "handover", null, name, "Downloaded source code archive");
      return attachment(buf, name, "application/zip");
    }
  } catch (e) {
    console.error("[handover]", e);
    return new NextResponse("Export failed: " + (e.message || e), { status: 500 });
  }
  return new NextResponse("Unknown export. Use ?what=sheets|db|code", { status: 400 });
}
