"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import {
  getLoreEntries, getCommandEntries, getSceneLibrary, getLoadouts, getNPCs, getChangeLogs,
} from "../../fm/storytelling/actions.js";

export default function V2Story() {
  const auth = useAuth();
  const level = auth?.level || 0;
  const [tab, setTab] = useState("kb");
  const [kbType, setKbType] = useState("lore");
  const [q, setQ] = useState("");
  const [data, setData] = useState({});   // tab → rows
  const [loaded, setLoaded] = useState({});
  const [busy, setBusy] = useState(false);

  const canNPC = level >= 2 || auth?.isLeadStoryteller;

  const loaders = {
    kb: async () => ({ lore: await getLoreEntries().catch(() => []), command: await getCommandEntries().catch(() => []) }),
    scenes: () => getSceneLibrary().catch(() => []),
    arsenal: () => getLoadouts().catch(() => []),
    npcs: () => getNPCs().catch(() => []),
    changelog: () => getChangeLogs().catch(() => []),
  };

  const ensure = async (t) => {
    if (loaded[t]) return;
    setBusy(true);
    const rows = await loaders[t]();
    setData(d => ({ ...d, [t]: rows }));
    setLoaded(l => ({ ...l, [t]: true }));
    setBusy(false);
  };

  useEffect(() => { if (!auth?.loading && auth?.id) ensure("kb"); }, [auth?.id, auth?.loading]);
  useEffect(() => { if (!auth?.loading && auth?.id) { setQ(""); ensure(tab); } }, [tab]);

  if (auth?.loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  const TABS = [
    { id: "kb", label: "Knowledge Base" },
    { id: "scenes", label: "Scene Library" },
    { id: "arsenal", label: "Arsenal" },
    ...(canNPC ? [{ id: "npcs", label: "NPC Ecosystem" }] : []),
    { id: "changelog", label: "Change Log" },
  ];
  const needle = q.trim().toLowerCase();
  const match = (s) => !needle || (s || "").toLowerCase().includes(needle);

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Storytelling</p>
          <h1>Reference library</h1>
          <div className="sub">Lore, scenes, arsenal and the world map — the material you consult while running the server.</div>
        </div>
      </div>

      <div className="hub-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`hub-tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab !== "kb" && (
        <input className="filter-inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" style={{ marginBottom: 16, maxWidth: 380 }} />
      )}
      {busy && !loaded[tab] && <div className="empty">Loading…</div>}

      {/* Knowledge Base */}
      {tab === "kb" && (
        <>
          <div className="sub-tabs" style={{ marginBottom: 10 }}>
            <button className={`tab${kbType === "lore" ? " on" : ""}`} onClick={() => setKbType("lore")}>Lore</button>
            <button className={`tab${kbType === "command" ? " on" : ""}`} onClick={() => setKbType("command")}>Command</button>
          </div>
          <input className="filter-inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" style={{ marginBottom: 16, maxWidth: 380 }} />
          {(() => {
            const entries = (data.kb?.[kbType] || []).filter(e => match(e.title) || match(e.content) || match(e.category));
            if (entries.length === 0) return <div className="empty">No entries.</div>;
            const byCat = entries.reduce((a, e) => { (a[e.category || "General"] = a[e.category || "General"] || []).push(e); return a; }, {});
            return Object.entries(byCat).map(([cat, list]) => (
              <div className="card" key={cat}>
                <div className="hd"><div className="t">{cat}</div><div className="meta">{list.length}</div></div>
                {list.map(e => (
                  <div className="note" key={e.id}>
                    <div style={{ fontWeight: 700, color: "var(--ink-0)", fontSize: 13, marginBottom: 3 }}>{e.title}</div>
                    <div style={{ whiteSpace: "pre-wrap", color: "var(--ink-1)" }}>{e.content}</div>
                    {e.notes ? <div className="by">Note: {e.notes}</div> : null}
                  </div>
                ))}
              </div>
            ));
          })()}
        </>
      )}

      {/* Scene Library */}
      {tab === "scenes" && loaded.scenes && (
        (() => {
          const rows = (data.scenes || []).filter(s => match(s.title) || match(s.description) || match(s.category) || match(s.tags));
          if (rows.length === 0) return <div className="empty">No scenes.</div>;
          return <div className="card">
            <div className="hd"><div className="t">Scene ideas</div><div className="meta">{rows.length}</div></div>
            {rows.map(s => (
              <div className="note" key={s.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, color: "var(--ink-0)", fontSize: 13 }}>{s.title}</span>
                  {s.status ? <span className="chip role">{s.status}</span> : null}
                  {s.category ? <span className="chip role">{s.category}</span> : null}
                  {s.proposed_rewards ? <span className="chip lock">{s.proposed_rewards}</span> : null}
                </div>
                <div style={{ whiteSpace: "pre-wrap", color: "var(--ink-1)" }}>{s.description}</div>
                {(s.staff_required || s.spawning_required || s.ped_required) ? (
                  <div className="by">{[s.staff_required && `Staff: ${s.staff_required}`, s.spawning_required && `Spawning: ${s.spawning_required}`, s.ped_required && `Peds: ${s.ped_required}`].filter(Boolean).join(" · ")}</div>
                ) : null}
              </div>
            ))}
          </div>;
        })()
      )}

      {/* Arsenal */}
      {tab === "arsenal" && loaded.arsenal && (
        (() => {
          const rows = (data.arsenal || []).filter(w => match(w.weapon_name) || match(w.weapon_category) || match(w.caliber) || (w.ammo || []).some(a => match(a.ammo_name)));
          if (rows.length === 0) return <div className="empty">No weapons.</div>;
          const byCat = rows.reduce((a, w) => { (a[w.weapon_category || "Other"] = a[w.weapon_category || "Other"] || []).push(w); return a; }, {});
          return Object.entries(byCat).map(([cat, list]) => (
            <div className="card" key={cat}>
              <div className="hd"><div className="t">{cat}</div><div className="meta">{list.length}</div></div>
              <table className="dtable">
                <thead><tr><th>Weapon</th><th>Caliber</th><th>Ammo</th><th style={{ textAlign: "right" }}>Attach.</th></tr></thead>
                <tbody>
                  {list.map(w => (
                    <tr key={w.id}>
                      <td><b>{w.weapon_name}</b></td>
                      <td style={{ color: "var(--ink-2)" }}>{w.caliber || "—"}</td>
                      <td>{(w.ammo || []).map(a => a.ammo_name).join(", ") || "—"}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{(w.attachments || []).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ));
        })()
      )}

      {/* NPCs */}
      {tab === "npcs" && loaded.npcs && (
        (() => {
          const rows = (data.npcs || []).filter(n => match(n.name) || match(n.turf) || match(n.npc_type) || match(n.position));
          if (rows.length === 0) return <div className="empty">No NPCs.</div>;
          return <div className="card">
            <div className="hd"><div className="t">NPCs</div><div className="meta">{rows.length} of {(data.npcs || []).length}</div></div>
            <div style={{ overflowX: "auto" }}>
              <table className="dtable" style={{ minWidth: 640 }}>
                <thead><tr><th>Name</th><th>Type</th><th>Turf</th><th>Position</th><th>Shipment</th></tr></thead>
                <tbody>
                  {rows.map(n => (
                    <tr key={n.id}>
                      <td><b>{n.name}</b></td>
                      <td style={{ color: "var(--ink-2)" }}>{n.npc_type || "—"}</td>
                      <td>{n.turf || "—"}</td>
                      <td style={{ color: "var(--ink-2)" }}>{n.position || "—"}</td>
                      <td style={{ color: "var(--ink-2)" }}>{n.shipment_power || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>;
        })()
      )}

      {/* Change Log */}
      {tab === "changelog" && loaded.changelog && (
        (() => {
          const rows = (data.changelog || []).filter(c => match(c.name) || match(c.change_type) || match(c.action) || match(c.notes));
          if (rows.length === 0) return <div className="empty">No changes logged.</div>;
          return <div className="card">
            <div className="hd"><div className="t">Change log</div><div className="meta">{rows.length}</div></div>
            {rows.map(c => (
              <div className="note" key={c.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                  {c.change_type ? <span className="chip role">{c.change_type}</span> : null}
                  <span style={{ fontWeight: 700, color: "var(--ink-0)" }}>{c.name}</span>
                  {c.action ? <span style={{ color: "var(--ink-2)" }}>· {c.action}</span> : null}
                </div>
                {c.position ? <div style={{ color: "var(--ink-1)" }}>{c.position}</div> : null}
                {c.notes ? <div style={{ color: "var(--ink-2)" }}>{c.notes}</div> : null}
                <div className="by">— {c.created_by || "System"}{c.created_at ? ` · ${c.created_at.slice(0, 10)}` : ""}</div>
              </div>
            ))}
          </div>;
        })()
      )}
    </div>
  );
}
