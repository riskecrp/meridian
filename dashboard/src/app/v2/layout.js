"use client";
import "./v2.css";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/useAuth";
import { AuthContext } from "../../lib/AuthContext.js";
import { visibleAdminGroups, ADMIN_TAB_ALIASES } from "./adminNav.js";
import { PlusMenu, Bell, CommandPalette } from "./TopTools.js";

// One theme preference for the whole app: this key and this default are the
// same ones the root layout's pre-paint script and /fm use.
const THEME_KEY = "meridian-theme";
const THEME_DEFAULT = "dark";
const MDB_URL = process.env.NEXT_PUBLIC_MDB_URL || "https://meridiandatabase.net";

const I = {
  home: <path d="M2 7l6-5 6 5M3.5 6v7h9V6" />,
  inbox: <><path d="M2 4h12v8H2z" /><path d="M2 4l6 5 6-5" /></>,
  factions: <><circle cx="8" cy="5" r="2.4" /><path d="M3 13c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" /></>,
  teams: <><circle cx="5.5" cy="5" r="2" /><circle cx="10.5" cy="5" r="2" /><path d="M1.5 13c0-2.3 1.8-3.8 4-3.8M14.5 13c0-2.3-1.8-3.8-4-3.8M5.5 13c0-2 1.1-3.3 2.5-3.3s2.5 1.3 2.5 3.3" /></>,
  story: <path d="M3 2.5h10v11l-5-2.5L3 13.5z" />,
  comms: <path d="M2 6l9-3v10l-9-3zM2 6v4M11 6.5c1.5.3 1.5 2.7 0 3" />,
  feedback: <><path d="M2 3h12v8H6l-3 2.5V11H2z" /><path d="M5 6.5h6M5 8.5h4" /></>,
  leadership: <path d="M8 2l5 2v3.5c0 3-2.2 5.3-5 6.5-2.8-1.2-5-3.5-5-6.5V4z" />,
  admin: <><circle cx="8" cy="8" r="2" /><path d="M8 1v2M8 13v2M15 8h-2M3 8H1M13 3l-1.4 1.4M4.4 11.6L3 13" /></>,
  db: <><ellipse cx="8" cy="3.5" rx="5" ry="2" /><path d="M3 3.5v9c0 1.1 2.2 2 5 2s5-.9 5-2v-9M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" /></>,
};
const Icon = ({ d }) => <svg className="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">{d}</svg>;

/* Nav item whose sections open as a dropdown menu (deep-linked with ?tab=).
   The label itself still navigates; the caret opens the menu. The menu is
   position:fixed because .tn-links is an overflow-x scroll container that
   would clip an absolutely-positioned child. */
function NavDropdown({ item, active, cls, inner, currentTab, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const toggle = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, (typeof window !== "undefined" ? window.innerWidth : 9999) - 200)) });
    setOpen(o => !o);
  };
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button className={cls} aria-label={`${item.label} sections`} aria-expanded={open} onClick={toggle}
        style={{ background: active ? undefined : "none", border: "none", fontFamily: "inherit", cursor: "pointer" }}>
        {inner} <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>▾</span>
      </button>
      {open && createPortal(
        <div className="v2-root">
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 95, minWidth: 185, maxHeight: "calc(100vh - 80px)", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 10, padding: 6, boxShadow: "0 8px 28px rgba(0,0,0,.14)" }}>
            {item.menu.map((m, mi) => {
              if (m.heading) return <div key={`h-${mi}`} style={{ padding: "7px 10px 3px", fontFamily: "var(--v2-mono)", fontSize: 9, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-3)", borderTop: mi > 0 ? "1px solid var(--line)" : "none", marginTop: mi > 0 ? 4 : 0 }}>{m.heading}</div>;
              const on = active && currentTab === m.id;
              return (
                <Link key={m.id} href={`${item.href}?tab=${m.id}`} onClick={() => { setOpen(false); onNavigate?.(); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 10px", borderRadius: 7, fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? "var(--accent)" : "var(--ink-1)", background: on ? "var(--accent-bg)" : "transparent", textDecoration: "none" }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = "var(--panel-2)"; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                  {m.label}{on && <span style={{ fontSize: 10 }}>●</span>}
                </Link>
              );
            })}
          </div>
        </div>, document.body)}
    </div>
  );
}

