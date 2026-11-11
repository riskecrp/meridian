"use client";
// Storytelling › Scene Library — the idea → review → approved → "log to
// faction" bridge. Read: everyone here. Submit: L1+ and Event Team. Approve
// (or move back to idea): L2+, Event Team and Lead Storytellers — the one write
// a Lead Storyteller has. Edit / delete / feedback: L2+ and Event Team.
import { useEffect, useMemo, useState } from "react";
import { getSceneLibrary, addSceneLibraryEntry, editSceneLibraryEntry, setSceneLibraryStatus, deleteSceneLibraryEntry, getSceneLibraryFeedback, addSceneLibraryFeedback } from "../../fm/storytelling/actions.js";
import { getFactionNames, getInventoryForScene, getStaffForScene, submitScene } from "../../fm/scenes/actions.js";
import { Badge, Button, Field, Empty, Modal, useAction, useToast, fmtDate, fmtDateTime } from "../ui.js";
import { confirmIt } from "../library/shared.js";
import SceneForm, { BLANK_SCENE } from "./SceneForm.js";

const SORTS = [["newest", "Newest"], ["oldest", "Oldest"], ["staff_asc", "Staff: low → high"], ["staff_desc", "Staff: high → low"], ["az", "A → Z"]];
const EMPTY_IDEA = { title: "", description: "", staff_required: 1, spawning_required: false, spawning_details: "", ped_required: false, proposed_rewards: "", tags: "" };

