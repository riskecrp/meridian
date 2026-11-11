"use client";
import { useEffect, useState } from "react";
import QuillEditor from "../../../lib/QuillEditor";
import { getMeetingNotes, getMeetingNote, saveMeetingNote, deleteMeetingNote, getNoteTargets, getAttendeesForTarget } from "../../fm/leadership/actions.js";
import { sanitizeHtml } from "../../fm/leadership/_shared/sanitize.js";
import { Card, Badge, Button, Field, Empty, useAction, useQueryParam, setQueryParam, fmtDate } from "../ui.js";

/*
 * Meeting notes: the v2 Leadership › Meeting Notes list and the v2 /notes
 * full-width editor, on one tab. ?note=new opens the editor, ?note=<id> edits
 * (the v2 ?id= and ?new=1 deep links are accepted too). Targets come scoped
 * from the server (own team + its factions for L1/L2, everything plus staff
 * groups for L3); the author or an L3 may edit/delete.
 */
const notePreview = (h) => (h || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const stripHtml = (h) => (h || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

export default function MeetingNotes({ auth }) {
  const noteParam = useQueryParam("note", "");
  const legacyId = useQueryParam("id", "");
  const legacyNew = useQueryParam("new", "");
  const mode = noteParam || (legacyId ? legacyId : legacyNew === "1" ? "new" : "");
  const canWrite = (auth?.level || 0) >= 1;
  const isL3 = (auth?.level || 0) >= 3;

  const [notes, setNotes] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [q, setQ] = useState("");
  const { run, busy } = useAction();
  const load = () => getMeetingNotes().then(n => setNotes(n || [])).catch(() => setNotes([]));
  useEffect(() => { load(); }, []);

  // Leaving the editor drops every editor key from the URL in one history step.
  const closeEditor = () => { const u = new URL(window.location.href); ["note", "id", "new"].forEach(k => u.searchParams.delete(k)); window.history.pushState({}, "", u.toString()); window.dispatchEvent(new PopStateEvent("popstate")); load(); };
  if (mode) return <NoteEditor auth={auth} id={mode === "new" ? null : parseInt(mode) || null} onDone={closeEditor} />;
  if (!notes) return <div className="stack"><div className="skeleton" style={{ height: 36 }} /><div className="skeleton" style={{ height: 200 }} /></div>;

  const shown = notes.filter(n => !q || [n.display_name, n.author, notePreview(n.content)].some(x => (x || "").toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <input className="inp rv-inp" placeholder="Filter notes…" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter notes" />
        <div className="row">
          <span className="tiny faint mono">{shown.length} note{shown.length === 1 ? "" : "s"}</span>
          {canWrite ? <Button onClick={() => setQueryParam("note", "new")}>+ Meeting note</Button> : <span className="tiny faint">read-only</span>}
        </div>
      </div>
      {notes.length === 0 ? <Empty title="No meeting notes">Document a meeting with a faction, your team or a staff group.</Empty>
        : shown.length === 0 ? <Empty>Nothing matches this filter.</Empty> : (
        <Card flush>
          <div className="list">
            {shown.map(n => {
              const open = openId === n.id;
              const mine = n.author_id === auth.id || isL3;
              const html = /<[a-z][^>]*>/i.test(n.content || "");
              return (
                <div key={n.id} className="note-row">
                  <div className="note-head" onClick={() => setOpenId(open ? null : n.id)} role="button" aria-expanded={open}>
                    <span className={`rv-caret${open ? " open" : ""}`}>▸</span>
                    <Badge tone={n.target_type === "faction" ? "accent" : n.target_type === "team" ? "info" : "lock"}>{n.display_name}</Badge>
                    <span className="small" style={{ fontWeight: 600, color: "var(--ink-0)" }}>{n.author}</span>
                    <span className="mono tiny faint">{fmtDate(n.date || n.created_at)}</span>
                    {n.attendeeIds?.length > 0 && <span className="tiny faint hide-sm">{n.attendeeIds.length} attendee{n.attendeeIds.length === 1 ? "" : "s"}</span>}
                    {!open && <span className="note-prev small muted">{notePreview(n.content).slice(0, 160)}</span>}
                    {open && <span style={{ flex: 1 }} />}
                    {mine && canWrite && (
                      <span className="actions-inline" onClick={e => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" onClick={() => setQueryParam("note", String(n.id))}>Edit</Button>
                        <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm("Delete this meeting note?")) run(() => deleteMeetingNote(n.id), { success: "Note deleted.", onDone: load }); }}>Delete</Button>
                      </span>
                    )}
                  </div>
                  {open && (
                    <div className="note-body">
                      {/* Old notes are plain text; anything written with Quill is HTML — render each accordingly. */}
                      {html ? <div className="quill-content prose" dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.content) }} /> : <div className="prose" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.content}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}

function NoteEditor({ auth, id, onDone }) {
  const [targets, setTargets] = useState(null); // { factions, teams, groups }
  const [form, setForm] = useState({ targetType: "", targetKey: "", content: "", attendeeIds: new Set() });
  const [attendees, setAttendees] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const { run, busy } = useAction();
  const canWrite = (auth?.level || 0) >= 1;

  useEffect(() => {
    getNoteTargets().then(t => setTargets(t || { factions: [], teams: [], groups: [] })).catch(() => setTargets({ factions: [], teams: [], groups: [] }));
    if (id) {
      // One scoped lookup by id, so notes older than the list's window still open.
      getMeetingNote(id).then(n => {
        if (!n) { setNotFound(true); return; }
        setForm({ id: n.id, targetType: n.target_type, targetKey: n.target_type === "faction" ? String(n.faction_id) : n.target_key, content: n.content, attendeeIds: new Set(n.attendeeIds || []) });
      }).catch(() => setNotFound(true));
    }
  }, [id]);
  useEffect(() => {
    if (!form.targetType || !form.targetKey) { setAttendees([]); return; }
    getAttendeesForTarget(form.targetType, form.targetKey).then(a => setAttendees(a || [])).catch(() => setAttendees([]));
  }, [form.targetType, form.targetKey]);

  if (targets === null) return <div className="stack"><div className="skeleton" style={{ height: 40 }} /><div className="skeleton" style={{ height: 300 }} /></div>;
  if (notFound) return <><Empty title="Note not found">It may have been deleted, or it is outside your scope.</Empty><div style={{ marginTop: 12 }}><Button variant="ghost" onClick={onDone}>← Back to notes</Button></div></>;
  if (!canWrite) return <><div className="restricted">Your account can read meeting notes but not write them.</div><div style={{ marginTop: 12 }}><Button variant="ghost" onClick={onDone}>← Back to notes</Button></div></>;

  const options = [
    ...(targets.factions || []).map(f => ({ v: `faction:${f.id}`, l: `Faction · ${f.name}` })),
    ...(targets.teams || []).map(t => ({ v: `team:${t.team_id}`, l: `Team · ${t.team_name}` })),
    ...(targets.groups || []).map(g => ({ v: `group:${g.key}`, l: `Group · ${g.label}` })),
  ];
  const save = () => run(
    () => saveMeetingNote({ id: form.id, targetType: form.targetType, targetKey: form.targetKey, content: form.content, attendeeIds: [...(form.attendeeIds || [])] }),
    { success: form.id ? "Meeting note saved." : "Meeting note recorded.", onDone },
  );

  return (
    <Card title={form.id ? "Edit meeting note" : "Document a meeting"} right={<Button variant="quiet" size="sm" onClick={onDone}>Cancel</Button>}>
      <div className="muted small" style={{ marginBottom: 12 }}>Who attended, what was discussed, decisions, concerns, follow-ups. Faction notes appear on the faction's hub; these records feed monthly reviews.</div>
      <div className="stack">
        <Field label="Meeting with" help={options.length === 0 ? "No targets in your scope — ask your Team Lead which factions you're assigned to." : undefined}>
          <select style={{ maxWidth: 420 }} value={form.targetType && form.targetKey ? `${form.targetType}:${form.targetKey}` : ""}
            onChange={e => { const [tt, ...r] = e.target.value.split(":"); setForm({ ...form, targetType: tt, targetKey: r.join(":"), attendeeIds: new Set() }); }}>
            <option value="">Select target…</option>
            {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
        <div className="field">
          <label>Notes</label>
          <div className="quill-wrap"><QuillEditor value={form.content} onChange={v => setForm({ ...form, content: v })} placeholder="Attendance, topics in order, decisions made, concerns raised, follow-ups…" /></div>
        </div>
        {attendees.length > 0 && (
          <div className="field">
            <label>Attendees ({form.attendeeIds?.size || 0} ticked)</label>
            <div className="chips">
              {attendees.map(a => { const on = form.attendeeIds?.has(a.discord_id); return (
                <button key={a.discord_id} type="button" className={`chip${on ? " on" : ""}`} onClick={() => { const s = new Set(form.attendeeIds); on ? s.delete(a.discord_id) : s.add(a.discord_id); setForm({ ...form, attendeeIds: s }); }}>{a.display_name}</button>
              ); })}
            </div>
          </div>
        )}
        <div className="row section">
          <Button disabled={busy || !form.targetType || !stripHtml(form.content)} onClick={save}>{busy ? "Saving…" : form.id ? "Save changes" : "Save meeting note"}</Button>
          <Button variant="quiet" onClick={onDone}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}
