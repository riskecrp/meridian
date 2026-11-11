// 026_intake_keys_seeded.mjs
// One-time hand-over flag from the old position counter (last_row) to row keys
// (024). Sources with keys_seeded = 0 mark every row last_row covered as seen
// on their next poll instead of re-posting it — see seedSeenFromLastRow() in
// bot/lib/formIntake.js. The bot also adds these columns on first use.
export default function migrate(db) {
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
  for (const t of ['form_submission_state', 'faction_feedback_state']) {
    if (!has(t, 'keys_seeded')) db.exec(`ALTER TABLE ${t} ADD COLUMN keys_seeded INTEGER NOT NULL DEFAULT 0`);
  }
}
