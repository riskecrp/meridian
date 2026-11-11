// 018_ids_and_integrity.mjs
// Key by id where the Sheets era keyed by name, and give the workflows the
// columns they were tracking in prose:
//   treasury_logs.faction_id, staff_coi.faction_id   (backfilled from name,
//     alias, or a RENAME row in faction_history)
//   faction_reviews.feedback_sent_at / _by            (replaces an audit-log lookup
//     keyed on faction name)
//   pending_executions.npc_id / contact_id           (which NPC a request is about,
//     which IC contact raised it)
//   leadership_personal_notes: one note per L3 per faction per month (older
//     duplicates are merged into the newest, nothing is dropped)
//   staff.active                                      (soft retire)
export default function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
  const add = (table, col, ddl) => { if (!has(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); };

  // ── name -> id map, including aliases and past names ──
  const map = new Map();
  const put = (name, id) => { const k = String(name || '').trim().toLowerCase(); if (k && !map.has(k)) map.set(k, id); };
  for (const f of db.prepare("SELECT id, name, aliases FROM factions").all()) {
    put(f.name, f.id);
    for (const a of String(f.aliases || '').split(',')) put(a, f.id);
  }
  for (const h of db.prepare("SELECT faction_id, details FROM faction_history WHERE action_type = 'RENAME' AND faction_id IS NOT NULL").all()) {
    const m = /^(.*?)\s*(?:→|->)\s*(.*)$/.exec(h.details || '');
    if (m) put(m[1], h.faction_id);
  }
  const idFor = (name) => map.get(String(name || '').trim().toLowerCase()) ?? null;

  add('treasury_logs', 'faction_id', 'INTEGER REFERENCES factions(id) ON DELETE SET NULL');
  add('staff_coi', 'faction_id', 'INTEGER REFERENCES factions(id) ON DELETE SET NULL');
  for (const table of ['treasury_logs', 'staff_coi']) {
    const upd = db.prepare(`UPDATE ${table} SET faction_id = ? WHERE id = ?`);
    let n = 0, miss = [];
    for (const r of db.prepare(`SELECT id, faction_name FROM ${table} WHERE faction_id IS NULL`).all()) {
      const id = idFor(r.faction_name);
      if (id) { upd.run(id, r.id); n++; } else miss.push(r.faction_name);
    }
    console.log(`  ${table}.faction_id: ${n} linked${miss.length ? `, unmatched: ${[...new Set(miss)].join(', ')}` : ''}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_treasury_faction ON treasury_logs(faction_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_staff_coi_faction ON staff_coi(faction_id)");

  add('faction_reviews', 'feedback_sent_at', 'TEXT');
  add('faction_reviews', 'feedback_sent_by', "TEXT NOT NULL DEFAULT ''");
  // Backfill from the audit rows the old code wrote when feedback went out
  // (target_type 'feedback_sent', labelled by faction name). Feedback covers the
  // most recent review on or before the month it was sent, so match that one.
  const sent = db.prepare(`SELECT timestamp, actor_name, target_label FROM site_audit_log WHERE target_type = 'feedback_sent' ORDER BY timestamp`).all();
  const pick = db.prepare("SELECT id FROM faction_reviews WHERE faction_id = ? AND review_month <= ? AND feedback_sent_at IS NULL ORDER BY review_month DESC LIMIT 1");
  const setSent = db.prepare("UPDATE faction_reviews SET feedback_sent_at = ?, feedback_sent_by = ? WHERE id = ?");
  let back = 0;
  for (const a of sent) {
    const id = idFor(a.target_label);
    if (!id) continue;
    const row = pick.get(id, String(a.timestamp).slice(0, 7));
    if (row) back += setSent.run(a.timestamp, a.actor_name, row.id).changes;
  }
  console.log(`  faction_reviews.feedback_sent_*: ${back} backfilled from audit rows`);

  add('pending_executions', 'npc_id', 'INTEGER');
  add('pending_executions', 'contact_id', 'INTEGER');
  add('pending_executions', 'resolved_at', 'TEXT');

  // One leadership note per author per faction per month: merge, never drop.
  const dups = db.prepare(`SELECT faction_id, author_id, review_month, COUNT(*) n FROM leadership_personal_notes GROUP BY faction_id, author_id, review_month HAVING n > 1`).all();
  for (const d of dups) {
    const rows = db.prepare("SELECT id, note, status, created_at FROM leadership_personal_notes WHERE faction_id = ? AND author_id = ? AND review_month = ? ORDER BY created_at ASC, id ASC").all(d.faction_id, d.author_id, d.review_month);
    const keep = rows[rows.length - 1];
    const merged = rows.map(r => r.note).filter(Boolean).join('\n\n');
    db.prepare("UPDATE leadership_personal_notes SET note = ? WHERE id = ?").run(merged, keep.id);
    db.prepare(`DELETE FROM leadership_personal_notes WHERE id IN (${rows.slice(0, -1).map(r => r.id).join(',')})`).run();
  }
  if (dups.length) console.log(`  leadership_personal_notes: ${dups.length} duplicate vote(s) merged`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_lpn_vote ON leadership_personal_notes(faction_id, author_id, review_month)");

  add('staff', 'active', 'INTEGER NOT NULL DEFAULT 1');
  add('faction_ic_contacts', 'rp_change_id', 'INTEGER');

  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_actor ON site_audit_log(actor_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_target ON site_audit_log(target_type, target_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_scene_logs_author ON scene_logs(author_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mentions_target ON mentions(target_user_id, is_read)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_keyword_alerts_guild ON keyword_alerts(guild_id)");
}
