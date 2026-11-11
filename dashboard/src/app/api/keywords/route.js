import { NextResponse } from 'next/server';
import { query, queryOne, run } from '../../../lib/db.js';
import { logAudit } from '../../../lib/audit.js';
import { str, toInt } from '../../../../../shared/validate.js';
import { requireLeadership, safeJson } from '../memberlog/gate.js';

export const dynamic = 'force-dynamic';

// The monitored-phrase list the bot matches every message against
// (server_log_keywords; the bot's /triggerword command writes the same table).
// Add/remove are audited like any other site mutation.

async function body(req) {
  try { return (await req.json()) || {}; } catch { return {}; }
}

export async function GET() {
  const g = await requireLeadership();
  if (g.response) return g.response;
  return safeJson(() => query("SELECT id, phrase, created_at FROM server_log_keywords ORDER BY id DESC"));
}

export async function POST(req) {
  const g = await requireLeadership();
  if (g.response) return g.response;
  const { actor } = g;
  const phrase = str((await body(req)).phrase, { max: 200 }).toLowerCase();
  if (!phrase) return NextResponse.json({ error: 'Phrase required.' }, { status: 400 });
  if (phrase.length < 2) return NextResponse.json({ error: 'Phrase must be at least 2 characters.' }, { status: 400 });
  const dupe = queryOne("SELECT id, phrase FROM server_log_keywords WHERE phrase = ? COLLATE NOCASE", [phrase]);
  if (dupe) return NextResponse.json({ error: `"${dupe.phrase}" is already monitored.`, id: dupe.id }, { status: 409 });
  try {
    const r = run("INSERT INTO server_log_keywords (phrase) VALUES (?)", [phrase]);
    logAudit(actor.id, actor.name, 'CREATE', 'keyword', r.lastInsertRowid, phrase, 'Monitored phrase added');
    return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid), phrase });
  } catch (e) {
    console.error('[api/keywords] POST', e.message);
    return NextResponse.json({ error: 'Could not save the phrase.' }, { status: 500 });
  }
}

export async function DELETE(req) {
  const g = await requireLeadership();
  if (g.response) return g.response;
  const { actor } = g;
  const id = toInt((await body(req)).id, { min: 1 });
  if (!id) return NextResponse.json({ error: 'ID required.' }, { status: 400 });
  const row = queryOne("SELECT id, phrase FROM server_log_keywords WHERE id = ?", [id]);
  if (!row) return NextResponse.json({ error: 'Keyword not found.' }, { status: 404 });
  run("DELETE FROM server_log_keywords WHERE id = ?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'keyword', id, row.phrase, 'Monitored phrase removed');
  return NextResponse.json({ ok: true });
}
