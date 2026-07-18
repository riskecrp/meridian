"use client";
import "./v2.css";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../../lib/useAuth";

const I = {
  home: <path d="M2 7l6-5 6 5M3.5 6v7h9V6" />,
  inbox: <><path d="M2 4h12v8H2z" /><path d="M2 4l6 5 6-5" /></>,
  tasks: <><path d="M3 3h10v10H3z" /><path d="M6 8l1.5 1.5L11 6" /></>,
  factions: <><circle cx="8" cy="5" r="2.4" /><path d="M3 13c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" /></>,
  story: <path d="M3 2.5h10v11l-5-2.5L3 13.5z" />,
  comms: <path d="M2 6l9-3v10l-9-3zM2 6v4M11 6.5c1.5.3 1.5 2.7 0 3" />,
  leadership: <path d="M8 2l5 2v3.5c0 3-2.2 5.3-5 6.5-2.8-1.2-5-3.5-5-6.5V4z" />,
  admin: <><circle cx="8" cy="8" r="2" /><path d="M8 1v2M8 13v2M15 8h-2M3 8H1M13 3l-1.4 1.4M4.4 11.6L3 13" /></>,
};

function Icon({ d }) {
  return <svg className="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">{d}</svg>;
}

export default function V2Layout({ children }) {
  const auth = useAuth();
  const pathname = usePathname();
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const saved = localStorage.getItem("meridian-theme") || "dark";
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
  const roleLabel = isET ? "Event Team" : level >= 3 ? "L3 · Management" : level >= 2 ? "L2 · Team Lead" : "L1 · FM";
  const initial = (auth?.displayName || auth?.name || "?").slice(0, 1).toUpperCase();

  // Role-aware nav. `min` is the clearance floor; items without one show to all FM.
  const NAV = [
    { grp: "Work", items: [
      { key: "home", label: "Home", href: "/v2", icon: I.home },
      { key: "inbox", label: "Inbox", icon: I.inbox, soon: true },
    ]},
    { grp: "Factions & Story", items: [
      { key: "factions", label: "Factions", icon: I.factions, soon: true },
      { key: "story", label: "Storytelling", icon: I.story, soon: true },
    ]},
    { grp: "Broadcast & Oversight", items: [
      { key: "comms", label: "Comms", icon: I.comms, soon: true },
      { key: "leadership", label: "Leadership", icon: I.leadership, min: 2, soon: true },
      { key: "admin", label: "Admin", icon: I.admin, min: 3, soon: true },
    ]},
  ];

  return (
    <div className="v2-root">
      <div className="app">
        <aside className="rail">
          <div className="brand">
            <div className="mk" />
            <div className="wm">Meridian<small>Ops Hub</small></div>
          </div>
          <nav className="rail-nav">
            {NAV.map(section => {
              const items = section.items.filter(it => !it.min || level >= it.min);
              if (!items.length) return null;
              return (
                <div key={section.grp}>
                  <div className="grp">{section.grp}</div>
                  {items.map(it => {
                    const active = it.href && pathname === it.href;
                    const cls = `nav-i${active ? " on" : ""}`;
                    const inner = <><Icon d={it.icon} /> {it.label}{it.soon && <span className="ct">soon</span>}</>;
                    return it.href
                      ? <Link key={it.key} href={it.href} className={cls}>{inner}</Link>
                      : <div key={it.key} className={cls} style={{ opacity: 0.72, cursor: "default" }} title="Coming in this build">{inner}</div>;
                  })}
                </div>
              );
            })}
          </nav>
          <div className="rail-foot">
            <div className="avatar">{initial}</div>
            <div className="who">
              <div className="n">{auth?.displayName || auth?.name || "…"}</div>
              <div className="r">{roleLabel}</div>
            </div>
          </div>
        </aside>

        <main className="v2-main">
          <div className="topbar">
            <div className="search">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
              Search factions, staff, tasks… <span className="kbd">⌘K</span>
            </div>
            <button className="tb-btn" title="Inbox">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2a3.5 3.5 0 0 0-3.5 3.5V8L3 10.5h10L11.5 8V5.5A3.5 3.5 0 0 0 8 2zM6.5 12a1.5 1.5 0 0 0 3 0" /></svg>
            </button>
            <button className="tb-btn" onClick={toggleTheme} title="Theme">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z" /></svg>
            </button>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
