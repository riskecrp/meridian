// 016_dates_iso.mjs
// One date format. The Sheets era left "31/OCT/2026", "14/SEPT/2026",
// "30/01/2026, 23:07" and epoch strings in columns that other rows hold as ISO,
// so every ORDER BY on them was a string sort. Timestamps become full ISO,
// calendar dates become YYYY-MM-DD, faction_history.created_at becomes the
// SQLite datetime shape its newer rows already use. Unparseable values are left
// untouched and listed.
import { toIso, toSqlite, toDateOnly } from '../shared/dates.js';

export default function migrate(db) {
  const convert = (table, col, fn) => {
    const rows = db.prepare(`SELECT rowid AS rid, ${col} AS v FROM ${table}`).all();
    const upd = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`);
    let changed = 0; const left = [];
    for (const r of rows) {
      if (r.v == null || r.v === '') continue;
      const out = fn(r.v);
      if (out == null) { left.push(r.v); continue; }
      if (out !== r.v) { upd.run(out, r.rid); changed++; }
    }
    console.log(`  ${table}.${col}: ${changed} converted${left.length ? `, ${left.length} left as-is (${[...new Set(left)].slice(0, 3).join(', ')})` : ''}`);
  };
  convert('tasks', 'created_at', toIso);
  convert('task_log', 'created_at', toIso);
  convert('task_questions', 'asked_at', toIso);
  convert('task_questions', 'answered_at', toIso);
  convert('scene_logs', 'date', toDateOnly);
  convert('intel_notes', 'date', toDateOnly);
  convert('ooc_notes', 'date', toDateOnly);
  convert('inventory_logs', 'date', toDateOnly);
  convert('treasury_logs', 'date', toDateOnly);
  convert('pending_executions', 'date', toDateOnly);
  convert('factions', 'last_promoted', toDateOnly);
  convert('properties', 'date_given', toDateOnly);
  convert('properties', 'date_confiscated', toDateOnly);
  convert('faction_history', 'created_at', toSqlite);
}
