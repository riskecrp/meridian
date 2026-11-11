"use client";
// Storytelling › NPC Ecosystem — turfs and their NPCs, grouped or filtered by
// type, with TP copy and the GTA map. Read: L2+, Event Team and Lead
// Storytellers (getNPCs / getTurfs: requireActor(2, READ)). Edit: L3 only —
// Event Team is read-only here (policy 4).
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getNPCs, getTurfs, addNPC, editNPC, deleteNPC, updateTurf, disbandTurf } from "../../fm/storytelling/actions.js";
import { Card, Badge, Button, Field, Empty, Modal, useAction } from "../ui.js";
import { useCopy, CopyButton, confirmIt } from "../library/shared.js";

const GTAMap = dynamic(() => import("../../../lib/GTAMap"), { ssr: false, loading: () => <div className="skeleton block map-wrap" /> });
const NEUTRAL = "Neutral";
const isNeutral = (t) => ["", "neutral", "unaffiliated"].includes(String(t || "").trim().toLowerCase());

export default function Npcs({ auth, initialQ = "" }) {
  const isL3 = (auth.level || 0) >= 3;
  const [npcs, setNpcs] = useState(null);
  const [turfs, setTurfs] = useState([]);
  const [loadErr, setLoadErr] = useState("");
  const [search, setSearch] = useState(initialQ);
  const [filter, setFilter] = useState(null);        // null | type | "__neutral"
  const [mapView, setMapView] = useState(false);
  const [mapTurf, setMapTurf] = useState(null);
  const [npcForm, setNpcForm] = useState(null);      // { id?, name, position, type, customType?, turf }
  const [turfForm, setTurfForm] = useState(null);    // { oldTurf, newTurf, power }
  const [copied, copy] = useCopy();
  const { run, busy } = useAction();

  const load = async () => { try { const [n, t] = await Promise.all([getNPCs(), getTurfs()]); setNpcs(n || []); setTurfs(t || []); setLoadErr(""); } catch (e) { setNpcs([]); setLoadErr(e?.message || "Could not load the NPC ecosystem."); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (initialQ) { setSearch(initialQ); setMapView(false); setFilter(null); } }, [initialQ]);

  const all = npcs || [];
  const network = useMemo(() => {
    const net = {};
    turfs.forEach(t => { const nm = (t.name || "").trim(); if (!nm || isNeutral(nm)) return; net[nm] = { name: nm, power: t.shipment_power || "", npcs: [] }; });
    all.forEach(n => { let t = (n.turf || "").trim() || NEUTRAL; if (isNeutral(t)) t = NEUTRAL; if (!net[t]) net[t] = { name: t, power: n.shipment_power || "", npcs: [] }; net[t].npcs.push(n); });
    const q = search.toLowerCase();
    return Object.values(net).filter(t => !q || t.name.toLowerCase().includes(q) || t.npcs.some(n => (n.name || "").toLowerCase().includes(q) || (n.npc_type || "").toLowerCase().includes(q)))
      .sort((a, b) => a.name === NEUTRAL ? 1 : b.name === NEUTRAL ? -1 : a.name.localeCompare(b.name));
  }, [all, turfs, search]);
  const counts = useMemo(() => all.reduce((a, n) => { const t = (n.npc_type || "Unknown").trim(); a[t] = (a[t] || 0) + 1; return a; }, {}), [all]);
  const neutralCount = all.filter(n => isNeutral(n.turf)).length;
  const flat = useMemo(() => {
    if (!filter) return [];
    const q = search.toLowerCase();
    const base = filter === "__neutral" ? all.filter(n => isNeutral(n.turf)) : all.filter(n => (n.npc_type || "").trim().toLowerCase() === filter.toLowerCase());
    return base.filter(n => !q || (n.name || "").toLowerCase().includes(q) || (n.turf || "").toLowerCase().includes(q)).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [all, filter, search]);
  const npcTypes = useMemo(() => [...new Set(all.map(n => (n.npc_type || "").trim()).filter(Boolean))].sort(), [all]);
  const turfNames = useMemo(() => [...new Set([...turfs.map(t => (t.name || "").trim()), ...all.map(n => (n.turf || "").trim())].filter(t => t && !isNeutral(t)))].sort(), [turfs, all]);
  const mapTurfs = useMemo(() => [...new Set(all.map(n => (isNeutral(n.turf) ? NEUTRAL : n.turf.trim())))].sort(), [all]);

  const saveNPC = () => {
    const p = { ...npcForm, type: npcForm.type === "__new" ? (npcForm.customType || "").trim() : npcForm.type, turf: npcForm.turf || NEUTRAL };
    run(() => npcForm.id ? editNPC(npcForm.id, p) : addNPC(p), { success: npcForm.id ? "NPC saved." : "NPC added.", onDone: () => { setNpcForm(null); load(); } });
  };
  const removeNPC = (n) => { if (!confirmIt(`Delete “${n.name}”?`)) return; run(() => deleteNPC(n.id), { success: "NPC deleted.", onDone: load }); };
  const saveTurf = () => run(() => updateTurf(turfForm.oldTurf, turfForm.newTurf, turfForm.power), { success: turfForm.oldTurf ? "Turf updated." : "Turf created.", onDone: () => { setTurfForm(null); load(); } });
  const disband = (t) => { if (!confirmIt(`Disband “${t.name}”? Its NPCs become Neutral.`)) return; run(() => disbandTurf(t.name), { success: "Turf disbanded.", onDone: load }); };

  const NpcRow = (n) => (
    <div className="line" key={n.id}>
      <span className="tiny faint mono hide-sm" style={{ minWidth: 80, textTransform: "uppercase" }}>{n.npc_type}</span>
      <span className="t">{n.name}</span>
      {filter && <Badge tone="accent">{n.turf || NEUTRAL}</Badge>}
      <span className="spacer" />
      <span className="tiny faint mono hide-sm">{n.position}</span>
      <CopyButton text={`/tppos ${n.position}`} id={`npc-${n.id}`} copied={copied} copy={copy} label="TP" title="Copy /tppos" />
      {isL3 && <span className="actions-inline">
        <Button size="sm" variant="ghost" onClick={() => setNpcForm({ id: n.id, name: n.name || "", position: n.position || "", type: n.npc_type || "", turf: isNeutral(n.turf) ? NEUTRAL : n.turf })}>Edit</Button>
        <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => removeNPC(n)}>✕</Button>
      </span>}
    </div>
  );

  if (npcs === null) return <div className="stack"><div className="skeleton row" /><div className="skeleton block" /></div>;

  return (
    <div className="stack">
      <div className="row">
        <input className="inp grow" placeholder="Search turfs or NPCs…" value={search} onChange={e => setSearch(e.target.value)} />
        <Button variant="ghost" onClick={() => { setMapView(v => !v); setMapTurf(null); }}>{mapView ? "List" : "Map"}</Button>
        {isL3 && <Button variant="ghost" onClick={() => setTurfForm({ oldTurf: "", newTurf: "", power: "" })}>+ Turf</Button>}
        {isL3 && <Button onClick={() => setNpcForm({ name: "", position: "", type: "", turf: NEUTRAL })}>+ NPC</Button>}
      </div>
      {loadErr && <div className="err">{loadErr}</div>}

      {mapView ? (
        <Card flush>
          <div className="map-wrap"><GTAMap npcs={filter && filter !== "__neutral" ? all.filter(n => (n.npc_type || "").trim().toLowerCase() === filter.toLowerCase()) : filter === "__neutral" ? all.filter(n => isNeutral(n.turf)) : all} selectedTurf={mapTurf} height={520} /></div>
          <div className="chips" style={{ padding: 12 }}>
            <button className={`chip tag${!mapTurf ? " on" : ""}`} onClick={() => setMapTurf(null)}>All NPCs</button>
            {mapTurfs.map(t => <button key={t} className={`chip tag${mapTurf === t ? " on" : ""}`} onClick={() => setMapTurf(t)}>{t}</button>)}
          </div>
        </Card>
      ) : (
        <>
          <div className="chips">
            {Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).map(([t, n]) => <button key={t} className={`chip tag${filter === t ? " on" : ""}`} onClick={() => setFilter(filter === t ? null : t)}>{n} {t}</button>)}
            {neutralCount > 0 && <button className={`chip tag${filter === "__neutral" ? " on warn" : ""}`} onClick={() => setFilter(filter === "__neutral" ? null : "__neutral")}>{neutralCount} Neutral</button>}
          </div>
          {all.length === 0 && <Empty title="No NPCs yet">{isL3 ? "Add the first one with “+ NPC”." : ""}</Empty>}
          {filter ? (
            <Card title={filter === "__neutral" ? "Neutral dealers" : filter} right={<Badge>{flat.length}</Badge>}>
              <div className="list">{flat.length ? flat.map(NpcRow) : <div className="tiny faint">Nothing matches.</div>}</div>
            </Card>
          ) : network.map(turf => (
            <Card key={turf.name} title={<>{turf.name}{turf.name !== NEUTRAL && <Badge tone="accent" title="Shipment power">PWR {turf.power || "—"}</Badge>}</>}
              right={<span className="actions-inline"><Badge>{turf.npcs.length}</Badge>
                {isL3 && turf.name !== NEUTRAL && <>
                  <Button size="sm" variant="ghost" onClick={() => setTurfForm({ oldTurf: turf.name, newTurf: turf.name, power: turf.power })}>Edit</Button>
                  <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => disband(turf)}>Disband</Button>
                </>}</span>}>
              <div className="list">{turf.npcs.length ? turf.npcs.map(NpcRow) : <div className="tiny faint">No NPCs on this turf yet.</div>}</div>
            </Card>
          ))}
          {all.length > 0 && !filter && network.length === 0 && <Empty title="No turfs or NPCs match">Try another search.</Empty>}
        </>
      )}

      {npcForm && (
        <Modal title={`${npcForm.id ? "Edit" : "Add"} NPC`} onClose={() => setNpcForm(null)} onSave={saveNPC} saveDisabled={busy || !npcForm.name.trim() || !npcForm.position.trim() || !(npcForm.type === "__new" ? (npcForm.customType || "").trim() : npcForm.type)}>
          <Field label="Name"><input value={npcForm.name} onChange={e => setNpcForm({ ...npcForm, name: e.target.value })} /></Field>
          <Field label="TP position" help="x y z, as /tppos takes it"><input className="mono" value={npcForm.position} onChange={e => setNpcForm({ ...npcForm, position: e.target.value })} /></Field>
          <Field label="Type">
            <select value={npcForm.type} onChange={e => setNpcForm({ ...npcForm, type: e.target.value })}>
              <option value="">Select type…</option>
              {npcTypes.map(t => <option key={t} value={t}>{t}</option>)}
              <option value="__new">+ New type…</option>
            </select>
          </Field>
          {npcForm.type === "__new" && <Field label="New type name"><input value={npcForm.customType || ""} onChange={e => setNpcForm({ ...npcForm, customType: e.target.value })} /></Field>}
          <Field label="Turf">
            <select value={npcForm.turf} onChange={e => setNpcForm({ ...npcForm, turf: e.target.value })}>
              <option value={NEUTRAL}>Neutral</option>
              {turfNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </Modal>
      )}
      {turfForm && (
        <Modal title={turfForm.oldTurf ? `Edit turf — ${turfForm.oldTurf}` : "Create turf"} onClose={() => setTurfForm(null)} onSave={saveTurf} saveDisabled={busy || !turfForm.newTurf.trim()}>
          <Field label="Turf name" help={turfForm.oldTurf ? "Renaming onto an existing turf merges into it." : ""}><input value={turfForm.newTurf} onChange={e => setTurfForm({ ...turfForm, newTurf: e.target.value })} /></Field>
          <Field label="Shipment power"><input value={turfForm.power} onChange={e => setTurfForm({ ...turfForm, power: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
