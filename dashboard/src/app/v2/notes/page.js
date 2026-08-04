"use client";
// Full-page meeting-note editor (owner rule: sheets/notes/prompts get a full-
// width editor, never a modal). Reached from "+ New → Meeting note" — open to
// every level. Targets come scoped from the server: your own team and its
// factions for L1/L2, everything (plus staff groups) for L3. ?id= edits.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import QuillEditor from "../../../lib/QuillEditor";
import { getMeetingNotes, saveMeetingNote, getNoteTargets, getAttendeesForTarget } from "../../fm/leadership/actions.js";
import { useRun } from "../hooks.js";

const stripHtml = (h) => (h || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");

export default function NotesPage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><NoteEditor /></Suspense>;
}

function NoteEditor() {
  const auth = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const editId = parseInt(sp.get("id")) || null;

  const [targets, setTargets] = useState(null); // { factions, teams, groups }
  const [form, setForm] = useState({ targetType: "", targetKey: "", content: "", attendeeIds: new Set() });
  const [attendees, setAttendees] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const { busy, err, setErr, run } = useRun();

  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    getNoteTargets().then(t => setTargets(t || { factions: [], teams: [], groups: [] })).catch(() => setTargets({ factions: [], teams: [], groups: [] }));
    if (editId) {
      getMeetingNotes().then(notes => {
        const n = (notes || []).find(x => x.id === editId);
        if (!n) { setNotFound(true); return; }
        setForm({
          id: n.id,
          targetType: n.target_type,
          targetKey: n.target_type === "faction" ? String(n.faction_id) : n.target_key,
          content: n.content,
          attendeeIds: new Set(n.attendeeIds || []),
        });
      }).catch(() => setNotFound(true));
    }
  }, [auth?.id, auth?.loading, editId]);

  useEffect(() => {
    if (!form.targetType || !form.targetKey) { setAttendees([]); return; }
    getAttendeesForTarget(form.targetType, form.targetKey).then(a => setAttendees(a || [])).catch(() => setAttendees([]));
  }, [form.targetType, form.targetKey]);

  if (auth?.loading || targets === null) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;
  if (notFound) return <div className="view"><div className="empty">Note not found (or not in your scope).</div></div>;

  const options = [
    ...(targets.factions || []).map(f => ({ v: `faction:${f.id}`, l: `Faction · ${f.name}` })),
    ...(targets.teams || []).map(t => ({ v: `team:${t.team_id}`, l: `Team · ${t.team_name}` })),
    ...(targets.groups || []).map(g => ({ v: `group:${g.key}`, l: `Group · ${g.label}` })),
  ];

  const save = () => run(
    () => saveMeetingNote({ id: form.id, targetType: form.targetType, targetKey: form.targetKey, content: form.content, attendeeIds: [...(form.attendeeIds || [])] }),
    () => {
      // Land where the note now lives: the faction's hub for faction notes,
      // the Leadership list for leads, Home for guides.
      if (form.targetType === "faction") {
        const fac = (targets.factions || []).find(f => String(f.id) === String(form.targetKey));
        if (fac) { router.push(`/v2/factions/${encodeURIComponent(fac.name)}?tab=activity`); return; }
      }
      router.push((auth.level >= 2 || auth.isLeadStoryteller) ? "/v2/leadership?tab=notes" : "/v2");
    }
  );

  return (
    <div className="view" style={{ maxWidth: 920 }}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Meeting notes</p>
          <h1>{form.id ? "Edit meeting note" : "Document a meeting"}</h1>
          <div className="sub">Who attended, what was discussed, decisions, concerns, follow-ups. Faction notes appear on the faction's hub; these records feed monthly reviews.</div>
        </div>
        <Link className="act" href={(auth.level >= 2 || auth.isLeadStoryteller) ? "/v2/leadership?tab=notes" : "/v2"}>Cancel</Link>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 }}>Meeting with</div>
          <select className="filter-inp" style={{ width: "100%" }}
            value={form.targetType && form.targetKey ? `${form.targetType}:${form.targetKey}` : ""}
            onChange={e => { const [tt, ...r] = e.target.value.split(":"); setForm({ ...form, targetType: tt, targetKey: r.join(":"), attendeeIds: new Set() }); }}>
            <option value="">Select target…</option>
            {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          {options.length === 0 && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 5 }}>No targets in your scope — ask your Team Lead which factions you're assigned to.</div>}
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 }}>Notes</div>
          <QuillEditor value={form.content} onChange={v => setForm({ ...form, content: v })} placeholder="Attendance, topics in order, decisions made, concerns raised, follow-ups…" />
        </div>

        {attendees.length > 0 && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 6 }}>Attendees ({form.attendeeIds?.size || 0} ticked)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {attendees.map(a => { const on = form.attendeeIds?.has(a.discord_id); return (
                <button key={a.discord_id} className={`pill${on ? " on" : ""}`}
                  onClick={() => { const s = new Set(form.attendeeIds); on ? s.delete(a.discord_id) : s.add(a.discord_id); setForm({ ...form, attendeeIds: s }); }}>
                  {a.display_name}
                </button>
              ); })}
            </div>
          </div>
        )}

        {err && <div className="err">{err}</div>}
        <div style={{ display: "flex", gap: 8, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
          <button className="btn" disabled={busy || !form.targetType || !stripHtml(form.content).trim()} onClick={save}>{busy ? "Saving…" : form.id ? "Save changes" : "Save meeting note"}</button>
        </div>
      </div>
    </div>
  );
}
