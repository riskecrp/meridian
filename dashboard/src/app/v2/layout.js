"use client";
import "./v2.css";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/useAuth";
import { visibleAdminGroups } from "./adminNav.js";

const I = {
  home: <path d="M2 7l6-5 6 5M3.5 6v7h9V6" />,
  inbox: <><path d="M2 4h12v8H2z" /><path d="M2 4l6 5 6-5" /></>,
  factions: <><circle cx="8" cy="5" r="2.4" /><path d="M3 13c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" /></>,
  story: <path d="M3 2.5h10v11l-5-2.5L3 13.5z" />,
  comms: <path d="M2 6l9-3v10l-9-3zM2 6v4M11 6.5c1.5.3 1.5 2.7 0 3" />,
  leadership: <path d="M8 2l5 2v3.5c0 3-2.2 5.3-5 6.5-2.8-1.2-5-3.5-5-6.5V4z" />,
  admin: <><circle cx="8" cy="8" r="2" /><path d="M8 1v2M8 13v2M15 8h-2M3 8H1M13 3l-1.4 1.4M4.4 11.6L3 13" /></>,
};
const Icon = ({ d }) => <svg className="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">{d}</svg>;

const RISK_ID = "738214924760907907";

/* Nav item whose sections open as a dropdown menu (deep-linked with ?tab=).
   The label itself still navigates; the caret opens the menu. The menu is
   position:fixed because .tn-links is an overflow-x scroll container that
   would clip an absolutely-positioned child. */
function NavDropdown({ item, active, cls, inner }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const defaultId = item.defaultId || item.menu.find(m => m.id)?.id;
  const currentTab = typeof window !== "undefined" && window.location.pathname.startsWith(item.href)
    ? new URLSearchParams(window.location.search).get("tab") || defaultId
    : null;
  const toggle = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: Math.max(8, r.left) });
    setOpen(o => !o);
  };
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <button className={cls} aria-label={`${item.label} sections`} onClick={toggle}
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
                <Link key={m.id} href={`${item.href}?tab=${m.id}`} onClick={() => setOpen(false)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 10px", borderRadius: 7, fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? "var(--accent)" : "var(--ink-1)", background: on ? "var(--accent-bg)" : "transparent", textDecoration: "none" }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = "var(--panel-2)"; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = on ? "var(--accent-bg)" : "transparent"; }}>
                  {m.label}{on && <span style={{ fontSize: 10 }}>●</span>}
                </Link>
              );
            })}
          </div>
        </div>, document.body)}
    </div>
  );
}

