"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect } from "react";
import { useAuth } from "../../lib/useAuth";
import { DialogProvider } from "../../lib/useDialog";
import { AuthContext } from "../../lib/AuthContext.js";

const SECTIONS = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", href: "/fm/dashboard", eventTeam: true },
      { name: "Factions", href: "/fm/factions", eventTeam: true },
      { name: "Teams", href: "/fm/teams" },
      { name: "Scenes", href: "/fm/scenes", eventTeam: true },
      // L2: the same floor as the three roles that can work an item in Discord
      // (Team Leads, Leadership, Game Affairs). The section itself has no
      // minLevel, so this item carries its own.
      { name: "Faction Feedback", href: "/fm/feedback", level: 2 },
      { name: "Documents", href: "/fm/documents", eventTeam: true },
    ],
  },
  {
    label: "Communications",
    items: [
      { name: "Announcements",    href: "/fm/communications" },
      { name: "IC Communication", href: "/fm/communications/ic" },
      { name: "Meeting Notes",    href: "/fm/leadership/notes" },
      { name: "IC Contacts",      href: "/fm/leadership/contacts", level: 3 },
    ],
  },
  {
    label: "Leadership",
    minLevel: 2,
    items: [
      { name: "Reviews", href: "/fm/leadership/reviews" },
      { name: "Performance", href: "/fm/leadership/performance" },
    ],
  },
  {
    label: "Storytelling",
    items: [
      { name: "Knowledge Base", href: "/fm/storytelling/kb", eventTeam: true },
      { name: "Scene Library", href: "/fm/storytelling/library", eventTeam: true },
      { name: "Arsenal", href: "/fm/storytelling/loadouts", eventTeam: true },
      { name: "Change Log", href: "/fm/storytelling/changelog", eventTeam: true },
      { name: "NPC Ecosystem", href: "/fm/storytelling/network", level: 2, eventTeam: true, lst: true },
    ],
  },
  {
    label: "Handover",
    minLevel: 3,
    items: [
      { name: "Server Handover", href: "/fm/handover" },
    ],
  },
  {
    label: "Operations",
    minLevel: 3,
    items: [
      { name: "Inventory", href: "/fm/inventory", minView: 2, lst: true },
      { name: "Properties", href: "/fm/operations/properties", eventTeam: true, minView: 2, lst: true },
      { name: "Imports", href: "/fm/operations/imports", eventTeam: true, minView: 2, lst: true },
      { name: "Fleet", href: "/fm/operations/fleet" },
      { name: "Vehicle Catalog", href: "/fm/operations/vehicles", eventTeam: true, minView: 2, lst: true },
      { name: "Conversations", href: "/fm/operations/conversations" },
      { name: "Archive", href: "/fm/operations/archive" },
      { name: "Audit Log", href: "/fm/operations/audit", eventTeam: true },
      { name: "Recurring Reminders", href: "/fm/operations/reminders", level: 2 },
      { name: "Important Links", href: "/fm/operations/links" },
      { name: "Staff", href: "/fm/operations/staff" },
      { name: "Discord & Access", href: "/fm/operations/discord" },
      { name: "Member Log",  href: "/fm/operations/memberlog",  userId: "738214924760907907" },
      { name: "FM Hours",    href: "/fm/operations/fmhours",    userId: "738214924760907907" },
      { name: "Staff Mgmt View", href: "/api/auth/verify-impersonate", userId: "738214924760907907", external: true },
    ],
  },
];

