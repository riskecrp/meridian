// 017_tasks_keep_history.mjs
// Completing a task used to DELETE its row, which orphaned its questions,
// broke every link to it and double-counted repeat completions. Tasks now carry
// a status and completion details. Every task that was deleted is rebuilt from
// its task_log trail (CREATED / COMPLETED rows) so history and the 14 orphaned
// questions have a row to belong to again.
import { toIso } from '../shared/dates.js';

export default function migrate(db) {
  const cols = () => db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
  const add = (name, ddl) => { if (!cols().includes(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${ddl}`); };
  add('status', "TEXT NOT NULL DEFAULT 'open'");
  add('completed_at', 'TEXT');
  add('completed_by_id', "TEXT NOT NULL DEFAULT ''");
  add('completed_by_name', "TEXT NOT NULL DEFAULT ''");
  add('completion_note', "TEXT NOT NULL DEFAULT ''");
  add('updated_at', 'TEXT');
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_target ON tasks(target_type, target_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_claimed ON tasks(claimed_by)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_log_uid ON task_log(task_uid)");

  const orphans = db.prepare("SELECT DISTINCT task_uid FROM task_log WHERE task_uid <> '' AND task_uid NOT IN (SELECT task_uid FROM tasks)").all();
  const trail = db.prepare("SELECT * FROM task_log WHERE task_uid = ? ORDER BY created_at ASC, id ASC");
  const ins = db.prepare(`INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, created_at, status, completed_at, completed_by_name, notify_creator)
    VALUES (?, ?, ?, ?, 'None', '', ?, ?, ?, ?, ?, 0)`);
  let restored = 0;
  for (const { task_uid } of orphans) {
    const rows = trail.all(task_uid);
    const created = rows.find(r => r.action === 'CREATED') || rows[0];
    const done = [...rows].reverse().find(r => /^COMPLETED/.test(r.action));
    const desc = created?.description || rows.find(r => r.description)?.description || '(description not recorded)';
    let targetType = '', targetId = '';
    const m = /^(Role|User|Team):\s*(.+)$/.exec(created?.target || '');
    if (m) { targetType = m[1] === 'Team' ? 'Role' : m[1]; targetId = m[2].trim(); }
    const createdAt = toIso(created?.created_at) || toIso(rows[0]?.created_at) || new Date(0).toISOString();
    const status = done ? 'completed' : 'removed';
    ins.run(task_uid, desc, targetId, targetType, created?.actor || '', createdAt, status, done ? (toIso(done.created_at) || createdAt) : null, done?.actor || '');
    restored++;
  }
  console.log(`  tasks: ${restored} completed/removed tasks restored from task_log`);
}
