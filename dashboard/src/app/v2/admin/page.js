"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import { visibleAdminGroups, ADMIN_TAB_ALIASES } from "../adminNav.js";
import DiscordAccessView from "../../fm/operations/discord/DiscordAccessView.js";
import { Audit, Archive, ServerLogs, Conversations } from "./views/records.js";
import { Inventory, Imports, Properties } from "./views/catalogs.js";
import { Links, RecurringReminders } from "./views/config.js";
import { StaffTeams, FMHours } from "./views/people.js";
import { Handover } from "./views/handover.js";
import { Fleet } from "./views/fleet.js";
import { Analytics } from "./views/analytics.js";

// Sections this page renders that adminNav may not list yet (they are L3-only
// either way). Keeps ?tab=fleet / ?tab=analytics reachable for leadership even
// if the nav file lags behind this page.
const L3_ONLY_FALLBACK = {
  fleet: { group: "catalogs", groupLabel: "Catalogs", label: "Fleet" },
  analytics: { group: "records", groupLabel: "Records", label: "Analytics" },
};

export default function V2AdminPage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><V2Admin /></Suspense>;
}

function V2Admin() {
  const auth = useAuth();
  // Section comes from the Admin nav dropdown via ?tab= (no in-page tab rows).
  const sp = useSearchParams();
  const router = useRouter();
  const level = auth?.level || 0;
  // Catalog edits (import items, global properties) are leadership-only;
  // Event Team reads them like every L2 (policy 4).
  const canEditCatalogs = level >= 3;

  // Documents and the Vehicle Catalog live in the Library now — keep old links
  // and bookmarks working.
  const movedTab = sp.get("tab") === "docs" ? "docs" : sp.get("tab") === "vehicles" ? "vehicles" : null;
  useEffect(() => {
    if (movedTab) {
      const sop = sp.get("sop");
      router.replace(`/v2/story?tab=${movedTab}${sop ? `&sop=${encodeURIComponent(sop)}` : ""}`);
    }
  }, [movedTab]);

  if (auth?.loading || movedTab) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;

  const visible = visibleAdminGroups({ level, isET: auth?.isEventTeam, isLST: auth?.isLeadStoryteller, id: auth?.id });
  if (!auth?.ok || !visible.length) return <div className="view" style={{ color: "var(--ink-3)" }}>Team Lead (L2) access required.</div>;

  const tabParam = ADMIN_TAB_ALIASES[sp.get("tab")] || sp.get("tab");
  let activeGroup = visible.find(g => g.items.some(i => i[0] === tabParam));
  let viewId = tabParam;
  let viewLabel;
  if (activeGroup) {
    viewLabel = activeGroup.items.find(i => i[0] === viewId)[1];
  } else if (L3_ONLY_FALLBACK[tabParam] && level >= 3) {
    const fb = L3_ONLY_FALLBACK[tabParam];
    activeGroup = visible.find(g => g.id === fb.group) || { label: fb.groupLabel };
    viewLabel = fb.label;
  } else {
    activeGroup = visible.find(g => g.items.some(i => i[0] === "audit")) || visible[0];
    viewId = (activeGroup.items.find(i => i[0] === "audit") || activeGroup.items[0])[0];
    viewLabel = activeGroup.items.find(i => i[0] === viewId)[1];
  }

  return (
    <div className="view">
      <div className="page-head"><div><p className="eyebrow">Admin · {activeGroup.label}</p><h1>{viewLabel}</h1><div className="sub">Switch sections from the Admin menu in the top bar.</div></div></div>

      {viewId === "audit" ? <Audit auth={auth} />
        : viewId === "archive" ? <Archive />
        : viewId === "inventory" ? <Inventory auth={auth} />
        : viewId === "imports" ? <Imports canEdit={canEditCatalogs} />
        : viewId === "properties" ? <Properties canEdit={canEditCatalogs} />
        : viewId === "fleet" ? <Fleet />
        : viewId === "analytics" ? <Analytics />
        : viewId === "links" ? <Links />
        : viewId === "memberlog" ? <ServerLogs />
        : viewId === "convos" ? <Conversations />
        : viewId === "reminders" ? <RecurringReminders auth={auth} />
        : viewId === "discord" ? <DiscordAccessView />
        : viewId === "staff" ? <StaffTeams />
        : viewId === "hours" ? <FMHours />
        : viewId === "handover" ? <Handover />
        : null}
    </div>
  );
}
