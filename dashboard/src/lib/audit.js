import { run } from './db.js';
export function logAudit(actorId, actorName, action, targetType, targetId, targetLabel, details) {
  try {
    run("INSERT INTO site_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [actorId || '', actorName || '', action, targetType || '', targetId != null ? String(targetId) : '', targetLabel || '', details || '']);
  } catch (e) { console.error("[AUDIT]", e.message); }
}