function SidebarInner({ mobile, setMobile, theme, toggleTheme, auth }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams?.get("tab") || "";

  const isActive = (item) => {
    if (item.href === "/fm/operations" && pathname?.startsWith("/fm/operations/staff")) return false;
    if (item.href === "/fm/operations/staff") return pathname?.startsWith("/fm/operations/staff");
    if (!pathname?.startsWith(item.href)) return false;
    if (!item.tabId) return true;
    if (currentTab) return currentTab === item.tabId;
    return !!item.default;
  };

  const buildHref = (item) => item.tabId ? `${item.href}?tab=${item.tabId}` : item.href;

  // Per-item visibility. A section is shown iff it has at least one visible item,
  // so an item can be exposed below its section's minLevel (via `minView`) or to
  // Lead Storytellers (via `lst`) without unlocking the rest of the section.
  const itemAllowed = (item, section) => {
    // Event Team: only ever see ET-flagged items, in any section.
    if (auth.isEventTeam) return !!item.eventTeam;
    // Items restricted to a specific user. Hidden while impersonating / viewing-as
    // so the impersonator sees ONLY what the target sees (never via _realId).
    if (item.userId) return !auth._impersonating && auth.id === item.userId;
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
                  key={`${item.href}-${item.tabId || "main"}`}
                  href={buildHref(item)}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noopener noreferrer" : undefined}
                  onClick={() => setMobile(false)}
                  className={active ? "nav-active" : ""}
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
        {(auth.id === '738214924760907907' || auth._realId === '738214924760907907') && !auth._impersonating && (
          <ImpersonateControl />
        )}
        {(auth.level === 3 || auth._realLevel === 3) && !auth._impersonating && (
          <ViewAsControl currentLevel={auth.level} realLevel={auth._realLevel || auth.level} isViewingAsET={auth._viewAsEventTeam} isViewingAsLST={auth._viewAsLeadStoryteller} />
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
            {auth.displayName || auth.name} · {auth.isEventTeam ? 'Event Team' : `L${auth.level}`}
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
        <span>⚠ Impersonating: {auth.displayName || auth.name} (L{auth.level})</span>
        <button
          onClick={async () => { await fetch('/api/staff/impersonate', { method: 'DELETE' }); window.location.reload(); }}
          style={{ background: "white", color: "#ef4444", border: "none", cursor: "pointer", fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}
        >
          Exit
        </button>
      </div>
    );
  }

  // Event Team view-as (localStorage-based)
  if (auth._viewAsEventTeam) {
    return (
      <div className="w-full flex items-center justify-center gap-3 py-2 px-4 text-[11px] font-bold uppercase tracking-widest sticky top-0 z-50"
        style={{ background: "var(--amber)", color: "black" }}>
        <span>Viewing as Event Team — real level is L{auth._realLevel}</span>
        <button
          onClick={() => { localStorage.removeItem("meridian-view-as"); window.dispatchEvent(new Event("meridian-view-as-changed")); }}
          style={{ background: "black", color: "var(--amber)", border: "none", cursor: "pointer", fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}
        >
          Reset
        </button>
      </div>
    );
  }

  // Lead Storyteller view-as (localStorage-based)
  if (auth._viewAsLeadStoryteller) {
    return (
      <div className="w-full flex items-center justify-center gap-3 py-2 px-4 text-[11px] font-bold uppercase tracking-widest sticky top-0 z-50"
        style={{ background: "var(--amber)", color: "black" }}>
        <span>Viewing as Lead Storyteller — real level is L{auth._realLevel}</span>
        <button
          onClick={() => { localStorage.removeItem("meridian-view-as"); window.dispatchEvent(new Event("meridian-view-as-changed")); }}
          style={{ background: "black", color: "var(--amber)", border: "none", cursor: "pointer", fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}
        >
          Reset
        </button>
      </div>
    );
  }

  // Level-only view-as (localStorage-based)
  if (auth._realLevel && auth.level !== auth._realLevel) {
    const labels = { 1: "L1 (Guide)", 2: "L2 (Lead)", 3: "L3 (Management)" };
    return (
      <div className="w-full flex items-center justify-center gap-3 py-2 px-4 text-[11px] font-bold uppercase tracking-widest sticky top-0 z-50"
        style={{ background: "var(--amber)", color: "black" }}>
        <span>Viewing as {labels[auth.level] || `L${auth.level}`} — real level is {labels[auth._realLevel] || `L${auth._realLevel}`}</span>
        <button
          onClick={() => { localStorage.removeItem("meridian-view-as"); window.dispatchEvent(new Event("meridian-view-as-changed")); }}
          style={{ background: "black", color: "var(--amber)", border: "none", cursor: "pointer", fontSize: 10, padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}
        >
          Reset
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

function ViewAsControl({ currentLevel, realLevel, isViewingAsET, isViewingAsLST }) {
  const [open, setOpen] = useState(false);
  const setLevel = (lvl) => {
    if (typeof window === "undefined") return;
    if (lvl === null) localStorage.removeItem("meridian-view-as");
    else localStorage.setItem("meridian-view-as", String(lvl));
    window.dispatchEvent(new Event("meridian-view-as-changed"));
    setOpen(false);
  };
  const isImpersonating = isViewingAsET || isViewingAsLST || currentLevel !== realLevel;
  const activeLabel = isViewingAsET ? "ET" : isViewingAsLST ? "LST" : (isImpersonating ? `L${currentLevel}` : "Real");

  return (
    <div style={{ padding: "0 2px" }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 10px", borderRadius: 8, fontSize: 9, fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.12em",
            color: isImpersonating ? "var(--amber)" : "var(--fg-3)",
            background: isImpersonating ? "rgba(251,191,36,0.08)" : "transparent",
            border: `1px solid ${isImpersonating ? "rgba(251,191,36,0.2)" : "var(--border)"}`,
            cursor: "pointer", fontFamily: "var(--font-mono)",
          }}
        >
          <span>View as · {activeLabel}</span>
          <span style={{ opacity: 0.5 }}>▾</span>
        </button>
      ) : (
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 10, padding: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--fg-4)", fontFamily: "var(--font-mono)" }}>
              View As{isImpersonating && <span style={{ color: "var(--amber)", marginLeft: 4 }}>· Active</span>}
            </span>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--fg-4)", cursor: "pointer", fontSize: 10, lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 4 }}>
            {[{ lvl: null, label: "Real" }, { lvl: 1, label: "L1" }, { lvl: 2, label: "L2" }, { lvl: 3, label: "L3" }, { lvl: "event_team", label: "ET" }, { lvl: "lead_storyteller", label: "LST" }].map((opt) => {
              const active = opt.lvl === null
                ? !isImpersonating
                : opt.lvl === "event_team"
                  ? isViewingAsET
                  : opt.lvl === "lead_storyteller"
                    ? isViewingAsLST
                    : currentLevel === opt.lvl && !isViewingAsET && !isViewingAsLST && isImpersonating;
              return (
                <button key={opt.label} onClick={() => setLevel(opt.lvl)} style={{
                  padding: "4px 0", borderRadius: 6, fontSize: 9, fontWeight: 700,
                  cursor: "pointer", fontFamily: "var(--font-mono)",
                  background: active ? "rgba(160,126,245,0.2)" : "transparent",
                  color: active ? "var(--accent-h)" : "var(--fg-3)",
                  border: `1px solid ${active ? "rgba(160,126,245,0.3)" : "var(--border)"}`,
                }}>
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FMLayout({ children }) {
  const auth = useAuth();
  const [mobile, setMobile] = useState(false);
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
