// The RP-change pipeline's state machine, shared by the dashboard actions and
// the bot's buttons so both surfaces enforce the same order:
//
//   PENDING --approve--> APPROVED --done--> RP_DONE --execute--> EXECUTED
//      |                    |
//      +------deny----------+--> DENIED --resubmit--> PENDING
//
import { query, queryOne } from './db.js';

export const RP_TRANSITIONS = {
  approve:  { from: ['PENDING'],             to: 'APPROVED' },
  deny:     { from: ['PENDING', 'APPROVED'], to: 'DENIED' },
  done:     { from: ['APPROVED'],            to: 'RP_DONE' },
  execute:  { from: ['RP_DONE'],             to: 'EXECUTED' },
  resubmit: { from: ['DENIED'],              to: 'PENDING' },
};

export const RP_STATUS_LABEL = {
  PENDING: 'pending approval',
  APPROVED: 'approved, awaiting the RP',
  RP_DONE: 'ready to execute',
  EXECUTED: 'already executed',
  DENIED: 'denied',
};

/** null when the action is allowed from the request's current status, else a message. */
export function rpTransitionError(exec, action) {
  if (!exec) return 'This RP change request no longer exists.';
  const t = RP_TRANSITIONS[action];
  if (!t) return `Unknown action "${action}".`;
  if (!t.from.includes(exec.status)) return `This request is ${RP_STATUS_LABEL[exec.status] || exec.status}; it cannot be ${action === 'done' ? 'marked done' : action + 'd'} now.`;
  return null;
}

export function getExec(id) {
  return queryOne("SELECT pe.*, f.name AS faction_name, f.archived AS faction_archived FROM pending_executions pe JOIN factions f ON f.id = pe.faction_id WHERE pe.id = ?", [id]) || null;
}

/**
 * The NPC an NPC-type request will rewrite. Prefers the id recorded at request
 * time (pending_executions.npc_id); falls back to the old turf+type match and
 * says when that match is ambiguous.
 */
export function findNpcTarget(exec) {
  if (exec.npc_id) {
    const npc = queryOne("SELECT * FROM npcs WHERE id = ?", [exec.npc_id]);
    if (npc) return { npc, ambiguous: false, by: 'id', candidates: [npc] };
  }
  const rows = query("SELECT * FROM npcs WHERE turf = ? AND npc_type = ? ORDER BY id", [exec.turf, exec.old_value]);
  return { npc: rows[0] || null, ambiguous: rows.length > 1, by: 'turf_type', candidates: rows };
}