/* View As + Impersonate — port of the /fm sidebar dev tools (same localStorage key, event and cookie API). */
function ViewAsMenu({ auth }) {
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState(null);
  const [busy, setBusy] = useState(false);
  const isOwner = auth.id === RISK_ID || auth._realId === RISK_ID;
  const isL3Real = auth.level === 3 || auth._realLevel === 3;
  if (auth._realId || (!isL3Real && !isOwner)) return null; // cookie-impersonation exits via the banner

  const isViewing = auth._viewAsEventTeam || auth._viewAsLeadStoryteller || (auth._realLevel && auth.level !== auth._realLevel);
  const activeLabel = auth._viewAsEventTeam ? "ET" : auth._viewAsLeadStoryteller ? "LST" : isViewing ? `L${auth.level}` : "Real";
  const setLevel = (lvl) => {
    if (lvl === null) localStorage.removeItem("meridian-view-as");
    else localStorage.setItem("meridian-view-as", String(lvl));
    window.dispatchEvent(new Event("meridian-view-as-changed"));
  };
  const loadStaff = async () => {
    if (staff !== null) return;
    const res = await fetch("/api/staff/impersonate");
    if (res.ok) setStaff(await res.json());
  };
  const impersonate = async (discordId) => {
    setBusy(true);
    await fetch("/api/staff/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discordId }) });
    window.location.reload();
  };
  const OPTS = [{ lvl: null, label: "Real" }, { lvl: 1, label: "L1" }, { lvl: 2, label: "L2" }, { lvl: 3, label: "L3" }, { lvl: "event_team", label: "ET" }, { lvl: "lead_storyteller", label: "LST" }];
  const isActive = (o) => o.lvl === null ? !isViewing
    : o.lvl === "event_team" ? !!auth._viewAsEventTeam
    : o.lvl === "lead_storyteller" ? !!auth._viewAsLeadStoryteller
    : isViewing && !auth._viewAsEventTeam && !auth._viewAsLeadStoryteller && auth.level === o.lvl;

  return (
    <div style={{ position: "relative" }}>
      <button className="tb-btn" title="View as / impersonate"
        style={{ width: "auto", padding: "0 9px", fontFamily: "var(--v2-mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", color: isViewing ? "var(--amber)" : undefined, background: isViewing ? "var(--amber-bg)" : undefined }}
        onClick={() => { setOpen(o => !o); if (isOwner) loadStaff(); }}>
        👁 {activeLabel}
      </button>
      {open && <>
        <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
        <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 95, width: 240, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 10, padding: 10, boxShadow: "0 8px 28px rgba(0,0,0,.14)" }}>
          <div style={{ fontFamily: "var(--v2-mono)", fontSize: 9, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 7 }}>
            View as{isViewing && <span style={{ color: "var(--amber)", marginLeft: 5 }}>· active</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4 }}>
            {OPTS.map(o => (
              <button key={o.label} onClick={() => { setLevel(o.lvl); setOpen(false); }}
                style={{ padding: "4px 0", borderRadius: 6, fontSize: 9.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--v2-mono)", background: isActive(o) ? "var(--accent-bg)" : "transparent", color: isActive(o) ? "var(--accent)" : "var(--ink-2)", border: `1px solid ${isActive(o) ? "var(--accent)" : "var(--line)"}` }}>
                {o.label}
              </button>
            ))}
          </div>
          {isOwner && <>
            <div style={{ fontFamily: "var(--v2-mono)", fontSize: 9, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--rose)", margin: "12px 0 6px" }}>Impersonate user</div>
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              {staff === null ? <div style={{ fontSize: 11, color: "var(--ink-3)", padding: "4px 2px" }}>Loading…</div>
                : staff.map(s => (
                  <button key={s.discord_id} disabled={busy} onClick={() => impersonate(s.discord_id)}
                    style={{ width: "100%", textAlign: "left", padding: "5px 8px", borderRadius: 6, fontSize: 11.5, cursor: "pointer", background: "transparent", border: "none", color: "var(--ink-1)", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "inherit" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--rose-bg)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span>{s.display_name}</span>
                    <span style={{ fontSize: 9, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>L{s.clearance}</span>
                  </button>
                ))}
            </div>
          </>}
        </div>
      </>}
    </div>
  );
}

function ViewAsBanner({ auth }) {
  if (!auth) return null;
  const bar = (bg, fg, text, onExit, exitLabel) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "6px 16px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", background: bg, color: fg, position: "sticky", top: 0, zIndex: 80 }}>
      <span>{text}</span>
      <button onClick={onExit} style={{ background: fg, color: bg, border: "none", cursor: "pointer", fontSize: 10, padding: "2px 9px", borderRadius: 4, fontWeight: 700 }}>{exitLabel}</button>
    </div>
  );
  const resetViewAs = () => { localStorage.removeItem("meridian-view-as"); window.dispatchEvent(new Event("meridian-view-as-changed")); };
  if (auth._realId) return bar("#ef4444", "#fff", `⚠ Impersonating: ${auth.displayName || auth.name} (L${auth.level})`,
    async () => { await fetch("/api/staff/impersonate", { method: "DELETE" }); window.location.reload(); }, "Exit");
  if (auth._viewAsEventTeam) return bar("var(--amber)", "#000", `Viewing as Event Team — real level is L${auth._realLevel}`, resetViewAs, "Reset");
  if (auth._viewAsLeadStoryteller) return bar("var(--amber)", "#000", `Viewing as Lead Storyteller — real level is L${auth._realLevel}`, resetViewAs, "Reset");
  if (auth._realLevel && auth.level !== auth._realLevel) {
    const labels = { 1: "L1 (Guide)", 2: "L2 (Lead)", 3: "L3 (Management)" };
    return bar("var(--amber)", "#000", `Viewing as ${labels[auth.level] || `L${auth.level}`} — real level is ${labels[auth._realLevel] || `L${auth._realLevel}`}`, resetViewAs, "Reset");
  }
  return null;
}

