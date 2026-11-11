"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getFactionTimeline } from "../../../fm/factions/actions.js";

// The hub's Timeline tab: one merged feed (history, audit, tasks, RP changes,
// reviews, feedback forms, scenes) from getFactionTimeline, newest first.
// Kind filters are client-side over what has been loaded; "Load more" pages
// further back with the last entry's cursor.
const KINDS = [["history", "History"], ["audit", "Audit"], ["task", "Tasks"], ["rp", "RP changes"], ["review", "Reviews"], ["feedback", "Feedback"], ["scene", "Scenes"]];
const KIND_LABEL = Object.fromEntries(KINDS);
const KIND_STYLE = {
  history: ["var(--accent-bg)", "var(--accent)"], audit: ["var(--panel-2)", "var(--ink-2)"], task: ["var(--amber-bg)", "var(--amber)"],
  rp: ["var(--sky-bg)", "var(--sky)"], review: ["var(--lock-bg)", "var(--lock)"], feedback: ["var(--rose-bg)", "var(--rose)"], scene: ["var(--good-bg)", "var(--good)"],
};
const PAGE = 50;
const when = (iso) => (iso ? iso.slice(0, 16).replace("T", " ") : "");

export default function Timeline({ factionId }) {
  const [entries, setEntries] = useState([]);
  const [on, setOn] = useState(() => new Set(KINDS.map(k => k[0])));
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");

  const load = async (before) => {
    setLoading(true); setErr("");
    try {
      const page = await getFactionTimeline(factionId, { limit: PAGE, before });
      setEntries(prev => (before ? [...prev, ...page] : page));
      setMore(page.length >= PAGE);
    } catch (e) { setErr(e?.message || "Could not load the timeline."); }
    setLoading(false);
  };
  useEffect(() => { if (factionId) load(); }, [factionId]);

  // A filter never empties the view: the last active kind stays on.
  const toggle = (k) => setOn(prev => { if (prev.has(k) && prev.size === 1) return prev; const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allOn = on.size === KINDS.length;
  const counts = entries.reduce((a, e) => { a[e.kind] = (a[e.kind] || 0) + 1; return a; }, {});
  const shown = entries.filter(e => on.has(e.kind));

  return (
    <div className="card">
      <div className="hd"><div className="t">Timeline</div><div className="meta">{shown.length}{allOn ? "" : ` of ${entries.length}`} loaded{more ? " · more below" : ""}</div></div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 0 4px" }}>
        <button className={`pill${allOn ? " on" : ""}`} onClick={() => setOn(new Set(KINDS.map(k => k[0])))}>All</button>
        {KINDS.map(([k, label]) => <button key={k} className={`pill${on.has(k) ? " on" : ""}`} onClick={() => toggle(k)}>{label}{counts[k] ? <span className="ct">{counts[k]}</span> : null}</button>)}
      </div>
      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
      {!loading && shown.length === 0 && <div className="empty">{entries.length === 0 ? "Nothing on record yet." : "Nothing of these kinds loaded — load more or widen the filter."}</div>}
      {shown.map(e => {
        const [bg, fg] = KIND_STYLE[e.kind] || KIND_STYLE.audit;
        return (
          <div className="clog" key={e.key}>
            <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", minWidth: 118 }}>{when(e.at)}</span>
            <span className="chip" style={{ background: bg, color: fg }}>{KIND_LABEL[e.kind] || e.kind}</span>
            <span style={{ color: "var(--ink-0)", fontWeight: 600 }}>{e.title}</span>
            {e.detail && <span style={{ color: "var(--ink-2)" }}>{e.detail}</span>}
            <span style={{ flex: 1 }} />
            {e.actor && <span style={{ fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{e.actor}</span>}
            {e.href && <Link className="act" style={{ padding: "2px 8px" }} href={e.href}>Open</Link>}
          </div>
        );
      })}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, paddingTop: 12 }}>
        {loading ? <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Loading…</span>
          : more ? <button className="act" onClick={() => load(entries[entries.length - 1]?.cursor)}>Load more</button>
          : entries.length > 0 ? <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>— start of the record —</span> : null}
      </div>
    </div>
  );
}
