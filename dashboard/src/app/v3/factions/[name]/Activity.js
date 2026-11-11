"use client";
import { useState } from "react";
import QuillEditor from "../../../../lib/QuillEditor";
import { sanitizeHtml } from "../../../fm/leadership/_shared/sanitize.js";
import {
  addNote, editNote, addOOCNote, editOOCNote, editSceneLog, editFactionSceneRewards,
  requestDeletion, directDelete, aiSummarize, getStaffForTeam,
} from "../../../fm/factions/actions.js";
import { Card, Button, Empty, Modal, Field, useAction, useToast } from "../../ui.js";

const SUBS = [["scenes", "Scenes"], ["intel", "Intel"], ["ooc", "OOC meetings"]];

/* Inline editor used by all three feeds: a textarea (or Quill for OOC) with Save / Cancel. */
function InlineEdit({ value, onChange, onSave, onCancel, busy, rich }) {
  return (
    <div>
      {rich ? <QuillEditor value={value} onChange={onChange} placeholder="Meeting notes…" /> : <textarea className="inp" rows={4} value={value} onChange={e => onChange(e.target.value)} />}
      <div className="inline-actions"><Button size="sm" disabled={busy} onClick={onSave}>Save</Button><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

export default function Activity({ hub }) {
  const { detail, auth, level, isL3, canWrite, archived, reload } = hub;
  const { run, busy } = useAction();
  const toast = useToast();
  const [sub, setSub] = useState("scenes");
  const [edit, setEdit] = useState(null);            // { key, text }
  const [rewardsFor, setRewardsFor] = useState(null); // scene log being re-rewarded
  const [intelOpen, setIntelOpen] = useState(false);
  const [intelText, setIntelText] = useState("");
  const [ai, setAi] = useState({ busy: false, text: "" });
  const [ooc, setOoc] = useState(null);              // { staff, att, text }

  const mine = (authorId) => authorId === auth.id;
  const startEdit = (key, text) => setEdit({ key, text: text || "" });
  const saveEdit = (fn) => run(fn, { success: "Saved.", onDone: async () => { setEdit(null); await reload(); } });
  const reqDel = async (type, text, id) => {
    if (!window.confirm("Request deletion of this entry? Leadership approves it.")) return;
    await run(() => requestDeletion(type, text, id), { success: "Deletion request submitted." });
  };
  const hardDel = (type, id, what) => { if (window.confirm(`Delete this ${what}? This cannot be undone.`)) run(() => directDelete(type, id), { success: `${what[0].toUpperCase()}${what.slice(1)} deleted.`, onDone: reload }); };

  const summarize = async () => {
    setAi({ busy: true, text: "" });
    const r = await aiSummarize(detail.name).catch(e => ({ ok: false, error: e?.message }));
    setAi({ busy: false, text: r?.ok ? r.summary : "" });
    if (!r?.ok) toast(r?.error || "Summary failed.", "bad");
  };
  const openOOC = async () => {
    const staff = (await getStaffForTeam(detail.name).catch(() => [])) || [];
    const att = {}; staff.forEach(m => { att[m.discord_id] = false; });
    setOoc({ staff, att, text: "" });
  };
  const submitOOC = () => {
    const present = ooc.staff.filter(m => ooc.att[m.discord_id]), absent = ooc.staff.filter(m => !ooc.att[m.discord_id]);
    const html = `<h3>Attendance</h3><p><strong>Present:</strong> ${present.map(m => m.display_name).join(", ") || "None"}</p><p><strong>Absent:</strong> ${absent.map(m => m.display_name).join(", ") || "None"}</p><hr/>${ooc.text}`;
    run(() => addOOCNote(detail.id, detail.name, html, present.map(m => m.discord_id)), { success: "Meeting documented.", onDone: async () => { setOoc(null); setSub("ooc"); await reload(); } });
  };

  const right = (
    <span className="actions-inline">
      {sub === "intel" && canWrite && <Button size="sm" variant="ghost" onClick={() => { setIntelText(""); setIntelOpen(true); }}>+ Add note</Button>}
      {sub === "intel" && level >= 2 && canWrite && <Button size="sm" disabled={ai.busy} onClick={summarize}>{ai.busy ? "Generating…" : "✦ AI summary"}</Button>}
      {sub === "ooc" && canWrite && <Button size="sm" onClick={openOOC}>+ Document meeting</Button>}
    </span>
  );

  return (
    <Card title="Activity" right={right}>
      <div className="chips mb-s">
        {SUBS.map(([id, l]) => <button key={id} className={`chip${sub === id ? " on" : ""}`} onClick={() => { setSub(id); setEdit(null); }}>{l}{id === "scenes" && detail.sceneLogs.length > 0 && <span className="ct">{detail.sceneLogs.length}</span>}</button>)}
      </div>

      {sub === "scenes" && (detail.sceneLogs.length === 0 ? <Empty title="No scenes logged.">Use “Log scene” at the top to add one.</Empty> : detail.sceneLogs.map(l => (
        <div className="note" key={l.id}>
          <div className="nh">
            <span className="mono tiny faint">{l.date}</span><span className="who">{l.logged_by}</span><span className="sp" />
            {(mine(l.author_id) || isL3) && !archived && <Button size="sm" variant="quiet" onClick={() => startEdit(`s${l.id}`, l.notes)}>Edit</Button>}
            {mine(l.author_id) && !isL3 && !archived && <Button size="sm" variant="quiet" onClick={() => reqDel("scene_log", l.notes, l.id)}>Request deletion</Button>}
            {isL3 && !archived && <Button size="sm" variant="quiet" onClick={() => setRewardsFor({ id: l.id, value: l.rewards === "None" ? "" : (l.rewards || "") })}>Rewards</Button>}
            {isL3 && !archived && <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => hardDel("scene_log", l.id, "scene")}>Delete</Button>}
          </div>
          {edit?.key === `s${l.id}` ? <InlineEdit value={edit.text} onChange={t => setEdit({ ...edit, text: t })} busy={busy} onCancel={() => setEdit(null)} onSave={() => saveEdit(() => editSceneLog(l.id, edit.text))} />
            : <><div className="body">{l.notes}</div>{l.rewards && l.rewards !== "None" && <div className="reward">{l.rewards}</div>}</>}
        </div>
      )))}

      {sub === "intel" && <>
        {ai.text && <div className="ai-box mb-s mt-s">{ai.text}</div>}
        {detail.notes.length === 0 ? <Empty title="No intel notes.">{canWrite ? "Add what the team has learned about this faction." : null}</Empty> : detail.notes.map(n => (
          <div className="note" key={n.id}>
            <div className="nh">
              <span className="who c-accent">{n.author}</span><span className="mono tiny faint">{n.date}</span><span className="sp" />
              {(mine(n.author_id) || isL3) && !archived && <Button size="sm" variant="quiet" onClick={() => startEdit(`i${n.id}`, n.text)}>Edit</Button>}
              {mine(n.author_id) && !isL3 && !archived && <Button size="sm" variant="quiet" onClick={() => reqDel("intel_note", n.text, n.id)}>Request deletion</Button>}
              {isL3 && !archived && <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => hardDel("intel_note", n.id, "note")}>Delete</Button>}
            </div>
            {edit?.key === `i${n.id}` ? <InlineEdit value={edit.text} onChange={t => setEdit({ ...edit, text: t })} busy={busy} onCancel={() => setEdit(null)} onSave={() => saveEdit(() => editNote(n.id, edit.text))} />
              : <div className="body">{n.text}</div>}
          </div>
        ))}
      </>}

      {sub === "ooc" && (detail.oocNotes.length === 0 ? <Empty title="No OOC meetings documented.">{canWrite ? "Document a meeting to record attendance and notes." : null}</Empty> : detail.oocNotes.map(n => (
        <div className="note" key={n.id}>
          <div className="nh">
            <span className="mono tiny c-accent">{n.date}</span><span className="who">By {n.author}</span><span className="sp" />
            {(mine(n.author_id) || (level >= 2 && canWrite)) && !archived && <Button size="sm" variant="quiet" onClick={() => startEdit(`o${n.id}`, n.text)}>Edit</Button>}
            {isL3 && !archived && <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => hardDel("ooc_note", n.id, "OOC note")}>Delete</Button>}
          </div>
          {edit?.key === `o${n.id}` ? <InlineEdit rich value={edit.text} onChange={t => setEdit({ ...edit, text: t })} busy={busy} onCancel={() => setEdit(null)} onSave={() => saveEdit(() => editOOCNote(n.id, edit.text))} />
            : <div className="prose quill" dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.text) }} />}
        </div>
      )))}

      {intelOpen && <Modal title="Add intelligence note" onClose={() => setIntelOpen(false)} saveLabel="Add note" saveDisabled={busy || !intelText.trim()}
        onSave={() => run(() => addNote(detail.id, detail.name, intelText.trim()), { success: "Note added.", onDone: async () => { setIntelOpen(false); await reload(); } })}>
        <Field label="What was learned"><textarea autoFocus rows={5} value={intelText} onChange={e => setIntelText(e.target.value)} /></Field>
      </Modal>}
      {rewardsFor && <Modal title="Edit scene rewards" onClose={() => setRewardsFor(null)} saveDisabled={busy}
        onSave={() => run(() => editFactionSceneRewards(rewardsFor.id, rewardsFor.value), { success: "Rewards updated.", onDone: async () => { setRewardsFor(null); await reload(); } })}>
        <Field label="Rewards" help="e.g. $5,000 + 2x Item. Empty clears it."><textarea autoFocus rows={3} value={rewardsFor.value} onChange={e => setRewardsFor({ ...rewardsFor, value: e.target.value })} /></Field>
      </Modal>}
      {ooc && <Modal maxWidth={860} title={`OOC meeting · ${detail.name}`} onClose={() => setOoc(null)} onSave={submitOOC} saveLabel="Save meeting" saveDisabled={busy || !ooc.text.trim()}>
        <div className="ooc-grid">
          <div>
            <div className="lbl mb-s">Attendance</div>
            <div className="attend">
              {ooc.staff.length === 0 ? <span className="hint">No team members on the lead's team.</span> : ooc.staff.map(m => (
                <label key={m.discord_id} className={ooc.att[m.discord_id] ? "on" : ""}><span>{m.display_name}</span><input type="checkbox" checked={!!ooc.att[m.discord_id]} onChange={() => setOoc({ ...ooc, att: { ...ooc.att, [m.discord_id]: !ooc.att[m.discord_id] } })} /></label>
              ))}
            </div>
          </div>
          <div><div className="lbl mb-s">Meeting notes</div><QuillEditor value={ooc.text} onChange={t => setOoc(o => ({ ...o, text: t }))} placeholder="Meeting notes…" /></div>
        </div>
      </Modal>}
    </Card>
  );
}
