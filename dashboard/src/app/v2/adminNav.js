// Admin sections, shared by the top-nav dropdown (layout.js) and the Admin page.
// Item shape: [id, label, access?] — access mirrors the old /fm nav:
//   "l1" = all staff · "l2" = L2 / Event Team / Lead Storyteller · "risk" = owner only · default = L3/ET.
export const ADMIN_GROUPS = [
  { id: "people", label: "People", items: [["staff", "Staff & Teams"], ["hours", "FM Hours", "risk"]] },
  { id: "catalogs", label: "Catalogs", items: [["inventory", "Inventory", "l2"], ["vehicles", "Vehicle Catalog", "l2"], ["imports", "Import Catalog", "l2"]] },
  // Documents moved to Library (all-staff reference, 2026-08-03) — with it gone,
  // nothing here is L1 and the Admin nav disappears for guides entirely.
  { id: "config", label: "Config", items: [["links", "Important Links"], ["reminders", "Recurring Reminders", "l2"], ["discord", "Discord & Access"]] },
  { id: "records", label: "Records", items: [["audit", "Audit Log"], ["archive", "Archive"], ["memberlog", "Server Logs", "risk"], ["convos", "Conversations"]] },
];

const OWNER_ID = "738214924760907907";

export function adminItemVisible([, , access], { level = 0, isET, isLST, id }) {
  if (access === "l1") return true;
  if (access === "l2") return level >= 2 || isET || isLST;
  if (access === "risk") return id === OWNER_ID;
  return level >= 3 || isET;
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
