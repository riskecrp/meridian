"use server";
// v2 aggregation endpoints. These compose the existing guarded /fm actions
// (each does its own requireActor) plus a few narrow read queries; nothing
// here widens access beyond what the underlying surfaces already allow.
import { query, queryOne, run } from "../../lib/db.js";
import { requireActor } from "../../lib/requireActor.js";
import { logAudit } from "../../lib/audit.js";
import { getMyTasks, getMyMentions, getLeadershipMentions, getTeamWatchPings, getDMTrackingStatus, getForwardedDMs } from "../fm/dashboard/actions.js";
import { getPendingQueue } from "../fm/leadership/actions.js";
import { getTeamIcContacts } from "../fm/teams/actions.js";
import { getFleetTierDefaults } from "../fm/operations/actions.js";

const unreadCount = (arr) => (arr || []).filter(x => !x.is_read).length;

// One call that answers "what needs me?" — feeds the Home queue and the bell.
export async function getMyAttention() {
  const actor = await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const isLeader = actor.level >= 2 || actor.isLeadStoryteller;
  const isL3 = actor.level >= 3;

  // Inbox unread, mirroring exactly what /v2/inbox shows.
  const [mentions, watch, dmStatus] = await Promise.all([
    getMyMentions().catch(() => []),
    getTeamWatchPings().catch(() => []),
    getDMTrackingStatus().catch(() => ({ enabled: false })),
  ]);
  const dms = dmStatus.enabled ? await getForwardedDMs().catch(() => []) : [];
  const leadership = isL3 ? await getLeadershipMentions().catch(() => []) : [];
  const inboxUnread = unreadCount(mentions) + unreadCount(watch) + unreadCount(dms) + unreadCount(leadership);

  // Tasks
  const tasks = await getMyTasks().catch(() => ({ assignedToMe: [], forMyTeam: [] }));
  const teamUnclaimed = (tasks.forMyTeam || []).filter(t => !t.claimed_by || t.claimed_by === "None").length;

  // Approvals awaiting action (same scope as the Leadership queue).
  let approvals = 0;
  if (isLeader) {
    const q = await getPendingQueue().catch(() => null);
    if (q) approvals = (q.rpChanges || []).length + (q.deletions || []).length + (q.promos || []).length;
  }

  // Factions with no review yet this month — own team for leads, all for L3.
  let reviewsDue = [];
  if (isLeader) {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const rows = query(`
      SELECT f.id, f.name, s.team_id
      FROM factions f
      LEFT JOIN staff s ON f.lead_discord_id = s.discord_id
      WHERE f.archived = 0
        AND f.id NOT IN (SELECT faction_id FROM faction_reviews WHERE review_month = ?)
      ORDER BY f.name`, [currentMonth]);
    reviewsDue = isL3 ? rows : rows.filter(r => r.team_id && r.team_id === actor.teamId);
  }

  // My open recurring-reminder instances for the current (UTC) month.
  const now = new Date();
  const reminderInstances = query(`
    SELECT i.id, i.reminder_id, r.title, r.due_day
    FROM recurring_reminder_instances i
    JOIN recurring_reminders r ON r.id = i.reminder_id
    WHERE i.recipient_id = ? AND i.completed_at IS NULL AND i.year = ? AND i.month = ?
    ORDER BY r.due_day`, [actor.id, now.getUTCFullYear(), now.getUTCMonth() + 1]);

  // Active IC contacts in my scope (count only; triage lives in the hub / Leadership).
  let icActive = 0;
  if (isL3) {
    icActive = queryOne("SELECT COUNT(*) c FROM faction_ic_contacts WHERE status != 'completed'")?.c || 0;
  } else if (actor.teamId) {
    icActive = ((await getTeamIcContacts(actor.teamId).catch(() => [])) || []).length;
  }

  return {
    counts: {
      inboxUnread,
      assigned: (tasks.assignedToMe || []).length,
      teamUnclaimed,
      approvals,
      reviewsDue: reviewsDue.length,
      reminders: reminderInstances.length,
      icActive,
    },
    reviewsDue: reviewsDue.slice(0, 12).map(r => ({ id: r.id, name: r.name })),
    reminderInstances,
  };
}

// Read-only fleet standing for one faction — counts + effective (possibly
// overridden) limits. Caps are faction-facing capability info, so all staff
// may read them; editing stays L3 in the hub Assets tab. Mirrors
// getEffectiveLimits() in fm/operations/actions.js.
export async function getFactionFleetSummary(factionId) {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const f = queryOne("SELECT id, tier FROM factions WHERE id = ?", [factionId]);
  if (!f) return null;
  const defaults = (await getFleetTierDefaults())[f.tier] || { types: 0, total: 0, garages: 1, stipend: 0 };
  const override = queryOne("SELECT max_types, max_total, max_garages FROM faction_fleet_config WHERE faction_id = ?", [factionId]);
  const veh = queryOne("SELECT COUNT(*) types, COALESCE(SUM(quantity),0) total FROM faction_fleet_vehicles WHERE faction_id = ?", [factionId]);
  const gar = queryOne("SELECT COUNT(*) c FROM faction_fleet_garages WHERE faction_id = ?", [factionId]);
  return {
    typeCount: veh?.types || 0,
    totalQuantity: veh?.total || 0,
    garageCount: gar?.c || 0,
    limits: override
      ? { maxTypes: override.max_types ?? defaults.types, maxTotal: override.max_total ?? defaults.total, maxGarages: override.max_garages ?? defaults.garages, isOverridden: true }
      : { maxTypes: defaults.types, maxTotal: defaults.total, maxGarages: defaults.garages, isOverridden: false },
    stipend: defaults.stipend ?? 0,
  };
}

