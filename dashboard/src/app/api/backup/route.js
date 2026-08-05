import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireActor } from "../../../lib/requireActor.js";
import { logAudit } from "../../../lib/audit.js";

// Self-serve download of the latest nightly database backup, so the team can
// get a full copy of Meridian's data without server access. Deliberately not
// linked anywhere in the UI — the URL lives in the README. Leadership-gated:
// the file contains everything, including confidential leadership material.
export const dynamic = "force-dynamic";

export async function GET(request) {
  let actor;
  try {
    actor = await requireActor(3);
  } catch (e) {
    if (e.code === "AUTH_REQUIRED") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return new NextResponse("Leadership (L3) access required.", { status: 403 });
  }

  const dbPath = process.env.DATABASE_PATH || "";
  const backupsDir = path.join(path.dirname(dbPath), "backups");
  let latest = null;
  try {
    latest = fs.readdirSync(backupsDir)
      .filter(f => /^meridian-.*\.db\.gz$/.test(f))
      .sort()
      .pop() || null;
  } catch {}
  if (!latest) {
    return new NextResponse("No backup file found — contact the operator.", { status: 404 });
  }

  logAudit(actor.id, actor.name, "EXPORT", "backup", null, latest, "Downloaded nightly DB backup");

  const file = fs.readFileSync(path.join(backupsDir, latest));
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${latest}"`,
      "Content-Length": String(file.length),
      "Cache-Control": "no-store",
    },
  });
}
