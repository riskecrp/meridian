"use client";
import "./v3.css";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/useAuth.js";
import { AuthContext } from "../../lib/AuthContext.js";
import { CommandPalette } from "../v2/TopTools.js";
import { ToastProvider } from "./ui.js";

const THEME_KEY = "meridian-theme";
const THEME_DEFAULT = "dark";
const MDB_URL = process.env.NEXT_PUBLIC_MDB_URL || "https://meridiandatabase.net";

const I = {
  home: "M3 8.5L8 4l5 4.5V13H3z", factions: "M2 13V6l3-2 3 2 3-2 3 2v7z", work: "M3 4h10v9H3zM6 2v2M10 2v2",
  reviews: "M3 3h10v10H3zM6 8l1.5 1.5L10 6", library: "M3 3h4v10H3zM9 3h4v10H9z", story: "M2 12l4-8 3 5 2-2 3 5z",
  comms: "M2 3h12v8H5l-3 2z", settings: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v2M8 13v2M1 8h2M13 8h2",
};
const Icon = ({ d }) => <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d={d} /></svg>;

function roleLabel(auth) {
  if (!auth?.ok) return "";
  const level = auth.level || 0;
  if (auth.isEventTeam && level < 1) return "Event Team";
  if (auth.isLeadStoryteller && level < 1) return "Lead Storyteller";
  const base = level >= 3 ? "Management" : level >= 2 ? "Team Lead" : level >= 1 ? "Guide" : "No clearance";
  const flags = [auth.isEventTeam ? "ET" : null, auth.isLeadStoryteller ? "LST" : null].filter(Boolean);
  return flags.length ? `${base} · ${flags.join(" · ")}` : base;
}

/** Role-shaped navigation. Leadership sees everything; others see what they can act on. */
export function navFor(auth) {
  const level = auth?.level || 0, isET = !!auth?.isEventTeam, isLST = !!auth?.isLeadStoryteller;
  const staff = level >= 1;
  return [
    { key: "home", label: "Home", href: "/v3", icon: I.home },
    { key: "factions", label: "Factions", href: "/v3/factions", icon: I.factions },
    ...(staff ? [{ key: "work", label: "Work", href: "/v3/work", icon: I.work }] : []),
    ...(level >= 2 || isLST ? [{ key: "reviews", label: "Reviews", href: "/v3/reviews", icon: I.reviews }]
      : staff ? [{ key: "reviews", label: "Meeting notes", href: "/v3/reviews?tab=notes", icon: I.reviews }] : []),
    { key: "library", label: "Library", href: "/v3/library", icon: I.library },
    { key: "storytelling", label: "Storytelling", href: "/v3/storytelling", icon: I.story },
    ...(level >= 2 ? [{ key: "comms", label: "Comms", href: "/v3/comms", icon: I.comms }] : []),
    ...(level >= 2 || isET || isLST ? [{ key: "settings", label: "Settings", href: "/v3/settings", icon: I.settings }] : []),
  ];
}

function UserMenu({ auth, theme, onTheme }) {
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState(null);
  const pathname = usePathname();
  const switchClassic = async () => {
    const r = await fetch("/api/ui", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ui: "v2", from: pathname + window.location.search }) }).then(r => r.json()).catch(() => null);
    window.location.href = r?.to || "/v2";
  };
  const loadStaff = async () => { if (staff) return; const r = await fetch("/api/staff/impersonate").then(r => r.ok ? r.json() : []).catch(() => []); setStaff(r); };
  const impersonate = async (id) => { await fetch("/api/staff/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discordId: id }) }); window.location.reload(); };
  const initial = (auth?.displayName || auth?.name || "?").slice(0, 1).toUpperCase();
  return (
    <div style={{ position: "relative" }}>
      <button className="who" style={{ border: "none", background: "none", cursor: "pointer" }} onClick={() => { setOpen(o => !o); if (auth?.isOwner) loadStaff(); }} aria-haspopup="menu" aria-expanded={open}>
        <div className="avatar">{initial}</div>
        <div><div className="n">{auth?.displayName || auth?.name || "…"}</div><div className="r">{roleLabel(auth)}</div></div>
      </button>
      {open && (
        <div className="menu" role="menu" onMouseLeave={() => setOpen(false)}>
          <button onClick={onTheme}>{theme === "dark" ? "☀ Light theme" : "☾ Dark theme"}</button>
          <button onClick={switchClassic}>↩ Switch to the classic site</button>
          <a href={MDB_URL} target="_blank" rel="noopener noreferrer">↗ Member database</a>
          {auth?.isOwner && !auth?._impersonating && (
            <>
              <div className="hd">View as</div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {(staff || []).map(s => <button key={s.discord_id} onClick={() => impersonate(s.discord_id)}>{s.display_name || s.discord_name} <span className="faint tiny">L{s.clearance}</span></button>)}
                {!staff && <div className="faint small" style={{ padding: "6px 10px" }}>Loading…</div>}
              </div>
            </>
          )}
          <a href="/api/auth/logout">Sign out</a>
        </div>
      )}
    </div>
  );
}

export default function V3Layout({ children }) {
  const auth = useAuth();
  const pathname = usePathname();
  const [theme, setTheme] = useState(THEME_DEFAULT);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    let saved = THEME_DEFAULT;
    try { saved = localStorage.getItem(THEME_KEY) || THEME_DEFAULT; } catch {}
    setTheme(saved); document.documentElement.setAttribute("data-theme", saved);
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(o => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggleTheme = () => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch {} document.documentElement.setAttribute("data-theme", next); };

  const NAV = navFor(auth);
  const isOn = (it) => it.href === "/v3" ? pathname === "/v3" : pathname.startsWith(it.href);
  const navTargets = [
    ...NAV.map(it => ({ kind: "Page", label: it.label, href: it.href })),
    { kind: "Settings", label: "Switch to the classic site", href: "/v2" },
  ];
  const exitImpersonation = async () => { await fetch("/api/staff/impersonate", { method: "DELETE" }).catch(() => {}); window.location.reload(); };
  const phoneNav = NAV.filter(it => ["home", "factions", "work", "reviews", "storytelling"].includes(it.key)).slice(0, 5);

  return (
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <div className="v3-root">
          <header className="nav">
            <div className="nav-in">
              <Link href="/v3" className="brand"><img src="/meridian-logo.png" alt="" /><span className="wm">Meridian</span></Link>
              <nav className="nav-links" aria-label="Main">
                {NAV.map(it => <Link key={it.key} href={it.href} className={`nl${isOn(it) ? " on" : ""}`}><Icon d={it.icon} /> {it.label}</Link>)}
              </nav>
              <div className="nav-right">
                <button className="ib" onClick={() => setPaletteOpen(true)} title="Search (Ctrl/⌘ K)" aria-label="Search"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg></button>
                {auth?.ok && <UserMenu auth={auth} theme={theme} onTheme={toggleTheme} />}
              </div>
            </div>
          </header>
          {auth?._impersonating && (
            <div className="banner">⚠ Viewing as {auth.displayName || auth.name} — you are {auth._realName || "the owner"} <button onClick={exitImpersonation}>Exit</button></div>
          )}
          <main className="main">{children}</main>
          <nav className="bottombar" aria-label="Main (phone)">
            {phoneNav.map(it => <Link key={it.key} href={it.href} className={isOn(it) ? "on" : ""}><Icon d={it.icon} />{it.label}</Link>)}
          </nav>
          <CommandPalette auth={auth} navTargets={navTargets} open={paletteOpen} setOpen={setPaletteOpen} />
        </div>
      </ToastProvider>
    </AuthContext.Provider>
  );
}