// What will an RP-change Execute actually rewrite? NPC executes match on
// turf + old type and overwrite that live registry row; HQ executes re-flag
// properties. Surfacing the target BEFORE the commit is the guard rail that
// would have saved Martin Jane (renamed to "Test NPC" in a walkthrough,
// 2026-08-04, restored from backup).
export async function getRPExecuteTarget(execId) {
  await requireActor(3);
  const exec = queryOne("SELECT pe.*, f.name AS faction_name FROM pending_executions pe JOIN factions f ON pe.faction_id = f.id WHERE pe.id = ?", [execId]);
  if (!exec) return { ok: false, error: "Request not found" };
  if (exec.execution_type === "NPC") {
    const npc = queryOne("SELECT id, name, npc_type, turf, position FROM npcs WHERE turf = ? AND npc_type = ?", [exec.turf, exec.old_value]);
    return { ok: true, type: "NPC", turf: exec.turf, oldValue: exec.old_value, newValue: exec.new_value, target: npc || null };
  }
  if (exec.execution_type === "HQ") {
    const oldP = queryOne("SELECT id, address FROM properties WHERE faction_id = ? AND address = ?", [exec.faction_id, exec.old_value]);
    const newP = queryOne("SELECT id, address FROM properties WHERE faction_id = ? AND address = ?", [exec.faction_id, exec.new_value]);
    return { ok: true, type: "HQ", oldValue: exec.old_value, newValue: exec.new_value, oldFound: !!oldP, newExists: !!newP };
  }
  return { ok: true, type: "Other", oldValue: exec.old_value, newValue: exec.new_value };
}

// Every document, for the Library. The old level_required gate was relevance
// filtering, not confidentiality (owner ruling 2026-08-03): everyone sees the
// whole catalog; level_required becomes the "audience" tag the UI groups by.
export async function getAllDocuments() {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  return query("SELECT * FROM documents ORDER BY level_required ASC, category, title");
}

// Per-faction cycle state that getReviewData can't answer: who got their
// feedback message this month, and which factions have a promo staged.
export async function getReviewCycleMap() {
  await requireActor(2, { allowLeadStoryteller: true });
  const month = new Date().toISOString().substring(0, 7);
  const fb = query(`SELECT target_label, actor_name, MAX(timestamp) t FROM site_audit_log
    WHERE target_type = 'feedback_sent' AND strftime('%Y-%m', timestamp) = ?
    GROUP BY target_label`, [month]);
  const promos = query("SELECT name FROM factions WHERE archived = 0 AND pending_promo IS NOT NULL AND pending_promo != ''");
  return {
    feedback: Object.fromEntries(fb.map(r => [r.target_label, { by: r.actor_name, at: r.t }])),
    staged: promos.map(p => p.name),
  };
}

// Has this month's feedback been delivered to the faction? Sent-ness is only
// recorded in the audit log (by sendFeedbackToFaction / markFeedbackSent), so
// read it back from there for the review checklist.
export async function getFeedbackSentThisMonth(factionName) {
  await requireActor(2, { allowLeadStoryteller: true });
  const row = queryOne(`SELECT actor_name, timestamp FROM site_audit_log
    WHERE target_type = 'feedback_sent' AND target_label = ?
      AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')
    ORDER BY timestamp DESC LIMIT 1`, [factionName]);
  return row ? { sent: true, by: row.actor_name, at: row.timestamp } : { sent: false };
}

// Complete one of MY recurring-reminder instances (L3 may complete anyone's,
// same as the admin Progress modal).
export async function completeMyReminderInstance(instanceId) {
  const actor = await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const inst = queryOne("SELECT id, recipient_id, completed_at FROM recurring_reminder_instances WHERE id = ?", [instanceId]);
  if (!inst) return { ok: false, error: "Instance not found" };
  if (inst.recipient_id !== actor.id && actor.level < 3) return { ok: false, error: "Not yours to complete" };
  if (inst.completed_at) return { ok: true };
  run("UPDATE recurring_reminder_instances SET completed_at = datetime('now'), completed_by_id = ?, completed_by_name = ? WHERE id = ? AND completed_at IS NULL",
    [actor.id, actor.name, instanceId]);
  logAudit(actor.id, actor.name, "EDIT", "recurring_reminder_instance", instanceId, "", inst.recipient_id === actor.id ? "Self completed" : "Completed");
  return { ok: true };
}
