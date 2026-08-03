"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getMyAttention, getAllDocuments } from "./actions.js";
import { getFactions } from "../fm/factions/actions.js";
import { getLoreEntries, getNPCs } from "../fm/storytelling/actions.js";

/* ── Global "+ New" — the four creation verbs, reachable from any page.
      Each lands on the page that owns the form, with a param that opens it. ── */
export function PlusMenu({ auth }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const level = auth?.level || 0;
  const items = [
    { label: "Task", sub: "Assign to a person or team", href: "/v2?create=task" },
    { label: "Event / Reminder", sub: "Scheduled, with optional 30-min ping", href: "/v2?create=event" },
    { label: "Scene log", sub: "Record outcome + rewards", href: "/v2/story?tab=scenelogs&new=1" },
    ...(level >= 2 || auth?.isLeadStoryteller ? [{ label: "Meeting note", sub: "Faction, team or group", href: "/v2/leadership?tab=notes&new=1" }] : []),
  ];
  const toggle = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: Math.max(8, r.right - 250) });
    setOpen(o => !o);
  };
  return (
    <>
      <button className="btn" style={{ padding: "0 12px", height: 30, fontSize: 12 }} onClick={toggle}>+ New</button>
      {open && createPortal(
        <div className="v2-root">
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 95, width: 250, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 10, padding: 6, boxShadow: "0 8px 28px rgba(0,0,0,.14)" }}>
            {items.map(it => (
              <button key={it.label} onClick={() => { setOpen(false); router.push(it.href); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 7, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--panel-2)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--ink-0)" }}>{it.label}</span>
                <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)" }}>{it.sub}</span>
              </button>
            ))}
          </div>
        </div>, document.body)}
    </>
  );
}

/* ── Bell: live inbox unread count, refreshed every 3 minutes. ── */
export function Bell({ auth }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!auth?.ok) return;
    let alive = true;
    const tick = () => getMyAttention().then(a => { if (alive) setN(a?.counts?.inboxUnread || 0); }).catch(() => {});
    tick();
    const iv = setInterval(tick, 180000);
    return () => { alive = false; clearInterval(iv); };
  }, [auth?.ok]);
  return (
    <Link href="/v2/inbox" className="tb-btn" title="Inbox" style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2a3.5 3.5 0 0 0-3.5 3.5V8L3 10.5h10L11.5 8V5.5A3.5 3.5 0 0 0 8 2zM6.5 12a1.5 1.5 0 0 0 3 0" /></svg>
      {n > 0 && (
        <span style={{ position: "absolute", top: -3, right: -3, minWidth: 15, height: 15, padding: "0 4px", borderRadius: 8, background: "var(--rose)", color: "#fff", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--v2-mono)" }}>{n > 99 ? "99+" : n}</span>
      )}
    </Link>
  );
}

/* ── ⌘K palette: jump to any section, faction, document, KB entry or NPC. ── */
export function CommandPalette({ auth, navTargets, open, setOpen }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [dyn, setDyn] = useState(null); // lazily loaded once per session
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const level = auth?.level || 0;
  const canNPC = level >= 2 || auth?.isEventTeam || auth?.isLeadStoryteller;

  useEffect(() => {
    if (!open) return;
    setQ(""); setSel(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    if (dyn === null) {
      Promise.all([
        getFactions().catch(() => []),
        getAllDocuments().catch(() => []),
        getLoreEntries().catch(() => []),
        canNPC ? getNPCs().catch(() => []) : Promise.resolve([]),
      ]).then(([facs, docs, lore, npcs]) => {
        const items = [];
        (facs || []).forEach(f => items.push({ kind: "Faction", label: f.name, sub: `T${f.tier}${f.teamName ? ` · ${f.teamName}` : ""}`, href: `/v2/factions/${encodeURIComponent(f.name)}` }));
        (docs || []).forEach(d => items.push({ kind: "Doc", label: d.title, sub: d.category, href: `/v2/story?tab=docs&sop=${encodeURIComponent(d.title)}` }));
        (lore || []).forEach(e => items.push({ kind: "KB", label: e.title, sub: e.category, href: `/v2/story?tab=kb&q=${encodeURIComponent(e.title)}` }));
        (npcs || []).forEach(n => items.push({ kind: "NPC", label: n.name, sub: n.turf || n.npc_type, href: `/v2/story?tab=npcs&q=${encodeURIComponent(n.name)}` }));
        setDyn(items);
      });
    }
  }, [open]);

  const all = useMemo(() => [...(navTargets || []), ...(dyn || [])], [navTargets, dyn]);
  const needle = q.trim().toLowerCase();
  const shown = (needle
    ? all.filter(i => `${i.label} ${i.sub || ""} ${i.kind}`.toLowerCase().includes(needle))
    : (navTargets || [])
  ).slice(0, 12);

  const go = (item) => { setOpen(false); router.push(item.href); };
  const onKey = (e) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, shown.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && shown[sel]) { e.preventDefault(); go(shown[sel]); }
  };

  if (!open) return null;
  const KIND_COLOR = { Faction: "var(--accent)", Doc: "var(--amber)", KB: "var(--good)", NPC: "var(--rose)" };
  return createPortal(
    <div className="v2-root">
      <div style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,0.35)" }} onClick={() => setOpen(false)} />
      <div style={{ position: "fixed", top: "14vh", left: "50%", transform: "translateX(-50%)", zIndex: 125, width: "min(560px, calc(100vw - 32px))", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,.22)", overflow: "hidden" }}>
        <input ref={inputRef} value={q} onKeyDown={onKey}
          onChange={e => { setQ(e.target.value); setSel(0); }}
          placeholder="Jump to a page, faction, document, KB entry, NPC…"
          style={{ width: "100%", padding: "13px 16px", fontSize: 14, background: "transparent", border: "none", borderBottom: "1px solid var(--line)", outline: "none", color: "var(--ink-0)", fontFamily: "inherit" }} />
        <div style={{ maxHeight: "46vh", overflowY: "auto", padding: 6 }}>
          {dyn === null && needle && <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--ink-3)" }}>Loading index…</div>}
          {shown.length === 0 && (dyn !== null || !needle) && <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--ink-3)" }}>No matches.</div>}
          {shown.map((item, i) => (
            <button key={`${item.kind}-${item.label}-${i}`} onClick={() => go(item)} onMouseEnter={() => setSel(i)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", background: i === sel ? "var(--accent-bg)" : "transparent" }}>
              <span className="chip" style={{ background: "color-mix(in srgb, " + (KIND_COLOR[item.kind] || "var(--ink-2)") + " 14%, transparent)", color: KIND_COLOR[item.kind] || "var(--ink-2)", flexShrink: 0 }}>{item.kind}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
              {item.sub && <span style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: "auto", flexShrink: 0 }}>{item.sub}</span>}
            </button>
          ))}
        </div>
        <div style={{ padding: "7px 12px", borderTop: "1px solid var(--line)", display: "flex", gap: 14, fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
        </div>
      </div>
    </div>, document.body);
}