export default function V2Layout({ children }) {
  const auth = useAuth();
  const pathname = usePathname();
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    // v2 is paper-light by default; still honors an explicit saved choice.
    const saved = localStorage.getItem("meridian-theme") || "light";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("meridian-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const level = auth?.level || 0;
  const isET = auth?.isEventTeam;
  const roleLabel = isET ? "Event Team" : level >= 3 ? "L3" : level >= 2 ? "L2" : "L1";
  const initial = (auth?.displayName || auth?.name || "?").slice(0, 1).toUpperCase();

  const canNPC = level >= 2 || isET || auth?.isLeadStoryteller;
  const NAV = [
    { key: "home", label: "Home", href: "/v2", icon: I.home },
    { key: "inbox", label: "Inbox", href: "/v2/inbox", icon: I.inbox },
    { key: "factions", label: "Factions", href: "/v2/factions", icon: I.factions },
    // Prototype: sections as a nav dropdown instead of in-page tabs (deep-linked via ?tab=).
    {
      key: "story", label: "Storytelling", href: "/v2/story", icon: I.story, menu: [
        { id: "kb", label: "Knowledge Base" },
        { id: "scenelogs", label: "Scene Logs" },
        { id: "scenes", label: "Scene Library" },
        { id: "arsenal", label: "Arsenal" },
        ...(canNPC ? [{ id: "npcs", label: "NPC Ecosystem" }] : []),
        { id: "changelog", label: "Change Log" },
      ],
    },
    { key: "comms", label: "Comms", href: "/v2/comms", icon: I.comms },
    { key: "leadership", label: "Leadership", href: "/v2/leadership", icon: I.leadership, min: 2 },
    // Admin has per-view gates (Documents = all staff, Catalogs = L2/ET/LST, rest = L3): the dropdown lists only what this user can open.
    {
      key: "admin", label: "Admin", href: "/v2/admin", icon: I.admin,
      defaultId: (level >= 3 || isET) ? "audit" : undefined,
      menu: visibleAdminGroups({ level, isET, isLST: auth?.isLeadStoryteller, id: auth?.id })
        .flatMap(g => [{ heading: g.label }, ...g.items.map(([id, label]) => ({ id, label }))]),
    },
  ].filter(it => (!it.min || level >= it.min) && (!it.menu || it.menu.some(m => m.id)));

  return (
    <div className="v2-root">
      <header className="topnav">
        <div className="topnav-inner">
          <div className="tn-brand">
            <img className="mk-img" src="/meridian-logo.png" alt="Meridian" />
            <div className="wm">Meridian</div>
          </div>
          <nav className="tn-links">
            {NAV.map(it => {
              const active = it.href && (pathname === it.href || (it.href !== "/v2" && pathname.startsWith(it.href)));
              const cls = `tn-i${active ? " on" : ""}`;
              const inner = <><Icon d={it.icon} /> {it.label}</>;
              if (it.menu) return <NavDropdown key={it.key} item={it} active={active} cls={cls} inner={inner} />;
              return it.href
                ? <Link key={it.key} href={it.href} className={cls}>{inner}</Link>
                : <span key={it.key} className={`${cls} soon`} style={{ cursor: "default" }} title="Coming soon">{inner}</span>;
            })}
          </nav>
          <div className="tn-right">
            <div className="search">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
              Search… <span className="kbd">⌘K</span>
            </div>
            <button className="tb-btn" title="Inbox">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2a3.5 3.5 0 0 0-3.5 3.5V8L3 10.5h10L11.5 8V5.5A3.5 3.5 0 0 0 8 2zM6.5 12a1.5 1.5 0 0 0 3 0" /></svg>
            </button>
            <button className="tb-btn" onClick={toggleTheme} title="Theme">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z" /></svg>
            </button>
            {auth?.ok && <ViewAsMenu auth={auth} />}
            <div className="tn-user">
              <div className="avatar">{initial}</div>
              <div className="who"><div className="n">{auth?.displayName || auth?.name || "…"}</div><div className="r">{roleLabel}</div></div>
            </div>
          </div>
        </div>
      </header>
      <ViewAsBanner auth={auth} />
      <main className="v2-main">{children}</main>
    </div>
  );
}
