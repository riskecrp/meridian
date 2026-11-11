"use server";
import { query, queryOne } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";
import { monthKey } from "../../../../../shared/dates.js";

// Admin › Analytics (v2). Every number is defined against the CURRENT tables,
// not the Sheets-era v_server_analytics view (which counted archived factions
// as factions and "unclaimed" as "open"):
//   factions.active     archived = 0
//   tasks.open          status = 'open' (claimed or not); unclaimed = open AND claimed_by = 'None'
//   properties.*        confiscated flag / faction_id NULL
//   rp.pending          pending_executions in PENDING / APPROVED / RP_DONE
//   deletions.pending   deletion_requests PENDING
//   reviews.open        faction_reviews this month not yet 'Confirmed …'
//   scenes.30d          scene_logs created in the last 30 days
//   activity            v_staff_activity_30d (scene_logs by author, last 30 days)
export async function getAdminAnalytics() {
  await requireActor(3);
  const n = (sql, p = []) => queryOne(sql, p)?.c || 0;
  const month = monthKey();
  const factions = {
    active: n("SELECT COUNT(*) c FROM factions WHERE archived = 0"),
    archived: n("SELECT COUNT(*) c FROM factions WHERE archived = 1"),
    pendingPromo: n("SELECT COUNT(*) c FROM factions WHERE archived = 0 AND COALESCE(pending_promo,'') != ''"),
    byTier: query("SELECT tier, COUNT(*) c FROM factions WHERE archived = 0 GROUP BY tier ORDER BY tier"),
  };
  const properties = {
    total: n("SELECT COUNT(*) c FROM properties"),
    assigned: n("SELECT COUNT(*) c FROM properties p JOIN factions f ON f.id = p.faction_id WHERE p.confiscated = 0 AND f.archived = 0"),
    confiscated: n("SELECT COUNT(*) c FROM properties WHERE confiscated = 1"),
    unassigned: n("SELECT COUNT(*) c FROM properties WHERE confiscated = 0 AND faction_id IS NULL"),
  };
  const tasks = {
    open: n("SELECT COUNT(*) c FROM tasks WHERE status = 'open'"),
    unclaimed: n("SELECT COUNT(*) c FROM tasks WHERE status = 'open' AND claimed_by = 'None'"),
    completed30d: n("SELECT COUNT(*) c FROM tasks WHERE status = 'completed' AND completed_at >= datetime('now','-30 days')"),
  };
  const queues = {
    rpPending: n("SELECT COUNT(*) c FROM pending_executions WHERE status IN ('PENDING','APPROVED','RP_DONE')"),
    rpAwaitingLeadership: n("SELECT COUNT(*) c FROM pending_executions WHERE status IN ('PENDING','RP_DONE')"),
    deletionsPending: n("SELECT COUNT(*) c FROM deletion_requests WHERE status = 'PENDING'"),
    reviewsOpenThisMonth: n("SELECT COUNT(*) c FROM faction_reviews WHERE review_month = ? AND status NOT LIKE 'Confirmed %'", [month]),
  };
  const scenes = {
    last30d: n("SELECT COUNT(*) c FROM scene_logs WHERE created_at >= datetime('now','-30 days')"),
    factionsWithoutScene30d: n(`SELECT COUNT(*) c FROM factions f WHERE f.archived = 0
      AND NOT EXISTS (SELECT 1 FROM scene_logs s WHERE s.faction_id = f.id AND s.created_at >= datetime('now','-30 days'))`),
  };
  const staff = {
    active: n("SELECT COUNT(*) c FROM staff WHERE COALESCE(active,1) = 1 AND discord_id != '' AND discord_id NOT LIKE 'placeholder%'"),
  };
  let activity = [];
  try { activity = query("SELECT name, discord_id, scene_count FROM v_staff_activity_30d ORDER BY scene_count DESC, name"); } catch { activity = []; }
  return { month, factions, properties, tasks, queues, scenes, staff, activity };
}
