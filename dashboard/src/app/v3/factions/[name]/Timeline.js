"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getFactionTimeline } from "../../../fm/factions/actions.js";
import { translatePath } from "../../../../lib/uiRoutes.js";
import { Card, Badge, Button, Empty } from "../../ui.js";
import { short } from "../shared.js";

/* One merged feed (history, audit, tasks, RP changes, reviews, feedback forms,
   scenes) from getFactionTimeline, newest first. Kind filters are client-side
   over what has loaded; "Load more" pages further back with the last cursor.
   The server builds /v2 links; they are translated to this shell. */
const KINDS = [["history", "History", ""], ["audit", "Audit", ""], ["task", "Tasks", "warn"], ["rp", "RP changes", "info"], ["review", "Reviews", "lock"], ["feedback", "Feedback", "bad"], ["scene", "Scenes", "good"]];
const LABEL = Object.fromEntries(KINDS.map(k => [k[0], k[1]]));
const TONE = Object.fromEntries(KINDS.map(k => [k[0], k[2]]));
const PAGE = 50;

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
    <Card title="Timeline" right={<span className="muted small">{shown.length}{allOn ? "" : ` of ${entries.length}`} loaded{more ? " · more below" : ""}</span>}>
      <div className="chips mb-s">
        <button className={`chip${allOn ? " on" : ""}`} onClick={() => setOn(new Set(KINDS.map(k => k[0])))}>All</button>
        {KINDS.map(([k, label]) => <button key={k} className={`chip${on.has(k) ? " on" : ""}`} onClick={() => toggle(k)}>{label}{counts[k] ? <span className="ct">{counts[k]}</span> : null}</button>)}
      </div>
      {err && <div className="err">{err}</div>}
      {loading && entries.length === 0 && <div className="stack"><div className="skeleton sk-row" /><div className="skeleton sk-row" /><div className="skeleton sk-row" /></div>}
      {!loading && shown.length === 0 && <Empty title={entries.length === 0 ? "Nothing on record yet." : "Nothing of these kinds loaded."}>{entries.length === 0 ? null : "Load more or widen the filter."}</Empty>}
      {shown.map(e => (
        <div className="tl" key={e.key}>
          <span className="when">{short(e.at)}</span>
          <div className="body">
            <div className="t"><Badge tone={TONE[e.kind] || undefined}>{LABEL[e.kind] || e.kind}</Badge>{e.title}</div>
            {e.detail && <div className="d">{e.detail}</div>}
          </div>
          {e.actor && <span className="by">{e.actor}</span>}
          {e.href && <Link className="btn quiet sm" href={translatePath(e.href, "v3")}>Open</Link>}
        </div>
      ))}
      <div className="row center pt-m">
        {loading && entries.length > 0 ? <span className="hint">Loading…</span>
          : !loading && more ? <Button size="sm" variant="ghost" onClick={() => load(entries[entries.length - 1]?.cursor)}>Load more</Button>
          : !loading && entries.length > 0 ? <span className="mono tiny faint">— start of the record —</span> : null}
      </div>
    </Card>
  );
}
