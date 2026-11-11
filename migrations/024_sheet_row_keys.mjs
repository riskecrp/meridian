// 024_sheet_row_keys.mjs
// Intake rows are identified by a stable key (the form response's timestamp,
// plus its order among same-second responses) instead of their position in the
// sheet, so deleting or reordering sheet rows neither re-posts nor hides
// anything. The bot creates these on first poll too; this keeps bootstrap and
// schema.sql in step. Existing records keep row_key NULL.
export default function migrate(db) {
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
  const add = (t, c, ddl) => { if (!has(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`); };
  add('faction_feedback', 'row_key', 'TEXT');
  add('form_submissions', 'row_key', 'TEXT');
  add('faction_feedback_failures', 'row_key', 'TEXT');
  add('form_submission_failures', 'row_key', 'TEXT');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_faction_feedback_row_key ON faction_feedback(row_key) WHERE row_key IS NOT NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_form_submissions_row_key ON form_submissions(form_key, row_key) WHERE row_key IS NOT NULL");
  db.exec(`CREATE TABLE IF NOT EXISTS sheet_rows_seen (
    source    TEXT NOT NULL,
    row_key   TEXT NOT NULL,
    sheet_row INTEGER NOT NULL DEFAULT 0,
    record_id INTEGER,
    seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (source, row_key)
  )`);
}