/* Owner view-as. The ONLY impersonation is the server-side one: the
   meridian_viewas cookie set by /api/staff/impersonate, which requireActor and
   /api/auth/session both honour — so every list and every action really runs
   as that person. (The old client-only "View as L1/L2/L3" that changed nothing
   server-side is gone: it showed L3 data under an L1 label.) */
function ViewAsMenu({ auth }) {
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!auth.isOwner || auth._impersonating) return null; // an active impersonation exits via the banner
  const loadStaff = async () => {
    if (staff !== null) return;
    try {
      const res = await fetch("/api/staff/impersonate");
      if (res.ok) setStaff(await res.json()); else setErr(`Could not load staff (${res.status}).`);
    } catch (e) { setErr(e.message); }
  };
  const impersonate = async (discordId) => {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/staff/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discordId }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status}).`); setBusy(false); return; }
      window.location.reload();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div style={{ position: "relative" }}>
      <button className="tb-btn" title="View as another staffer (owner)" aria-label="View as"
        style={{ width: "auto", padding: "0 9px", fontFamily: "var(--v2-mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".06em" }}
        onClick={() => { setOpen(o => !o); loadStaff(); }}>
        👁 View as
      </button>
      {open && <>
        <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 95, width: 250, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 10, padding: 10, boxShadow: "0 8px 28px rgba(0,0,0,.14)" }}>
          <div style={{ fontFamily: "var(--v2-mono)", fontSize: 9, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 6 }}>View as (server-side)</div>
          <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginBottom: 6 }}>Every page and action runs as this person; the audit log records you as the real actor.</div>
          {err && <div className="err" style={{ marginBottom: 6 }}>{err}</div>}
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {staff === null ? <div style={{ fontSize: 11, color: "var(--ink-3)", padding: "4px 2px" }}>Loading…</div>
              : staff.map(s => (
                <button key={s.discord_id} disabled={busy} onClick={() => impersonate(s.discord_id)}
                  style={{ width: "100%", textAlign: "left", padding: "5px 8px", borderRadius: 6, fontSize: 11.5, cursor: "pointer", background: "transparent", border: "none", color: "var(--ink-1)", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "inherit" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--rose-bg)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span>{s.display_name}</span>
                  <span style={{ fontSize: 9, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>L{s.clearance}{s.team_name ? ` · ${s.team_name}` : ""}</span>
                </button>
              ))}
          </div>
        </div>
      </>}
    </div>
  );
}

function ViewAsBanner({ auth }) {
  if (!auth?._impersonating) return null;
  const exit = async () => { await fetch("/api/staff/impersonate", { method: "DELETE" }).catch(() => {}); window.location.reload(); };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "6px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", background: "#ef4444", color: "#fff", position: "sticky", top: 0, zIndex: 80, flexWrap: "wrap", textAlign: "center" }}>
      <span>⚠ Viewing as {auth.displayName || auth.name} (L{auth.level}{auth.isEventTeam ? " · Event Team" : ""}{auth.isLeadStoryteller ? " · Lead Storyteller" : ""}){auth._realName ? ` — you are ${auth._realName}` : ""}</span>
      <button onClick={exit} style={{ background: "#fff", color: "#ef4444", border: "none", cursor: "pointer", fontSize: 10, padding: "2px 9px", borderRadius: 4, fontWeight: 700 }}>Exit</button>
    </div>
  );
}

/* What a level-0 / flagged person is called in the top-right corner. */
function roleLabelFor(auth) {
  if (!auth?.ok) return "";
  const level = auth.level || 0;
  if (auth.isEventTeam && level < 1) return "Event Team";
  if (auth.isLeadStoryteller && level < 1) return "Lead Storyteller";
  const base = level >= 3 ? "L3 · Management" : level >= 2 ? "L2 · Team Lead" : level >= 1 ? "L1 · Guide" : "No clearance";
  const flags = [auth.isEventTeam ? "ET" : null, auth.isLeadStoryteller ? "LST" : null].filter(Boolean);
  return flags.length ? `${base} · ${flags.join(" · ")}` : base;
}

export default function V2Layout({ children }) {
  const auth = useAuth();
  const pathname = usePathname();
  const [theme, setTheme] = useState(THEME_DEFAULT);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(o => !o); }
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // The root layout script already applied the saved theme before paint; mirror it into state.
    let saved = THEME_DEFAULT;
    try { saved = localStorage.getItem(THEME_KEY) || THEME_DEFAULT; } catch {}
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    document.documentElement.setAttribute("data-theme", next);
  };

  // ?tab= is read from the location (not useSearchParams, which would force a
  // Suspense boundary around the whole shell); refreshed on every navigation.
  useEffect(() => {
    const read = () => setSearch(window.location.search || "");
    read();
    setMenuOpen(false);
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [pathname]);

  const level = auth?.level || 0;
  const isET = !!auth?.isEventTeam;
  const isLST = !!auth?.isLeadStoryteller;
  const roleLabel = roleLabelFor(auth);
  const initial = (auth?.displayName || auth?.name || "?").slice(0, 1).toUpperCase();

  const canNPC = level >= 2 || isET || isLST;
  // Inbox lives on the topbar bell (owner preference) — one entry point, no nav item.
  const NAV = [
    { key: "home", label: "Home", href: "/v2", icon: I.home },
    { key: "factions", label: "Factions", href: "/v2/factions", icon: I.factions },
    { key: "teams", label: "Teams", href: "/v2/teams", icon: I.teams, min: 1 },
    // Library = everything you look up: reference, docs, catalogues, scene
    // records. Listed A–Z: it's a lookup menu, so alphabetical beats any
    // curated order once there are this many sections.
    {
      key: "story", label: "Library", href: "/v2/story", icon: I.story, menu: [
        { id: "arsenal", label: "Arsenal" },
        { id: "changelog", label: "Change Log" },
        { id: "docs", label: "Documents" },
        { id: "kb", label: "Knowledge Base" },
        ...(canNPC ? [{ id: "npcs", label: "NPC Ecosystem" }] : []),
        { id: "peds", label: "Peds" },
        { id: "scenes", label: "Scene Library" },
        { id: "scenelogs", label: "Scene Logs" },
        { id: "vehicles", label: "Vehicle Catalog" },
      ],
      // Aliases v2/story/page.js resolves (TAB_ALIASES there); keep the two lists in step.
      extraTabs: ["library", "scene", "ideas", "network", "npc", "turfs", "loadouts", "weapons", "spawner", "spawn", "spawns", "changes", "log", "knowledge", "lore", "documents", "sop", "sops", "ped", "scenelog", "logs", "vehicle", "catalog", "garage"],
    },
    {
      key: "comms", label: "Comms", href: "/v2/comms", icon: I.comms, min: 2, menu: [
        { id: "announce", label: "Announcement" },
        { id: "ic", label: "IC Communication" },
        { id: "history", label: "Send History" },
      ],
    },
    { key: "feedback", label: "Feedback", href: "/v2/feedback", icon: I.feedback, min: 2 },
    {
      key: "leadership", label: "Leadership", href: "/v2/leadership", icon: I.leadership, min: 2, lst: true, menu: [
        // Queue = everything waiting on leadership (L2 sees their team's items); the page's default section.
        ...(level >= 2 ? [{ id: "queue", label: "Queue" }] : []),
        { id: "approvals", label: "Approvals" },
        { id: "performance", label: "Performance" },
        { id: "notes", label: "Meeting Notes" },
        { id: "reviews", label: "Reviews" },
        ...(level >= 3 ? [{ id: "contacts", label: "IC Contacts" }] : []),
      ],
    },
    // Admin has per-view gates: the dropdown lists only what this user can open.
    {
      key: "admin", label: "Admin", href: "/v2/admin", icon: I.admin,
      defaultId: level >= 3 ? "audit" : undefined,
      extraTabs: [...Object.keys(ADMIN_TAB_ALIASES), "docs", "vehicles"],
      menu: visibleAdminGroups({ level, isET, isLST, id: auth?.id })
        .flatMap(g => [{ heading: g.label }, ...g.items.map(([id, label]) => ({ id, label }))]),
    },
    // External sister site, not a dashboard page — opens in a new tab.
    { key: "database", label: "Database", href: MDB_URL, icon: I.db, external: true },
  ].filter(it => (!it.min || level >= it.min || (it.lst && isLST)) && (!it.menu || it.menu.some(m => m.id)));

  // Every reachable section, for the ⌘K palette (Inbox included — it's only in the bell).
  const navTargets = [
    ...NAV.flatMap(it => it.menu
      ? [{ kind: "Page", label: it.label, href: it.href }, ...it.menu.filter(m => m.id).map(m => ({ kind: it.label, label: m.label, href: `${it.href}?tab=${m.id}` }))]
      : [{ kind: "Page", label: it.label, href: it.href }]),
    { kind: "Page", label: "Inbox", href: "/v2/inbox" },
    { kind: "Page", label: "Tasks", href: "/v2/tasks" },
  ];

  // Unknown ?tab= on a sectioned page: say so instead of silently showing the first tab.
  const tabParam = new URLSearchParams(search).get("tab");
  const sectioned = NAV.find(it => it.menu && !it.external && pathname.startsWith(it.href));
  const knownTab = sectioned ? [...sectioned.menu.filter(m => m.id).map(m => m.id), ...(sectioned.extraTabs || [])] : [];
  const unknownTab = sectioned && tabParam && !knownTab.includes(tabParam) ? tabParam : null;
  const activeTab = (it) => pathname.startsWith(it.href) ? (tabParam || it.defaultId || it.menu?.find(m => m.id)?.id) : null;

  return (
    <AuthContext.Provider value={auth}>
      <div className="v2-root">
        <header className={`topnav${menuOpen ? " menu-open" : ""}`}>
          <div className="topnav-inner">
            <button className="tb-btn tn-burger" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">{menuOpen ? <path d="M3 3l10 10M13 3L3 13" /> : <path d="M2 4h12M2 8h12M2 12h12" />}</svg>
            </button>
            <div className="tn-brand">
              <img className="mk-img" src="/meridian-logo.png" alt="Meridian" />
              <div className="wm">Meridian</div>
            </div>
            <nav className="tn-links" aria-label="Main">
              {NAV.map(it => {
                const active = it.href && !it.external && (pathname === it.href || (it.href !== "/v2" && pathname.startsWith(it.href)));
                const cls = `tn-i${active ? " on" : ""}`;
                const inner = <><Icon d={it.icon} /> {it.label}{it.count > 0 && <span className="ct hot">{it.count > 99 ? "99+" : it.count}</span>}</>;
                if (it.menu) return <NavDropdown key={it.key} item={it} active={active} cls={cls} inner={inner} currentTab={activeTab(it)} onNavigate={() => setMenuOpen(false)} />;
                if (it.external) return (
                  <a key={it.key} href={it.href} target="_blank" rel="noopener noreferrer" className={cls}>
                    {inner}<span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>↗</span>
                  </a>
                );
                return <Link key={it.key} href={it.href} className={cls} onClick={() => setMenuOpen(false)}>{inner}</Link>;
              })}
              <button className="tn-i tn-mobile-only" onClick={() => { setMenuOpen(false); setPaletteOpen(true); }} style={{ background: "none", border: "none", fontFamily: "inherit" }}>🔍 Search</button>
            </nav>
            <div className="tn-right">
              <button className="search" onClick={() => setPaletteOpen(true)} style={{ cursor: "pointer", fontFamily: "inherit" }} title="Search (Ctrl/⌘ K)" aria-label="Search">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
                <span className="s-txt">Search…</span> <span className="kbd">⌘K</span>
              </button>
              {auth?.ok && <PlusMenu auth={auth} />}
              {auth?.ok && <Bell auth={auth} active={pathname.startsWith("/v2/inbox")} />}
              <button className="tb-btn" onClick={toggleTheme} title={`Theme: ${theme}`} aria-label="Toggle theme">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z" /></svg>
              </button>
              {auth?.ok && <ViewAsMenu auth={auth} />}
              <div className="tn-user" title={roleLabel}>
                <div className="avatar">{initial}</div>
                <div className="who"><div className="n">{auth?.displayName || auth?.name || "…"}</div><div className="r">{roleLabel}</div></div>
              </div>
            </div>
          </div>
        </header>
        <ViewAsBanner auth={auth} />
        {unknownTab && (
          <div className="view" style={{ paddingBottom: 0 }}>
            <div className="restricted" role="status">
              Unknown section “{unknownTab}” on {sectioned.label} — showing {sectioned.menu.find(m => m.id === (sectioned.defaultId || sectioned.menu.find(x => x.id)?.id))?.label || "the default section"} instead.
            </div>
          </div>
        )}
        <main className="v2-main">{children}</main>
        <CommandPalette auth={auth} navTargets={navTargets} open={paletteOpen} setOpen={setPaletteOpen} />
      </div>
    </AuthContext.Provider>
  );
}
