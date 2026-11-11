"use server";
// v2 aggregation endpoints. These compose the guarded /fm actions (each does
// its own requireActor) plus a few narrow read queries; nothing here widens
// access beyond what the underlying surfaces already allow.
import { query, queryOne } from "../../lib/db.js";
import { requireActor, getActor } from "../../lib/requireActor.js";
import { getEffectiveLimits } from "../../lib/fleet.js";
import {
  getMyTasks, getMyMentions, getLeadershipMentions, getTeamWatchPings, getDMTrackingStatus, getForwardedDMs,
  getMyRecurringInstances, completeMyRecurringInstance,
} from "../fm/dashboard/actions.js";
import { getPendingQueue } from "../fm/leadership/actions.js";
import { getTeamIcContacts } from "../fm/teams/actions.js";
import { fail } from "../../../../shared/validate.js";
import { executionPreview, getExec } from "../../../../shared/rpChanges.js";

const unreadCount = (arr) => (arr || []).filter(x => !x.is_read).length;

// One call that answers "what needs me?" — feeds the Home queue.
export async function getMyAttention() {
  const actor = await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  // The ET boost raises actor.level here; the composed reads keep their own real-level gates.
  const isLeader = actor.level >= 2 || actor.isLeadStoryteller;
  const isL3 = actor.level >= 3 && !actor.isEventTeam;

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

  // My open recurring-reminder instances — every open one, not just this month's
  // (an instance left open last month still needs doing). Same scope as /fm.
  const reminderInstances = (await getMyRecurringInstances().catch(() => []))
    .map(i => ({ id: i.id, reminder_id: i.reminder_id, title: i.title, due_day: i.due_day, year: i.year, month: i.month }));

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
    reviewsDue: reviewsDue.slice(0, 24).map(r => ({ id: r.id, name: r.name })),
    reminderInstances,
  };
}

// Read-only fleet standing for one faction — counts + effective (possibly
// overridden) limits. Caps are faction-facing capability info, so all staff
// (Event Team and Lead Storytellers included) may read them; editing stays L3.
export async function getFactionFleetSummary(factionId) {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const id = Number(factionId);
  const f = Number.isInteger(id) ? queryOne("SELECT id, tier FROM factions WHERE id = ?", [id]) : null;
  if (!f) return null;
  const limits = getEffectiveLimits(f.id, f.tier);
  const veh = queryOne("SELECT COUNT(*) types, COALESCE(SUM(quantity),0) total FROM faction_fleet_vehicles WHERE faction_id = ?", [f.id]);
  const gar = queryOne("SELECT COUNT(*) c FROM faction_fleet_garages WHERE faction_id = ?", [f.id]);
  return {
    typeCount: veh?.types || 0,
    totalQuantity: veh?.total || 0,
    garageCount: gar?.c || 0,
    limits: { maxTypes: limits.maxTypes, maxTotal: limits.maxTotal, maxGarages: limits.maxGarages, isOverridden: limits.isOverridden },
    stipend: limits.stipend ?? 0,
  };
}

// What will an RP-change Execute actually rewrite? Surfacing the target BEFORE
// the commit is the guard rail that would have saved Martin Jane (renamed to
// "Test NPC" in a walkthrough, 2026-08-04, restored from backup). The lookup is
// shared/rpChanges.js executionPreview — the same function executeRPChange
// itself runs — so the preview and the commit can never disagree. Returns that
// preview ({ ok, type, summary, target?, candidates?, mode?… } or { ok:false,
// error, candidates? }) plus the request's own values for the modal label.
export async function getRPExecuteTarget(execId) {
  await requireActor(3);
  const id = Number(execId);
  const exec = Number.isInteger(id) && id > 0 ? getExec(id) : null;
  if (!exec) return fail("Request not found");
  const preview = executionPreview(exec);
  return { ...preview, type: preview.type || exec.execution_type || "Other", turf: exec.turf, oldValue: exec.old_value, newValue: exec.new_value, status: exec.status, factionName: exec.faction_name };
}

// Documents for the Library and the ⌘K palette. level_required is a GATE
// (policy 5): the server returns only what the actor's level may read. Event
// Team and Lead Storytellers (clearance 0) read guide-level material.
// `titlesOnly` skips the HTML content (the palette only indexes titles).
export async function getAllDocuments({ titlesOnly = false } = {}) {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const real = await getActor();                    // real level: the ET boost must not unlock L3 documents
  const level = Math.max(real?.level || 0, (real?.isEventTeam || real?.isLeadStoryteller) ? 1 : 0);
  const cols = titlesOnly ? "id, title, category, level_required, updated_at" : "*";
  return query(`SELECT ${cols} FROM documents WHERE COALESCE(level_required, 1) <= ? ORDER BY level_required ASC, category, title`, [level]);
}



// Complete one of MY recurring-reminder instances. One implementation for both
// shells: this is the fm action (recipient, or L3 for anyone; audited).
export async function completeMyReminderInstance(instanceId) {
  return completeMyRecurringInstance(instanceId);
}