export default function SceneLibrary({ auth, initialQ = "" }) {
  const level = auth.level || 0;
  const isET = !!auth.isEventTeam, isLST = !!auth.isLeadStoryteller;
  const canSuggest = level >= 1 || isET;             // addSceneLibraryEntry / submitScene: requireActor(1, ET)
  const canApprove = level >= 2 || isET || isLST;    // setSceneLibraryStatus: requireActor(2, READ)
  const canEdit = level >= 2 || isET;                // edit / delete / feedback: requireActor(2, ET)
  const [rows, setRows] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [q, setQ] = useState(initialQ);
  const [statusF, setStatusF] = useState("all");
  const [spawnF, setSpawnF] = useState("all");
  const [pedF, setPedF] = useState("all");
  const [staffMax, setStaffMax] = useState(0);
  const [sort, setSort] = useState("newest");
  const [expanded, setExpanded] = useState({});
  const [idea, setIdea] = useState(null);           // { id?, status?, ...EMPTY_IDEA }
  const [feedback, setFeedback] = useState(null);   // { scene, list, loading, text }
  const [logFor, setLogFor] = useState(null);       // scene being logged to a faction
  const [logForm, setLogForm] = useState(BLANK_SCENE);
  const [logLists, setLogLists] = useState(null);
  const { run, busy } = useAction();
  const toast = useToast();

  const load = async () => { try { setRows(await getSceneLibrary() || []); setLoadErr(""); } catch (e) { setRows([]); setLoadErr(e?.message || "Could not load the Scene Library."); } };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (initialQ) setQ(initialQ); }, [initialQ]);

  const shown = useMemo(() => {
    let out = [...(rows || [])];
    if (statusF !== "all") out = out.filter(s => s.status === statusF);
    if (spawnF !== "all") out = out.filter(s => !!s.spawning_required === (spawnF === "yes"));
    if (pedF !== "all") out = out.filter(s => !!s.ped_required === (pedF === "yes"));
    if (staffMax > 0) out = out.filter(s => (s.staff_required || 1) <= staffMax);
    const n = q.trim().toLowerCase();
    if (n) out = out.filter(s => [s.title, s.description, s.tags, s.spawning_details, s.created_by].some(x => (x || "").toLowerCase().includes(n)));
    const t = (s) => new Date(String(s.created_at).replace(" ", "T")).getTime() || 0;
    switch (sort) {
      case "oldest": out.sort((a, b) => t(a) - t(b)); break;
      case "staff_asc": out.sort((a, b) => (a.staff_required || 0) - (b.staff_required || 0)); break;
      case "staff_desc": out.sort((a, b) => (b.staff_required || 0) - (a.staff_required || 0)); break;
      case "az": out.sort((a, b) => (a.title || "").localeCompare(b.title || "")); break;
      default: out.sort((a, b) => t(b) - t(a));
    }
    return out;
  }, [rows, statusF, spawnF, pedF, staffMax, q, sort]);
  const counts = useMemo(() => ({ idea: (rows || []).filter(s => s.status === "idea").length, approved: (rows || []).filter(s => s.status === "approved").length }), [rows]);

  const openEdit = (s) => setIdea({ id: s.id, status: s.status, title: s.title || "", description: s.description || "", staff_required: s.staff_required || 1, spawning_required: !!s.spawning_required, spawning_details: s.spawning_details || "", ped_required: !!s.ped_required, proposed_rewards: s.proposed_rewards || "", tags: s.tags || "" });
  const saveIdea = () => run(() => idea.id ? editSceneLibraryEntry(idea.id, idea) : addSceneLibraryEntry(idea), { success: idea.id ? "Scene updated." : "Idea submitted — reviewers have been pinged.", onDone: () => { setIdea(null); load(); } });
  const toggleStatus = (s) => run(() => setSceneLibraryStatus(s.id, s.status === "approved" ? "idea" : "approved"), { success: s.status === "approved" ? "Moved back to idea." : "Approved — the author has been told.", onDone: load });
  const remove = (s) => { if (!confirmIt(`Permanently delete “${s.title}” and its feedback?`)) return; run(() => deleteSceneLibraryEntry(s.id), { success: "Scene deleted.", onDone: load }); };
  const openFeedback = async (s) => {
    setFeedback({ scene: s, list: [], loading: true, text: "" });
    try { const list = await getSceneLibraryFeedback(s.id); setFeedback(f => f ? { ...f, list: list || [], loading: false } : f); }
    catch (e) { setFeedback(f => f ? { ...f, loading: false } : f); toast(e?.message || "Could not load feedback.", "bad"); }
  };
  const sendFeedback = () => run(() => addSceneLibraryFeedback(feedback.scene.id, feedback.text), { success: "Feedback sent.", onDone: async () => { const list = await getSceneLibraryFeedback(feedback.scene.id).catch(() => []); setFeedback(f => f ? { ...f, list: list || [], text: "" } : f); } });
  const openLog = async (s) => {
    setLogFor(s); setLogForm({ ...BLANK_SCENE, notes: `[Library: ${s.title}]\n\n` });
    if (!logLists) {
      try { const [factions, inventory, staff] = await Promise.all([getFactionNames(), getInventoryForScene(), getStaffForScene()]); setLogLists({ factions: factions || [], inventory: inventory || [], staff: staff || [] }); }
      catch (e) { setLogLists({ factions: [], inventory: [], staff: [] }); toast(e?.message || "Could not load factions.", "bad"); }
    }
  };
  const submitLog = () => run(() => submitScene(logForm), { success: "Scene logged — it is in Scene Logs now.", onDone: () => { setLogFor(null); setLogForm(BLANK_SCENE); } });
  const chip = (k, on, label, onClick, tone) => <button key={k} className={`chip tag${on ? ` on${tone ? ` ${tone}` : ""}` : ""}`} onClick={onClick}>{label}</button>;

  if (rows === null) return <div className="stack"><div className="skeleton row" /><div className="skeleton block" /></div>;

  return (
    <div className="stack">
      <div className="row">
        <input className="inp grow" placeholder="Search scenes…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="inp auto" value={sort} onChange={e => setSort(e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <span className="tiny faint mono">{shown.length} scene{shown.length !== 1 ? "s" : ""}</span>
        {canSuggest && <Button onClick={() => setIdea({ ...EMPTY_IDEA })}>+ Add scene</Button>}
      </div>
      <div className="chips">
        {[["all", "All"], ["idea", `Ideas · ${counts.idea}`], ["approved", `Approved · ${counts.approved}`]].map(([v, l]) => chip(`st-${v}`, statusF === v, l, () => setStatusF(v)))}
        <span className="lbl">Spawning</span>
        {[["all", "Any"], ["yes", "Yes"], ["no", "No"]].map(([v, l]) => chip(`sp-${v}`, spawnF === v, l, () => setSpawnF(v), "warn"))}
        <span className="lbl">Peds</span>
        {[["all", "Any"], ["yes", "Yes"], ["no", "No"]].map(([v, l]) => chip(`pd-${v}`, pedF === v, l, () => setPedF(v)))}
        <span className="lbl">Max staff</span>
        {[[0, "Any"], [1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5+"]].map(([v, l]) => chip(`mx-${v}`, staffMax === v, l, () => setStaffMax(v)))}
      </div>
      {loadErr && <div className="err">{loadErr}</div>}

      {shown.length === 0 ? <Empty title="No scenes match your filters">{canSuggest ? "Submit an idea with “+ Add scene”." : ""}</Empty> : (
        <div className="scene-grid">
          {shown.map(s => {
            const approved = s.status === "approved";
            const tags = (s.tags || "").split(",").map(t => t.trim()).filter(Boolean);
            const long = s.description && (s.description.length > 220 || s.description.includes("\n"));
            const isOpen = !!expanded[s.id];
            return (
              <div key={s.id} className={`card scene-card${approved ? " approved" : ""}`}>
                <div className="row spread">
                  <Badge tone={approved ? "good" : "warn"}>{approved ? "Approved" : "Idea"}</Badge>
                  <span className="tiny faint mono">{s.created_by}{s.created_at ? ` · ${fmtDate(s.created_at)}` : ""}</span>
                </div>
                <div className="scene-title">{s.title}</div>
                {s.description && (
                  <div>
                    <div className={`pre small${long && !isOpen ? " clamp3" : ""}`}>{s.description}</div>
                    {long && <button className="linkbtn" onClick={() => setExpanded(e => ({ ...e, [s.id]: !isOpen }))}>{isOpen ? "Show less" : "Show more"}</button>}
                  </div>
                )}
                <div className="chips">
                  <Badge tone="accent">Staff {s.staff_required || 1}</Badge>
                  <Badge tone={s.spawning_required ? "warn" : undefined}>Spawning {s.spawning_required ? "yes" : "no"}</Badge>
                  <Badge tone={s.ped_required ? "info" : undefined}>Peds {s.ped_required ? "yes" : "no"}</Badge>
                </div>
                {!!s.spawning_required && s.spawning_details && <div className="small muted"><b className="c-amber">Spawn</b> {s.spawning_details}</div>}
                {s.proposed_rewards && <div className="small mono c-good"><span className="faint">Rewards</span> {s.proposed_rewards}</div>}
                {tags.length > 0 && <div className="chips">{tags.map(t => <Badge key={t} tone="lock">{t}</Badge>)}</div>}
                <div className="sf">
                  {canSuggest ? <Button size="sm" onClick={() => openLog(s)}>+ Add to faction</Button> : <span className="tiny faint">Read only</span>}
                  <span className="spacer" />
                  <Button size="sm" variant="ghost" onClick={() => openFeedback(s)}>Feedback</Button>
                  {canApprove && <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggleStatus(s)}>{approved ? "↩ Idea" : "✓ Approve"}</Button>}
                  {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>Edit</Button>}
                  {canEdit && <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => remove(s)}>Del</Button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {idea && (
        <Modal title={idea.id ? "Edit scene" : "New scene idea"} maxWidth={620} onClose={() => setIdea(null)} onSave={saveIdea} saveLabel={idea.id ? "Save changes" : "Submit idea"} saveDisabled={busy || !idea.title.trim()}>
          <Field label="Title"><input placeholder="Scene title…" value={idea.title} onChange={e => setIdea({ ...idea, title: e.target.value })} /></Field>
          {idea.id && canEdit && <Field label="Status"><select value={idea.status} onChange={e => setIdea({ ...idea, status: e.target.value })}><option value="idea">Idea</option><option value="approved">Approved</option></select></Field>}
          <Field label="Description"><textarea rows={4} placeholder="Describe the scene concept…" value={idea.description} onChange={e => setIdea({ ...idea, description: e.target.value })} /></Field>
          <div className="row">
            <label className="check">Staff required <input className="inp narrow" type="number" min={1} max={50} value={idea.staff_required} onChange={e => setIdea({ ...idea, staff_required: parseInt(e.target.value) || 1 })} /></label>
            <label className="check"><input type="checkbox" checked={idea.spawning_required} onChange={e => setIdea({ ...idea, spawning_required: e.target.checked })} /> Spawning required</label>
            <label className="check"><input type="checkbox" checked={idea.ped_required} onChange={e => setIdea({ ...idea, ped_required: e.target.checked })} /> Ped required</label>
          </div>
          {idea.spawning_required && <Field label="What needs spawning?"><input placeholder="e.g. 2x Insurgent, prop crates, gang NPCs…" value={idea.spawning_details} onChange={e => setIdea({ ...idea, spawning_details: e.target.value })} /></Field>}
          <Field label="Proposed rewards"><input placeholder="e.g. $500, 2x item…" value={idea.proposed_rewards} onChange={e => setIdea({ ...idea, proposed_rewards: e.target.value })} /></Field>
          <Field label="Tags" help="Comma-separated, e.g. outdoor, night, gang"><input value={idea.tags} onChange={e => setIdea({ ...idea, tags: e.target.value })} /></Field>
        </Modal>
      )}

      {feedback && (
        <Modal title={`Feedback — ${feedback.scene.title}`} maxWidth={620} onClose={() => setFeedback(null)} onSave={canEdit && feedback.scene.status !== "approved" ? sendFeedback : undefined} saveLabel="Send feedback" saveDisabled={busy || !feedback.text.trim()}>
          {feedback.loading ? <div className="skeleton row" /> : feedback.list.length === 0 ? <Empty>No feedback yet.</Empty> : feedback.list.map(f => (
            <div key={f.id} className="pane">
              <div className="row spread"><span className="small bold c-accent">{f.created_by}</span><span className="tiny faint mono">{fmtDateTime(f.created_at)}</span></div>
              <div className="pre small">{f.feedback}</div>
            </div>
          ))}
          {canEdit && feedback.scene.status !== "approved"
            ? <Field label="Your feedback" help="The author gets a ping."><textarea rows={3} value={feedback.text} onChange={e => setFeedback({ ...feedback, text: e.target.value })} /></Field>
            : <div className="tiny faint">{feedback.scene.status === "approved" ? "Approved scenes are no longer under review." : "Reviewers (L2+ and the Event Team) can leave feedback here."}</div>}
        </Modal>
      )}

      {logFor && <SceneForm auth={auth} title={`Log scene to faction — ${logFor.title}`} form={logForm} setForm={setLogForm} lists={logLists} busy={busy} onSubmit={submitLog} onClose={() => setLogFor(null)} proposed={logFor.proposed_rewards} />}
    </div>
  );
}
