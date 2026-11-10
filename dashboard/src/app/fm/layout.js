"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, useEffect } from "react";
import { useAuth } from "../../lib/useAuth";
import { DialogProvider } from "../../lib/useDialog";
import { AuthContext } from "../../lib/AuthContext.js";
import { isOwner } from "../../lib/constants.js";

const SECTIONS = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/fm/dashboard", blurb: "Everything needing attention right now", eventTeam: true },
      { name: "Factions", href: "/fm/factions", blurb: "Every faction, tier and current standing", eventTeam: true },
      { name: "Teams", href: "/fm/teams", blurb: "Team rosters and their assigned factions" },
      { name: "Scenes", href: "/fm/scenes", blurb: "Scene logs and rewards handed out", eventTeam: true },
      { name: "Documents", href: "/fm/documents", blurb: "Written guidance and reference docs", eventTeam: true, lst: true },
      { name: "Meridian Database ↗", href: "https://meridiandatabase.net", external: true, blurb: "MeridianDatabase.net — opens in a new tab", eventTeam: true },
    ],
  },
  {
    label: "Communications",
    items: [
      { name: "Announcements",    href: "/fm/communications", blurb: "Announcements out to faction Discords", level: 2 },
      { name: "IC Communication", href: "/fm/communications/ic", blurb: "In-character memos to factions",         level: 2 },
      { name: "Meeting Notes",    href: "/fm/leadership/notes", blurb: "Minutes from leadership meetings" },
      { name: "IC Contacts",      href: "/fm/leadership/contacts", blurb: "In-character contact details", level: 3 },
    ],
  },
  {
    label: "Leadership",
    minLevel: 2,
    items: [
      { name: "Reviews", href: "/fm/leadership/reviews", blurb: "Monthly faction review rounds" },
      { name: "Performance", href: "/fm/leadership/performance", blurb: "How the staff team is tracking" },
      // Section minLevel 2 already matches the three roles that work feedback in
      // Discord (Team Leads, Leadership, Game Affairs), so no per-item level.
      { name: "Faction Feedback", href: "/fm/feedback", blurb: "Player feedback from the roleplay form" },
    ],
  },
  {
    label: "Storytelling",
    items: [
      { name: "Knowledge Base", href: "/fm/storytelling/kb", blurb: "Lore and setting reference", eventTeam: true, lst: true },
      { name: "Scene Library", href: "/fm/storytelling/library", blurb: "Reusable scene ideas and write-ups", eventTeam: true, lst: true },
      { name: "Arsenal", href: "/fm/storytelling/loadouts", blurb: "Weapon and gear sets for scenes", eventTeam: true, lst: true },
      { name: "Change Log", href: "/fm/storytelling/changelog", blurb: "What changed in the world, and when", eventTeam: true, lst: true },
      { name: "NPC Ecosystem", href: "/fm/storytelling/network", blurb: "NPCs, turf and who controls what", level: 2, eventTeam: true, lst: true },
    ],
  },
  {
    label: "Operations",
    minLevel: 3,
    items: [
      { name: "Scene Items", href: "/fm/inventory", blurb: "Items offered on the scene form, and what has been given out", minView: 2, lst: true },
      { name: "Properties", href: "/fm/operations/properties", blurb: "Faction HQs and confiscated property", eventTeam: true, minView: 2, lst: true },
      { name: "Imports", href: "/fm/operations/imports", blurb: "What each faction may import", eventTeam: true, minView: 2, lst: true },
      { name: "Fleet", href: "/fm/operations/fleet", blurb: "Faction vehicles on the books" },
      { name: "Vehicle Catalog", href: "/fm/operations/vehicles", blurb: "Catalogue of vehicles by tier", eventTeam: true, minView: 2, lst: true },
      { name: "Conversations", href: "/fm/operations/conversations", blurb: "Harvested team channel history" },
      // Archived factions live under Factions (fm) / Admin › Records (v2); the
      // old /fm/operations/archive route never existed.
      { name: "Audit Log", href: "/fm/operations/audit", blurb: "Who changed what, site and bot", eventTeam: true },
      // Team leads manage their own team's reminders; leadership sees all.
      { name: "Recurring Reminders", href: "/fm/operations/reminders", blurb: "Reminders that repeat on a schedule", minView: 2 },
      { name: "Important Links", href: "/fm/operations/links", blurb: "Shortcuts staff need often" },
      { name: "Staff", href: "/fm/operations/staff", blurb: "Staff records, ranks and clearance" },
      { name: "Discord & Access", href: "/fm/operations/discord", blurb: "Pings, bot servers and who can log in" },
      { name: "Member Log",  href: "/fm/operations/memberlog", blurb: "Joins and leaves across the server",  owner: true },
      // FM Hours is where the report is built; the view that gets sent out is a
      // link on that page rather than a second nav entry, since they are two ends
      // of one job. Team leads record their own team's hours; leadership posts.
      { name: "FM Hours", href: "/fm/operations/fmhours", blurb: "Build and send the staff activity report", minView: 2 },
    ],
  },
  {
    label: "Handover",
    minLevel: 3,
    items: [
      { name: "Server Handover", href: "/fm/handover", blurb: "Migration runbook and data exports" },
    ],
  },
];

