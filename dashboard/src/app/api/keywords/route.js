import { NextResponse } from 'next/server';
import { requireActor } from '../../../lib/requireActor.js';
import { query, run } from '../../../lib/db.js';


async function guard() {
  const actor = await requireActor(1);
  if (actor.level < 3) throw new Error('denied');
}

export async function GET() {
  try {
    await guard();
    return NextResponse.json(query("SELECT id, phrase, created_at FROM server_log_keywords ORDER BY id DESC"));
  } catch { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
}

export async function POST(req) {
  try {
    await guard();
    const { phrase } = await req.json();
    if (!phrase?.trim()) return NextResponse.json({ error: 'Phrase required.' }, { status: 400 });
    run("INSERT OR IGNORE INTO server_log_keywords (phrase) VALUES (?)", [phrase.trim().toLowerCase()]);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: e.message === 'denied' ? 401 : 500 }); }
}

export async function DELETE(req) {
  try {
    await guard();
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: 'ID required.' }, { status: 400 });
    run("DELETE FROM server_log_keywords WHERE id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 }); }
}
