"use client";
import "./v2.css";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/useAuth";

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

  const NAV = [
    { key: "home", label: "Home", href: "/v2", icon: I.home },
    { key: "inbox", label: "Inbox", href: "/v2/inbox", icon: I.inbox },
    { key: "factions", label: "Factions", href: "/v2/factions", icon: I.factions },
    { key: "story", label: "Storytelling", href: "/v2/story", icon: I.story },
    { key: "comms", label: "Comms", href: "/v2/comms", icon: I.comms },
    { key: "leadership", label: "Leadership", icon: I.leadership, min: 2, soon: true },
    { key: "admin", label: "Admin", icon: I.admin, min: 3, soon: true },
  ].filter(it => !it.min || level >= it.min);

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
            <div className="tn-user">
              <div className="avatar">{initial}</div>
              <div className="who"><div className="n">{auth?.displayName || auth?.name || "…"}</div><div className="r">{roleLabel}</div></div>
            </div>
          </div>
        </div>
      </header>
      <main className="v2-main">{children}</main>
    </div>
  );
}