function SidebarInner({ mobile, setMobile, theme, toggleTheme, auth }) {
  const pathname = usePathname();

  // Active = the current path is this item or lives under it. Routes are plain
  // pages now (no tab query strings), and the longest matching href wins so a
  // parent entry never lights up for a child page's own entry.
  const isActive = (item) => {
    if (item.external || !pathname) return false;
    if (pathname !== item.href && !pathname.startsWith(item.href + "/")) return false;
    const longer = SECTIONS.flatMap(s => s.items).some(o => !o.external && o.href !== item.href && o.href.startsWith(item.href + "/") && (pathname === o.href || pathname.startsWith(o.href + "/")));
    return !longer;
  };

  const buildHref = (item) => item.href;

  // Per-item visibility. A section is shown iff it has at least one visible item,
  // so an item can be exposed below its section's minLevel (via `minView`) or to
  // Lead Storytellers (via `lst`) without unlocking the rest of the section.
  const itemAllowed = (item, section) => {
    // Event Team: only ever see ET-flagged items, in any section.
    if (auth.isEventTeam) return !!item.eventTeam;
    // Owner-only items (OWNER_IDS from the environment). Hidden while impersonating /
    // viewing-as so the impersonator sees ONLY what the target sees (never via _realId).
    if (item.owner) return !auth._impersonating && isOwner(auth.id);
    // Lead Storyteller grant — additive on top of whatever their level allows below.
    if (auth.isLeadStoryteller && item.lst) return true;
    // Floor: items may opt to appear below the section minLevel via `minView`.
    const floor = item.minView != null ? item.minView : (section.minLevel || 0);
    if (auth.level < floor) return false;
    // Per-item level raise within the section.
    if (item.level && auth.level < item.level) return false;
    return true;
  };

  const visibleSections = SECTIONS.map((section) => {
    const visibleItems = section.items.filter((item) => itemAllowed(item, section));
    if (visibleItems.length === 0) return null;
    return { ...section, items: visibleItems };
  }).filter(Boolean);

  const initials = (auth.displayName || auth.name || "?").slice(0, 2).toUpperCase();

  return (
    <aside
      className={`${mobile ? "fixed inset-0 top-[58px] z-40 flex" : "hidden"} md:flex w-full md:w-48 flex-col md:sticky md:top-0 md:h-screen`}
      style={{ borderRight: "1px solid var(--border)", background: "var(--bg-1)" }}
    >
      {/* Wordmark */}
      <div className="hidden md:flex items-center gap-2.5 px-4 py-4">
        <img src="/meridian-logo.png" alt="Meridian" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, objectFit: "contain" }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-display)", letterSpacing: "-0.03em", color: "var(--fg-0)", lineHeight: 1 }}>Meridian</div>
          <div style={{ fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-4)", fontFamily: "var(--font-mono)", marginTop: 2 }}>Ops Hub</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "0 8px 8px", overflowY: "auto" }} className="scr">
        {visibleSections.map((section, idx) => (
          <div key={section.label} style={{ marginTop: idx === 0 ? 0 : 8 }}>
            <div style={{
              fontSize: 9, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: "0.2em", color: "var(--fg-4)",
              fontFamily: "var(--font-mono)",
              padding: "10px 8px 4px",
            }}>
              {section.label}
            </div>
            {section.items.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={buildHref(item)}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  onClick={() => setMobile(false)}
                  className={active ? "nav-active" : ""}
                  // On hover rather than inline: thirty blurbs would double the
                  // rail's height for people who already know their own sidebar,
                  // while the ones who need it are new staff hovering to find out.
                  title={item.blurb || undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    position: "relative",
                    padding: "6px 10px 6px 16px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: active ? "var(--accent-h)" : "var(--fg-1)",
                    background: active ? "rgba(160,126,245,0.12)" : "transparent",
                    textDecoration: "none",
                    transition: "background 0.15s, color 0.15s",
                    lineHeight: 1.3,
                  }}
                >
                  {active && (
                    <span style={{
                      position: "absolute",
                      left: 5,
                      top: "22%",
                      bottom: "22%",
                      width: 2,
                      borderRadius: 2,
                      background: "var(--accent)",
                      boxShadow: "0 0 6px rgba(160,126,245,0.6)",
                    }} />
                  )}
                  {item.name}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: "8px 10px 10px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
        {auth.isOwner && !auth._impersonating && (
          <ImpersonateControl />
        )}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={toggleTheme}
            style={{
              flex: 1, padding: "7px 4px", borderRadius: 8,
              fontSize: 10, fontWeight: 500, cursor: "pointer",
              color: "var(--fg-2)", background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)", transition: "background 0.15s",
            }}
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <a
            href="/api/auth/logout"
            style={{
              flex: 1, padding: "7px 4px", borderRadius: 8,
              fontSize: 10, fontWeight: 500, cursor: "pointer",
              color: "var(--red)", background: "rgba(248,113,113,0.07)",
              border: "1px solid rgba(248,113,113,0.18)",
              textDecoration: "none", textAlign: "center", display: "block",
            }}
          >
            Sign out
          </a>
        </div>
        {auth.displayName && (
          <div style={{ fontSize: 9, color: "var(--fg-4)", fontFamily: "var(--font-mono)", textAlign: "center", letterSpacing: "0.06em" }}>
            {auth.displayName || auth.name} · {auth.isEventTeam ? 'Event Team' : auth.isLeadStoryteller ? 'Lead Storyteller' : `L${auth.level}`}
          </div>
        )}
      </div>
    </aside>
  );
}

function ViewAsBanner({ auth }) {
  if (!auth) return null;

  // Full user impersonation (cookie-based) — _realId is only set by the session API
  if (auth._realId) {
    return (
      <div className="w-full flex items-center justify-center gap-3 py-2 px-4 text-[11px] font-bold uppercase tracking-widest sticky top-0 z-50"
        style={{ background: "#ef4444", color: "white" }}>
        <span>⚠ Viewing as {auth.displayName || auth.name} (L{auth.level}) — you are {auth._realName || "the owner"}</span>
        <button
          onClick={async () => { await fetch('/api/staff/impersonate', { method: 'DELETE' }); window.location.reload(); }}
          style={{ background: "white", color: "#ef4444", border: "none", cursor: "pointer", fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}
        >
          Exit
        </button>
      </div>
    );
  }

  return null;
}

function ImpersonateControl() {
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);

  const openPanel = async () => {
    setOpen(true);
    if (staff.length === 0) {
      const res = await fetch('/api/staff/impersonate');
      if (res.ok) setStaff(await res.json());
    }
  };

  const impersonate = async (discordId) => {
    setLoading(true);
    await fetch('/api/staff/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordId }),
    });
    setLoading(false);
    window.location.reload();
  };

  if (!open) {
    return (
      <button onClick={openPanel}
        style={{ width: "100%", padding: "6px 10px", borderRadius: 8, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--red)", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)", cursor: "pointer", fontFamily: "var(--font-mono)" }}>
        Impersonate User
      </button>
    );
  }

  return (
    <div style={{ background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--red)", fontFamily: "var(--font-mono)" }}>Impersonate</span>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--fg-4)", cursor: "pointer", fontSize: 10, lineHeight: 1 }}>✕</button>
      </div>
      <div style={{ maxHeight: 180, overflowY: "auto" }} className="scr">
        {staff.map(s => (
          <button key={s.discord_id} onClick={() => impersonate(s.discord_id)} disabled={loading}
            style={{ width: "100%", textAlign: "left", padding: "5px 8px", borderRadius: 6, fontSize: 11, cursor: "pointer", background: "transparent", border: "none", color: "var(--fg-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(248,113,113,0.1)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <span>{s.display_name}</span>
            <span style={{ fontSize: 9, color: "var(--fg-4)", fontFamily: "var(--font-mono)" }}>L{s.clearance}</span>
          </button>
        ))}
      </div>
    </div>
  );
}


