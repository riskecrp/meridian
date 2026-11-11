// Admin sections, shared by the top-nav dropdown (layout.js) and the Admin page.
// Item shape: [id, label, access?] — access mirrors the old /fm nav:
//   "l1" = all staff · "l2" = L2 / Event Team / Lead Storyteller (read-only views)
//   · "l2strict" = L2 and above · "l3" = any L3 (no ET boost) · "risk" = owner only
//   · default = L3. Event Team only sees tabs whose actions accept it (policy 4).
// 2026-08-04 owner ruling: FM Hours + Server Logs open to every L3 (were owner-
// only), Recurring Reminders leaves the L2 tier.
export const ADMIN_GROUPS = [
  { id: "people", label: "People", items: [["staff", "Staff & Teams", "l3"], ["hours", "FM Hours", "l2strict"]] },
  // Vehicle Catalog moved to the Library (all-staff reference, 2026-08-05).
  // Properties / Import Catalog: L2, Event Team and Lead Storytellers read; L3 edits (policy 4).
  // Fleet (port of /fm/operations/fleet) and Analytics (port of /fm/operations/analytics) are L3.
  { id: "catalogs", label: "Catalogs", items: [["inventory", "Inventory", "l2"], ["imports", "Import Catalog", "l2"], ["properties", "Properties", "l2"], ["fleet", "Fleet", "l3"]] },
  // Recurring Reminders: L2 team leads manage their own team's reminders
  // (reminders/actions.js scopes the list server-side); L3 sees everything.
  { id: "config", label: "Config", items: [["links", "Important Links", "l3"], ["reminders", "Recurring Reminders", "l2strict"], ["discord", "Discord & Access", "l3"]] },
  // Audit Log is L3 only: it carries clearance changes, access grants and denial reasons (OC-28, policy 4).
  { id: "records", label: "Records", items: [["audit", "Audit Log", "l3"], ["analytics", "Analytics", "l3"], ["archive", "Archive", "l3"], ["memberlog", "Server Logs", "l3"], ["convos", "Conversations", "l3"]] },
  { id: "handover", label: "Handover", items: [["handover", "Handover", "l3"]] },
];

import { isOwner } from "../../lib/constants.js";

export function adminItemVisible([, , access], { level = 0, isET, isLST, id }) {
  if (access === "l1") return true;
  if (access === "l2") return level >= 2 || isET || isLST;
  if (access === "l2strict") return level >= 2;
  if (access === "l3") return level >= 3;
  if (access === "risk") return isOwner(id);
  return level >= 3;
}

export function visibleAdminGroups(ctx) {
  return ADMIN_GROUPS.map(g => ({ ...g, items: g.items.filter(it => adminItemVisible(it, ctx)) })).filter(g => g.items.length);
}

// Old section ids kept working so existing ?tab= links and bookmarks still land
// somewhere sensible after the merge.
export const ADMIN_TAB_ALIASES = {
  pings: "discord",
  channels: "discord",
  dbaccess: "discord",
};
