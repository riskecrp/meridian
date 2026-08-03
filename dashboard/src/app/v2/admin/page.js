"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import { visibleAdminGroups, ADMIN_TAB_ALIASES } from "../adminNav.js";
import DiscordAccessView from "../../fm/operations/discord/DiscordAccessView.js";
import { Audit, Archive, ServerLogs, Conversations } from "./views/records.js";
import { Inventory, Vehicles, Imports } from "./views/catalogs.js";
import { Links, RecurringReminders, DocumentsView } from "./views/config.js";
import { StaffTeams, FMHours } from "./views/people.js";

export default function V2AdminPage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><V2Admin /></Suspense>;
}

function V2Admin() {
  const auth = useAuth();
  // Section comes from the Admin nav dropdown via ?tab= (no in-page tab rows).
  const sp = useSearchParams();
  const canEditCatalogs = (auth?.level || 0) >= 3 || auth?.isEventTeam;

  if (auth?.loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;

  const visible = visibleAdminGroups({ level: auth?.level || 0, isET: auth?.isEventTeam, isLST: auth?.isLeadStoryteller, id: auth?.id });
  if (!auth?.ok || !visible.length) return <div className="view" style={{ color: "var(--ink-3)" }}>Team Lead (L2) access required.</div>;

  const tabParam = ADMIN_TAB_ALIASES[sp.get("tab")] || sp.get("tab");
  let activeGroup = visible.find(g => g.items.some(i => i[0] === tabParam));
  let viewId = tabParam;
  if (!activeGroup) {
    activeGroup = visible.find(g => g.items.some(i => i[0] === "audit")) || visible[0];
    viewId = (activeGroup.items.find(i => i[0] === "audit") || activeGroup.items[0])[0];
  }
  const viewLabel = activeGroup.items.find(i => i[0] === viewId)[1];

  return (
    <div className="view">
      <div className="page-head"><div><p className="eyebrow">Admin · {activeGroup.label}</p><h1>{viewLabel}</h1><div className="sub">Switch sections from the Admin menu in the top bar.</div></div></div>

      {viewId === "audit" ? <Audit />
        : viewId === "archive" ? <Archive />
        : viewId === "inventory" ? <Inventory auth={auth} />
        : viewId === "vehicles" ? <Vehicles canEdit={canEditCatalogs} />
        : viewId === "imports" ? <Imports canEdit={canEditCatalogs} />
        : viewId === "links" ? <Links />
        : viewId === "memberlog" ? <ServerLogs />
        : viewId === "convos" ? <Conversations />
        : viewId === "reminders" ? <RecurringReminders auth={auth} />
        : viewId === "docs" ? <DocumentsView auth={auth} />
        : viewId === "discord" ? <DiscordAccessView />
        : viewId === "staff" ? <StaffTeams />
        : viewId === "hours" ? <FMHours />
        : null}
    </div>
  );
}