export default function FMLayout({ children }) {
  const auth = useAuth();
  const [mobile, setMobile] = useState(false);
  const [theme, setTheme] = useState("dark");

  // One storage key for both shells ("meridian-theme", same as the root script and /v2); the old underscore key
  // is read once so nobody's choice is lost, and dark is the default.
  useEffect(() => {
    let saved = "dark";
    try {
      saved = localStorage.getItem("meridian-theme") || localStorage.getItem("meridian_theme") || "dark";
      if (saved !== "light") saved = "dark";
      localStorage.setItem("meridian-theme", saved);
    } catch {}
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("meridian-theme", next); } catch {}
    document.documentElement.setAttribute("data-theme", next);
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen" style={{ background: "var(--bg-0)" }}>
      {/* Mobile header */}
      <header
        className="md:hidden flex items-center justify-between px-5 py-3.5 border-b"
        style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-display)", letterSpacing: "-0.03em", color: "var(--fg-0)" }}>Meridian</div>
        <button
          onClick={() => setMobile(!mobile)}
          style={{ fontSize: 10, fontWeight: 600, padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", color: "var(--fg-2)", background: "transparent", cursor: "pointer" }}
        >
          {mobile ? "Close" : "Menu"}
        </button>
      </header>

      <Suspense fallback={<aside className="hidden md:block w-48 border-r" style={{ borderColor: "var(--border)", background: "var(--bg-1)" }} />}>
        <SidebarInner mobile={mobile} setMobile={setMobile} theme={theme} toggleTheme={toggleTheme} auth={auth} />
      </Suspense>

      <main className={`flex-1 overflow-y-auto ${mobile ? "hidden md:block" : "block"}`} style={{ background: "var(--bg-0)" }}>
        <AuthContext.Provider value={auth}>
          <DialogProvider><ViewAsBanner auth={auth} />{children}</DialogProvider>
        </AuthContext.Provider>
      </main>
    </div>
  );
}
