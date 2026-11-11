"use client";
// Storytelling › Scene Logs — record outcomes and distribute rewards (the
// activity record leadership reviews). Event Team has full rights here
// (policy 4); Lead Storytellers read. Draft autosave survives a reload.
import { useEffect, useMemo, useState } from "react";
import { getSceneLogs, getFactionNames, getInventoryForScene, getStaffForScene, submitScene, addMyselfToScene, removeAssistantFromScene, editSceneNotes, deleteScene, requestSceneDeletion, getAttentionFactions, getTreasuryStats } from "../../fm/scenes/actions.js";
import { getFactions } from "../../fm/factions/actions.js";
import { useDraft, loadDraft, clearDraft } from "../../../lib/useDraft";
import { Card, Badge, Button, Field, Empty, Modal, useAction, fmtDate } from "../ui.js";
import { confirmIt } from "../library/shared.js";
import SceneForm, { BLANK_SCENE, sceneIsBlank } from "./SceneForm.js";

const DRAFT_KEY = "scenes:new";

export default function SceneLogs({ auth, openNew = false, prefillFaction = "" }) {
  const level = auth.level || 0;
  const isET = !!auth.isEventTeam;
  const canLog = level >= 1 || isET;                 // submitScene / addMyself / edit own: requireActor(1, ET)
  const canEditAny = level >= 2;                     // editSceneNotes / requestSceneDeletion on others' logs: author or L2+ (ET edits only its own)
  const canManage = level >= 2 || isET;              // removeAssistantFromScene: requireActor(2, ET)
  const canHardDelete = level >= 3 || isET;          // deleteScene: requireActor(3, ET)
  const canTreasury = level >= 3;                    // treasury stats shown to leadership
  const [logs, setLogs] = useState(null);
  const [lists, setLists] = useState(null);          // { factions, inventory, staff }
  const [attention, setAttention] = useState([]);
  const [loadErr, setLoadErr] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK_SCENE);
  const [hasDraft, setHasDraft] = useState(false);
  const [edit, setEdit] = useState(null);            // { id, text }
  const [treasury, setTreasury] = useState(null);    // null | stats object (modal open)
  const { run, busy } = useAction();

  // Restore a draft saved before a reload/crash; keep saving while the form is open.
  useEffect(() => {
    const d = loadDraft(DRAFT_KEY);
    if (d && !sceneIsBlank(d)) { setForm(d); setHasDraft(true); }
  }, []);
  useDraft(DRAFT_KEY, form, { enabled: showForm, blank: sceneIsBlank });

  // "+ New → Scene log" (?new=1[&faction=<id|name>]): open the form, faction preselected.
  useEffect(() => {
    if (!openNew) return;
    setShowForm(true); setHasDraft(false);
    if (!prefillFaction) return;
    const apply = (name) => setForm(f => (f.faction ? f : { ...f, faction: name }));
    if (/^\d+$/.test(prefillFaction)) getFactions().then(fs => { const m = (fs || []).find(f => String(f.id) === prefillFaction); if (m) apply(m.name); }).catch(() => {});
    else apply(prefillFaction);
  }, [openNew]);

  const load = async () => {
    try {
      const [l, f, i, s, a] = await Promise.all([getSceneLogs(), getFactionNames(), getInventoryForScene(), getStaffForScene(), getAttentionFactions()]);
      setLogs(l || []); setLists({ factions: f || [], inventory: i || [], staff: s || [] }); setAttention(a || []); setLoadErr("");
    } catch (e) { setLogs([]); setLists({ factions: [], inventory: [], staff: [] }); setLoadErr(e?.message || "Could not load scene logs."); }
  };
  useEffect(() => { load(); }, []);
  const refresh = async () => { try { const [l, a] = await Promise.all([getSceneLogs(), getAttentionFactions()]); setLogs(l || []); setAttention(a || []); } catch {} };

  const filtered = useMemo(() => (logs || []).filter(l => {
    const q = search.toLowerCase();
    const matches = !q || l.faction?.toLowerCase().includes(q) || l.logged_by?.toLowerCase().includes(q) || (l.assistants || []).some(a => (a.staff_name || "").toLowerCase().includes(q));
    const t = l.dateMs || new Date(l.date).getTime();
    return matches && (!dateFrom || t >= new Date(dateFrom).getTime()) && (!dateTo || t <= new Date(dateTo + "T23:59:59").getTime());
  }), [logs, search, dateFrom, dateTo]);
  const hasFilters = search || dateFrom || dateTo;

  const submit = () => run(() => submitScene(form), { success: "Scene logged.", onDone: () => { setShowForm(false); setForm(BLANK_SCENE); clearDraft(DRAFT_KEY); setHasDraft(false); refresh(); } });
  const saveEdit = () => run(() => editSceneNotes(edit.id, edit.text), { success: "Notes updated.", onDone: () => { setEdit(null); refresh(); } });
  const addMyself = (log) => run(() => addMyselfToScene(log.id), { success: "You are now listed on this scene.", onDone: refresh });
  const removeAssistant = (a) => { if (!confirmIt(`Remove ${a.staff_name} from this scene?`)) return; run(() => removeAssistantFromScene(a.id), { success: "Removed.", onDone: refresh }); };
  const requestDelete = (log) => { if (!confirmIt("Ask leadership to delete this scene log?")) return; run(() => requestSceneDeletion(log.id, log.notes), { success: "Deletion requested — leadership has been notified." }); };
  const hardDelete = (log) => { if (!confirmIt("Permanently remove this scene log? This cannot be undone.")) return; run(() => deleteScene(log.id), { success: "Scene log deleted.", onDone: refresh }); };
  const openTreasury = () => run(() => getTreasuryStats().then(t => ({ ok: true, stats: t || {} })), { onDone: (r) => setTreasury(r.stats) });

  if (logs === null) return <div className="stack"><div className="skeleton row" /><div className="skeleton block" /></div>;

  return (
    <div className="stack">
      <div className="row">
        <span className="small muted grow">Record scene outcomes and distribute rewards.</span>
        {canTreasury && <Button variant="ghost" onClick={openTreasury} disabled={busy}>Treasury</Button>}
        {canLog && <Button onClick={() => { setShowForm(true); setHasDraft(false); }}>Log scene +</Button>}
      </div>
      {loadErr && <div className="err">{loadErr}</div>}
      {hasDraft && !showForm && (
        <div className="draftbar">
          <span>You have an unsaved scene draft from a previous session.</span>
          <span className="actions-inline">
            <Button size="sm" onClick={() => { setShowForm(true); setHasDraft(false); }}>Resume</Button>
            <Button size="sm" variant="ghost" onClick={() => { clearDraft(DRAFT_KEY); setForm(BLANK_SCENE); setHasDraft(false); }}>Discard</Button>
          </span>
        </div>
      )}
      {attention.length > 0 && (
        <Card title={<span style={{ color: "var(--rose)" }}>Attention required</span>} right={<Badge tone="bad">{attention.length} faction{attention.length !== 1 ? "s" : ""}</Badge>}>
          <div className="attn-grid">
            {attention.map(([fac, count]) => <div key={fac} className="attn"><div className="t">{fac}</div><div className="d">{count} scene{count !== 1 ? "s" : ""} in 30d</div></div>)}
          </div>
        </Card>
      )}
      <div className="row">
        <input className="inp grow" placeholder="Search by faction or staff…" value={search} onChange={e => setSearch(e.target.value)} />
        <input type="date" className="inp auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From" />
        <input type="date" className="inp auto" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To" />
        {hasFilters && <Button variant="quiet" size="sm" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}>Clear</Button>}
        <span className="tiny faint mono">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 && <Empty title="No scene logs match">{hasFilters ? "Clear the filters to see everything." : canLog ? "Log the first one with “Log scene +”." : ""}</Empty>}
      {filtered.map(log => {
        const isAuthor = log.author_id === auth.id;
        const onIt = (log.assistants || []).some(a => a.staff_id === auth.id);
        return (
          <Card key={log.id} title={log.faction} right={<span className="tiny faint mono">{log.dateLabel || fmtDate(log.date)}</span>}>
            {edit?.id === log.id ? (
              <div className="stack" style={{ gap: 8 }}>
                <Field label="Notes"><textarea rows={5} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} /></Field>
                <div className="actions-inline"><Button size="sm" disabled={busy || !edit.text.trim()} onClick={saveEdit}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
              </div>
            ) : <p className="pre" style={{ margin: "0 0 10px" }}>{log.notes}</p>}
            <div className="pane row" style={{ gap: 18 }}>
              <div><div className="lbl">Staff</div><div className="small" style={{ fontWeight: 600 }}>{log.logged_by}</div></div>
              {log.assistants?.length > 0 && (
                <div><div className="lbl">Also present</div>
                  <div className="chips">{log.assistants.map(a => <span key={a.id} className="chip static tag">{a.staff_name}{canManage && <button className="xbtn" title="Remove" onClick={() => removeAssistant(a)}>✕</button>}</span>)}</div>
                </div>
              )}
              <div><div className="lbl">Rewards</div><div className="small mono" style={{ color: "var(--good)" }}>{log.rewards}</div></div>
            </div>
            <div className="row spread" style={{ marginTop: 10 }}>
              <span className="actions-inline">
                {canLog && (isAuthor || canEditAny) && edit?.id !== log.id && <Button size="sm" variant="ghost" onClick={() => setEdit({ id: log.id, text: log.notes || "" })}>Edit</Button>}
                {canLog && (isAuthor || canEditAny) && <Button size="sm" variant="ghost" onClick={() => requestDelete(log)}>Request deletion</Button>}
                {canLog && !isAuthor && !onIt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => addMyself(log)}>+ Add myself</Button>}
              </span>
              {canHardDelete && <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => hardDelete(log)}>Delete</Button>}
            </div>
          </Card>
        );
      })}

      {showForm && <SceneForm auth={auth} form={form} setForm={setForm} lists={lists} busy={busy} onSubmit={submit} onClose={() => setShowForm(false)} footer={`● ${auth.displayName || auth.name} · draft auto-saved`} />}

      {treasury && (
        <Modal title="Treasury & distribution" maxWidth={720} onClose={() => setTreasury(null)}>
          <div className="tiny faint">Cash and items handed out, per distributor, across every scene log.</div>
          {Object.entries(treasury).sort((a, b) => b[1].cash - a[1].cash).map(([name, data]) => (
            <div key={name} className="pane row" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 150 }}><div className="small" style={{ fontWeight: 700 }}>{name}</div><div className="mono" style={{ fontSize: 17, color: "var(--good)" }}>${(data.cash || 0).toLocaleString()}</div></div>
              <div className="chips grow">
                {Object.entries(data.items || {}).sort((a, b) => b[1] - a[1]).map(([item, qty]) => <span key={item} className="chip static tag"><b style={{ color: "var(--accent)" }}>{qty}x</b>&nbsp;{item}</span>)}
                {Object.keys(data.items || {}).length === 0 && <span className="tiny faint">No items distributed</span>}
              </div>
            </div>
          ))}
          {Object.keys(treasury).length === 0 && <Empty>No distribution data yet.</Empty>}
        </Modal>
      )}
    </div>
  );
}
