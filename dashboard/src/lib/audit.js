import { run } from './db.js';
import { impersonationFor } from './auditContext.js';

/**
 * One audit row. When the request is an owner view-as session, the actor name
 * is written as "Target (as Owner)" so impersonated actions are never mistaken
 * for the target's own. target_id should be the real record id.
 */
export function logAudit(actorId, actorName, action, targetType, targetId, targetLabel, details, source = 'site') {
  try {
    let name = actorName || '';
    const imp = impersonationFor(actorId);
    if (imp && !/\(as /.test(name)) name = `${name} (as ${imp.realName || imp.realId})`;
    run("INSERT INTO site_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, details, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [actorId || '', name, action, targetType || '', targetId != null ? String(targetId) : '', targetLabel || '', details || '', source]);
  } catch (e) { console.error("[AUDIT]", e.message); }
}
