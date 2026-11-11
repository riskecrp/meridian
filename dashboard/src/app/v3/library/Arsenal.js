"use client";
// Library › Arsenal. Loadouts (weapons with compatible ammo / attachments —
// read for everyone, edit L2+) and Spawn Commands (L3 and Event Team only, on
// the server too: getSpawnItems / add / edit / delete take requireActor(3, ET)).
// The spawn sub-section opens directly from the v2 "spawner" aliases.
import { useEffect, useMemo, useState } from "react";
import {
  getLoadouts, addWeapon, editWeapon, deleteWeapon, addAmmoCompat, removeAmmoCompat, addAttachmentCompat, removeAttachmentCompat,
  getAmmoList, getAttachmentList, getSpawnItems, addSpawnItem, editSpawnItem, deleteSpawnItem,
} from "../../fm/storytelling/actions.js";
import { Card, Badge, Button, Field, Empty, Modal, useAction } from "../ui.js";
import { useCopy, CopyButton, confirmIt } from "./shared.js";

const AMMO_TONE = { AP: "bad", FMJ: "warn", HP: "good", Tracer: "info" };
const SPAWN_TYPES = ["item", "weapon", "ammo", "component", "attachment", "vehicle"];
export const spawnCmd = (item, n) => {
  const t = (item.item_type || "").toLowerCase();
  if (t === "weapon" || t === "ammo") return `/GetWeapon ${item.game_id} ${n} 0`;
  if (t.includes("component") || t.includes("attachment")) return `/GetWeaponComponent ${item.game_id}`;
  return `/GetItem ${item.game_id} ${n}`;
};

export default function Arsenal({ auth, initialSub = "loadouts", initialQ = "" }) {
  const level = auth.level || 0;
  const canEdit = level >= 2;                           // weapons + compat
  const canMgmt = level >= 3 || !!auth.isEventTeam;     // spawn commands read
  const canSpawnWrite = level >= 3 || !!auth.isEventTeam;
  const [sub, setSub] = useState(canMgmt ? initialSub : "loadouts");
  const [d, setD] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const { run, busy } = useAction();
  const [copied, copy] = useCopy();

  const load = async () => {
    try {
      const [loadouts, ammo, att, spawns] = await Promise.all([getLoadouts(), getAmmoList(), getAttachmentList(), canMgmt ? getSpawnItems() : Promise.resolve([])]);
      setD({ loadouts: loadouts || [], ammo: ammo || [], att: att || [], spawns: spawns || [] }); setLoadErr("");
    } catch (e) { setD({ loadouts: [], ammo: [], att: [], spawns: [] }); setLoadErr(e?.message || "Could not load the Arsenal."); }
  };
  useEffect(() => { load(); }, [canMgmt]);
  useEffect(() => { if (canMgmt) setSub(initialSub); }, [initialSub, canMgmt]);

  if (d === null) return <div className="stack"><div className="skeleton row" /><div className="skeleton block" /></div>;

  return (
    <div className="stack">
      {canMgmt && (
        <div className="chips">
          <button className={`chip${sub === "loadouts" ? " on" : ""}`} onClick={() => setSub("loadouts")}>Loadouts <Badge>{d.loadouts.length}</Badge></button>
          <button className={`chip${sub === "spawn" ? " on" : ""}`} onClick={() => setSub("spawn")}>Spawn commands <Badge>{d.spawns.length}</Badge></button>
        </div>
      )}
      {loadErr && <div className="err">{loadErr}</div>}
      {sub === "loadouts" && <Loadouts d={d} canEdit={canEdit} run={run} busy={busy} reload={load} initialQ={initialQ} />}
      {sub === "spawn" && canMgmt && <SpawnCommands spawns={d.spawns} canWrite={canSpawnWrite} run={run} busy={busy} reload={load} copied={copied} copy={copy} initialQ={initialQ} />}
    </div>
  );
}

function Loadouts({ d, canEdit, run, busy, reload, initialQ }) {
  const [q, setQ] = useState(initialQ);
  const [cat, setCat] = useState(null);
  const [exp, setExp] = useState(null);
  const [wForm, setWForm] = useState(null);
  const [addAmmo, setAddAmmo] = useState({});
  const [addAtt, setAddAtt] = useState({});
  useEffect(() => { if (initialQ) setQ(initialQ); }, [initialQ]);

  const cats = useMemo(() => [...new Set(d.loadouts.map(w => w.weapon_category))].filter(Boolean).sort(), [d.loadouts]);
  const shown = useMemo(() => {
    const n = q.toLowerCase();
    return d.loadouts.filter(w => !cat || w.weapon_category === cat).filter(w => !n || [w.weapon_name, w.caliber].some(x => (x || "").toLowerCase().includes(n))
      || (w.ammo || []).some(a => a.ammo_name.toLowerCase().includes(n)) || (w.attachments || []).some(a => a.attachment_name.toLowerCase().includes(n)));
  }, [d.loadouts, q, cat]);

  const saveWeapon = () => run(() => wForm.id ? editWeapon(wForm.id, wForm) : addWeapon(wForm), { success: wForm.id ? "Weapon saved." : "Weapon added.", onDone: () => { setWForm(null); reload(); } });
  const removeWeapon = (w) => { if (!confirmIt(`Delete ${w.weapon_name}? Its ammo and attachment links go with it.`)) return; run(() => deleteWeapon(w.id), { success: "Weapon deleted.", onDone: reload }); };

  return (
    <>
      <div className="row">
        <input className="inp grow" placeholder="Search weapons, ammo, attachments…" value={q} onChange={e => setQ(e.target.value)} />
        {canEdit && <Button onClick={() => setWForm({ name: "", category: "", caliber: "" })}>+ Weapon</Button>}
      </div>
      <div className="chips">
        <button className={`chip${!cat ? " on" : ""}`} onClick={() => setCat(null)}>All</button>
        {cats.map(c => <button key={c} className={`chip${cat === c ? " on" : ""}`} onClick={() => setCat(cat === c ? null : c)}>{c}</button>)}
      </div>
      {shown.length === 0 ? <Empty title="No weapons match">{canEdit ? "Add one with “+ Weapon”." : "Try another search."}</Empty> : (
        <Card>
          <div className="list">
            {shown.map(w => {
              const open = exp === w.id;
              return (
                <div key={w.id}>
                  <div className="line click" onClick={() => setExp(open ? null : w.id)} role="button" aria-expanded={open}>
                    <Badge tone="accent">{w.weapon_category || "—"}</Badge>
                    <span className="t grow">{w.weapon_name}</span>
                    {w.caliber && <Badge tone="info">{w.caliber}</Badge>}
                    <Badge>{(w.ammo || []).length} ammo · {(w.attachments || []).length} att</Badge>
                    {canEdit && <span className="actions-inline" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => setWForm({ id: w.id, name: w.weapon_name, category: w.weapon_category || "", caliber: w.caliber || "" })}>Edit</Button>
                      <Button variant="danger ghost" size="sm" disabled={busy} onClick={() => removeWeapon(w)}>Del</Button>
                    </span>}
                    <span className="faint">{open ? "▴" : "▾"}</span>
                  </div>
                  {open && (
                    <div className="detail two-col">
                      <div className="stack gap-sm">
                        <div className="lbl">Attachments</div>
                        <div className="chips">
                          {(w.attachments || []).map(a => <span key={a.id} className="chip static tag">{a.attachment_name}{canEdit && <button className="xbtn" title="Remove" onClick={() => { if (confirmIt(`Remove ${a.attachment_name}?`)) run(() => removeAttachmentCompat(a.id), { onDone: reload }); }}>✕</button>}</span>)}
                          {!(w.attachments || []).length && <span className="tiny faint">None</span>}
                        </div>
                        {canEdit && <div className="row">
                          <select className="inp grow" value={addAtt[w.id] || ""} onChange={e => setAddAtt({ ...addAtt, [w.id]: e.target.value })}>
                            <option value="">{d.att.length ? "+ attachment…" : "No attachments in the catalogue"}</option>
                            {d.att.filter(a => !(w.attachments || []).some(x => x.attachment_name === a)).map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                          <Button size="sm" variant="ghost" disabled={!addAtt[w.id] || busy} onClick={() => run(() => addAttachmentCompat(w.id, addAtt[w.id]), { onDone: () => { setAddAtt({ ...addAtt, [w.id]: "" }); reload(); } })}>Add</Button>
                        </div>}
                      </div>
                      <div className="stack gap-sm">
                        <div className="lbl">Compatible ammo</div>
                        <div className="stack gap-xs">
                          {(w.ammo || []).map(a => <div key={a.id} className="row gap-sm"><Badge tone={AMMO_TONE[a.ammo_type]}>{a.ammo_type}</Badge><span className="small">{a.ammo_name}</span>{canEdit && <button className="xbtn" title="Remove" onClick={() => { if (confirmIt(`Remove ${a.ammo_name}?`)) run(() => removeAmmoCompat(a.id), { onDone: reload }); }}>✕</button>}</div>)}
                          {!(w.ammo || []).length && <span className="tiny faint">None</span>}
                        </div>
                        {canEdit && <div className="row">
                          <select className="inp grow" value={addAmmo[w.id] || ""} onChange={e => setAddAmmo({ ...addAmmo, [w.id]: e.target.value })}>
                            <option value="">{d.ammo.length ? "+ ammo…" : "No ammo in the catalogue"}</option>
                            {d.ammo.filter(a => !(w.ammo || []).some(x => x.ammo_name === a)).map(a => <option key={a} value={a}>{a}</option>)}
                          </select>
                          <Button size="sm" variant="ghost" disabled={!addAmmo[w.id] || busy} onClick={() => run(() => addAmmoCompat(w.id, addAmmo[w.id]), { onDone: () => { setAddAmmo({ ...addAmmo, [w.id]: "" }); reload(); } })}>Add</Button>
                        </div>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {wForm && (
        <Modal title={`${wForm.id ? "Edit" : "Add"} weapon`} onClose={() => setWForm(null)} onSave={saveWeapon} saveDisabled={busy || !wForm.name.trim()}>
          <Field label="Weapon name"><input value={wForm.name} onChange={e => setWForm({ ...wForm, name: e.target.value })} /></Field>
          <Field label="Category"><input list="wcats" value={wForm.category} onChange={e => setWForm({ ...wForm, category: e.target.value })} /></Field>
          <datalist id="wcats">{cats.map(c => <option key={c} value={c} />)}</datalist>
          <Field label="Caliber (optional)"><input value={wForm.caliber} onChange={e => setWForm({ ...wForm, caliber: e.target.value })} /></Field>
        </Modal>
      )}
    </>
  );
}

function SpawnCommands({ spawns, canWrite, run, busy, reload, copied, copy, initialQ }) {
  const [q, setQ] = useState(initialQ);
  const [qty, setQty] = useState(1);
  const [form, setForm] = useState(null);
  useEffect(() => { if (initialQ) setQ(initialQ); }, [initialQ]);
  const shown = useMemo(() => spawns.filter(i => !q || [i.name, i.category, i.game_id].some(x => (x || "").toLowerCase().includes(q.toLowerCase()))), [spawns, q]);
  const save = () => run(() => form.id ? editSpawnItem(form.id, { name: form.name, gameId: form.game_id, category: form.category, itemType: form.item_type }) : addSpawnItem({ name: form.name, gameId: form.game_id, category: form.category, itemType: form.item_type }), { success: form.id ? "Spawn item saved." : "Spawn item added.", onDone: () => { setForm(null); reload(); } });
  const remove = (item) => { if (!confirmIt(`Delete “${item.name}”?`)) return; run(() => deleteSpawnItem(item.id), { success: "Spawn item deleted.", onDone: reload }); };
  const n = Math.max(1, parseInt(qty) || 1);

  return (
    <>
      <div className="row">
        <input className="inp grow" placeholder="Search items, categories, game IDs…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="lbl">Qty</span>
        <input className="inp narrow" type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} />
        {canWrite && <Button onClick={() => setForm({ name: "", game_id: "", category: "", item_type: "item" })}>+ Item</Button>}
      </div>
      {shown.length === 0 ? <Empty title="No items match">{canWrite ? "Add one with “+ Item”." : "Try another search."}</Empty> : (
        <Card flush>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th className="hide-sm">Category</th><th>Name</th><th className="hide-sm">Game ID</th><th>Command</th><th></th></tr></thead>
              <tbody>
                {shown.map((item, idx) => {
                  const cmd = spawnCmd(item, n); const key = `sp-${item.id ?? idx}`;
                  return (
                    <tr key={key}>
                      <td className="hide-sm faint tiny mono">{item.category}</td>
                      <td><b>{item.name}</b></td>
                      <td className="hide-sm mono muted">{item.game_id}</td>
                      <td><code className="mono tiny">{cmd}</code></td>
                      <td className="num">
                        <span className="actions-inline right">
                          <CopyButton text={cmd} id={key} copied={copied} copy={copy} title="Copy command" />
                          {canWrite && <>
                            <Button variant="ghost" size="sm" onClick={() => setForm({ id: item.id, name: item.name, game_id: item.game_id || "", category: item.category || "", item_type: item.item_type || "item" })}>Edit</Button>
                            <Button variant="danger ghost" size="sm" disabled={busy} onClick={() => remove(item)}>✕</Button>
                          </>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {form && (
        <Modal title={`${form.id ? "Edit" : "Add"} spawn item`} onClose={() => setForm(null)} onSave={save} saveDisabled={busy || !form.name.trim()}>
          <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Game ID"><input className="mono" value={form.game_id} onChange={e => setForm({ ...form, game_id: e.target.value })} /></Field>
          <Field label="Category"><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></Field>
          <Field label="Item type" help="Decides the command: weapons and ammo use /GetWeapon, components /GetWeaponComponent, the rest /GetItem.">
            <select value={form.item_type} onChange={e => setForm({ ...form, item_type: e.target.value })}>{SPAWN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
          </Field>
        </Modal>
      )}
    </>
  );
}
