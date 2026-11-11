"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getReviewData, getVoteStatus, getReviewHistory, getPendingQueue, getAllLeadershipNotes, getFactionLeadershipSummary,
  submitReview, submitPersonalNote, setReviewStatus,
} from "../../fm/leadership/actions.js";
import { getPromotionReadiness, getFactionImports, stagePromotion, completePromotion, cancelPromotion, demoteFaction } from "../../fm/factions/actions.js";
import { REVIEW_STATUSES, REVIEW_RECOMMENDATIONS } from "../../../../../shared/validate.js";
import { Card, Badge, Button, Field, Empty, Modal, useAction, fmtDate } from "../ui.js";
import FeedbackComposer from "./FeedbackComposer.js";

/*
 * The month's review cycle as a sequence of steps, one row per faction:
 *   Recommend → Vote → Confirm → Feedback → Promotions
 * The step strip picks which step each row shows; a row expands to the
 * month's leadership notes, scene counts, promotion readiness and a link to
 * the faction hub's Review tab. Previous months are read-only (the recorded
 * faction_reviews row and that month's votes).
 *
 * Reads: getReviewData (this month, every active faction, `mine` = the actor
 * may write), getVoteStatus(month) (votes per faction over the active L3s,
 * scoped to the actor's factions), getPendingQueue (staged promotions),
 * getReviewHistory per faction for a previous month.
 */
const STEPS = [
  ["recommend", "Recommend", "Team leads' recommendation and written feedback"],
  ["vote", "Vote", "Each L3's vote for the month"],
  ["confirm", "Confirm", "Outcome derived from the votes"],
  ["feedback", "Feedback", "The 15th message to the faction"],
  ["promotions", "Promotions", "Staged promotions and demotions"],
];
const CONFIRMED = REVIEW_STATUSES.filter(s => s.startsWith("Confirmed "));
const short = (s) => String(s || "").replace("Confirmed ", "");
const recTone = (r) => r === "Promote" ? "good" : r === "Hold" ? "accent" : (r === "Demote" || r === "Remove") ? "bad" : "";
const statusTone = (s) => !s || s === "Pending Discussion" ? "warn" : recTone(short(s));
const monthLabel = (key) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }); };
const lastMonths = (n) => { const out = []; const d = new Date(); for (let i = 0; i < n; i++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.toISOString().slice(0, 7)); } return out; };

/** Majority of the 'Confirmed *' votes, else Pending Discussion (mirrors the server tally). */
function deriveStatus(votes) {
  const counts = {};
  let confirmed = 0, top = null;
  for (const v of votes || []) {
    if (!CONFIRMED.includes(v.status)) continue;
    counts[v.status] = (counts[v.status] || 0) + 1; confirmed++;
    if (!top || counts[v.status] > counts[top]) top = v.status;
  }
  return top && counts[top] * 2 > confirmed ? top : "Pending Discussion";
}

export default function Cycle({ auth }) {
  const level = auth?.level || 0;
  const isL3 = level >= 3;
  const isLST = !!auth?.isLeadStoryteller && level < 2;
  const curMonth = new Date().toISOString().slice(0, 7);
  const months = useMemo(() => lastMonths(12), []);

  const [month, setMonth] = useState(curMonth);
  const current = month === curMonth;
  const [rows, setRows] = useState(null);
  const [votes, setVotes] = useState(null);         // { voters, factions }
  const [promos, setPromos] = useState({});         // factionId → { tier, newImports }
  const [hist, setHist] = useState({});             // factionId → faction_reviews rows (previous months)
  const [histLoading, setHistLoading] = useState(false);
  const [step, setStep] = useState("recommend");
  const [flt, setFlt] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState({});         // factionId → { notes, readiness }
  const [editor, setEditor] = useState(null);       // { kind: rec | vote | feedback, id, ... }
  const [modal, setModal] = useState(null);         // { kind: promote | demote, f, tier, imports, picks }
  const { run, busy } = useAction();

  const load = async (first = false) => {
    const [r, v, pq] = await Promise.all([
      getReviewData().catch(() => []),
      getVoteStatus(month).catch(() => null),
      getPendingQueue().catch(() => null),
    ]);
    const list = r || [];
    setRows(list);
    setVotes(v?.ok ? v : { voters: [], factions: [] });
    const p = {}; (pq?.promos || []).forEach(x => { p[x.faction_id] = x; }); setPromos(p);
    // L2 default view: the team's factions. L3 and LST: everything.
    if (first && level === 2 && list.some(f => f.mine) && list.some(f => !f.mine)) setFlt("mine");
    setDetail({});
  };
  useEffect(() => { load(true); }, []);       // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                           // month change: re-read votes; previous months need each faction's history
    if (!rows) return;
    setEditor(null); setOpen(null); setDetail({});
    getVoteStatus(month).then(v => setVotes(v?.ok ? v : { voters: [], factions: [] })).catch(() => {});
    if (!current) {
      const missing = rows.filter(f => !hist[f.id]);
      if (missing.length) {
        setHistLoading(true);
        Promise.all(missing.map(f => getReviewHistory(f.id).then(h => [f.id, h || []]).catch(() => [f.id, []])))
          .then(pairs => { setHist(h => { const n = { ...h }; pairs.forEach(([id, list]) => { n[id] = list; }); return n; }); setHistLoading(false); });
      }
    }
  }, [month]);                                // eslint-disable-line react-hooks/exhaustive-deps

  const voteRow = (f) => (votes?.factions || []).find(x => x.factionId === f.id) || null;
  /** What the board shows for a faction in the selected month. */
  const view = (f) => {
    const vr = voteRow(f);
    if (current) return { review: f.currentReview, status: f.status || "Pending Discussion", feedbackSent: f.feedbackSent || { sent: false }, staged: !!f.staged, promo: promos[f.id] || null, votes: vr };
    const review = (hist[f.id] || []).find(r => r.review_month === month) || null;
    const status = review?.status || deriveStatus(vr?.votes);
    return { review, status, feedbackSent: review?.feedback_sent_at ? { sent: true, by: review.feedback_sent_by, at: review.feedback_sent_at } : { sent: false }, staged: false, promo: null, votes: vr };
  };

  const openDetail = async (f) => {
    const next = open === f.id ? null : f.id;
    setOpen(next);
    if (next && !detail[f.id]) {
      const [notes, readiness] = await Promise.all([getAllLeadershipNotes(f.id).catch(() => []), getPromotionReadiness(f.id).catch(() => null)]);
      setDetail(d => ({ ...d, [f.id]: { notes: notes || [], readiness } }));
    }
  };
  const afterWrite = async () => { setEditor(null); setModal(null); await load(); };

  // Editors (this month only).
  const openRec = (f) => { const r = f.currentReview; setEditor(editor?.kind === "rec" && editor.id === f.id ? null : { kind: "rec", id: f.id, recommendation: r?.recommendation || "", feedback: r?.feedback || "" }); };
  const openVote = async (f) => {
    if (editor?.kind === "vote" && editor.id === f.id) { setEditor(null); return; }
    setEditor({ kind: "vote", id: f.id, note: "", status: "", loading: true });
    const s = await getFactionLeadershipSummary(f.id).catch(() => null);
    setEditor(e => e?.kind === "vote" && e.id === f.id ? { ...e, note: s?.mine?.note || "", status: s?.mine?.status || "", loading: false } : e);
  };
  const openPromote = async (f) => {
    const imports = await getFactionImports(f.id).catch(() => []);
    setModal({ kind: "promote", f, tier: String(Math.min(9, f.tier + 1)), imports: imports || [], picks: new Set((imports || []).filter(i => i.permitted).map(i => i.name)) });
  };

  if (!rows || !votes) return <div className="stack"><div className="skeleton" style={{ height: 64 }} /><div className="skeleton" style={{ height: 40 }} /><div className="skeleton" style={{ height: 240 }} /></div>;

  // Filters
  const views = rows.map(f => [f, view(f)]);
  const shown = views.filter(([f, v]) => {
    if (q && ![f.name, f.teamName, f.leadName].some(x => (x || "").toLowerCase().includes(q.toLowerCase()))) return false;
    if (flt === "mine") return f.mine;
    if (flt === "todo") return !v.review;
    if (flt === "votes") return !(v.votes?.complete);
    if (flt === "confirm") return !!v.review && !String(v.status).startsWith("Confirmed");
    if (flt === "feedback") return !v.feedbackSent.sent;
    if (flt === "staged") return v.staged;
    return true;
  });
  const n = views.length;
  const counts = {
    recommend: views.filter(([, v]) => v.review).length,
    vote: views.filter(([, v]) => v.votes?.complete).length,
    confirm: views.filter(([, v]) => String(v.status).startsWith("Confirmed")).length,
    feedback: views.filter(([, v]) => v.feedbackSent.sent).length,
    promotions: views.filter(([, v]) => v.staged).length,
  };
  const stepMeta = { recommend: `${counts.recommend}/${n}`, vote: `${counts.vote}/${n}`, confirm: `${counts.confirm}/${n}`, feedback: `${counts.feedback}/${n}`, promotions: current ? `${counts.promotions} staged` : "—" };
  const stepDone = { recommend: counts.recommend === n, vote: counts.vote === n, confirm: counts.confirm === n, feedback: counts.feedback === n, promotions: false };
  const canWriteRow = (f) => current && f.mine && !isLST && level >= 2;

  return (
    <>
      <div className="rv-steps" role="tablist" aria-label="Cycle steps">
        {STEPS.map(([id, label, hint], i) => (
          <button key={id} role="tab" aria-selected={step === id} className={`rv-step${step === id ? " on" : ""}${stepDone[id] ? " done" : ""}`} title={hint} onClick={() => setStep(id)}>
            <span className="n">{stepDone[id] ? "✓" : i + 1}</span>
            <span className="body"><span className="t">{label}</span><span className="d mono">{stepMeta[id]}</span></span>
          </button>
        ))}
      </div>

      <div className="rv-toolbar">
        <Field><select className="inp rv-inp" value={month} onChange={e => setMonth(e.target.value)} aria-label="Review month">{months.map(m => <option key={m} value={m}>{monthLabel(m)}{m === curMonth ? " · current" : ""}</option>)}</select></Field>
        <div className="chips">
          {[["all", "All"], ...(rows.some(f => f.mine) && rows.some(f => !f.mine) ? [["mine", "My team"]] : []), ["todo", "Needs review"], ["votes", "Needs votes"], ["confirm", "Needs confirm"], ["feedback", "Needs feedback"], ...(current ? [["staged", "Staged"]] : [])].map(([v, l]) => (
            <button key={v} className={`chip${flt === v ? " on" : ""}`} onClick={() => setFlt(v)}>{l}</button>
          ))}
        </div>
        <input className="inp rv-inp" placeholder="Filter factions…" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter factions" />
        <span className="mono tiny faint rv-due">{current ? "due the 15th" : `${monthLabel(month)} · read-only`}</span>
      </div>

      {!current && <div className="info" style={{ marginBottom: 12 }}>Previous month: the recorded review, votes and feedback delivery are shown; nothing here can be changed.{histLoading ? " Loading the month's reviews…" : ""}</div>}
      {rows.length === 0 && <Empty title="No active factions">Nothing to review.</Empty>}
      {rows.length > 0 && shown.length === 0 && <Empty>Nothing matches this filter.</Empty>}

      {shown.length > 0 && (
        <Card flush>
          <div className="list rv-list">
            {shown.map(([f, v]) => {
              const isOpen = open === f.id;
              const myVote = (v.votes?.votes || []).find(x => x.authorId === auth.id) || null;
              const d = detail[f.id];
              return (
                <div key={f.id} className="rv-row">
                  <div className="rv-head">
                    <button className="rv-name" onClick={() => openDetail(f)} aria-expanded={isOpen}>
                      <span className={`rv-caret${isOpen ? " open" : ""}`}>▸</span>
                      <span className="t">{f.name}</span>
                      <Badge tone={f.tier >= 7 ? "lock" : f.tier >= 4 ? "accent" : ""}>T{f.tier}</Badge>
                      {f.teamName && <span className="muted small hide-sm">{f.teamName}</span>}
                      <span className="mono tiny faint hide-sm" title="Scenes in the last 30 days">{f.scenes30} sc</span>
                      <span className="rv-dots" aria-label="Cycle progress">
                        <Dot on={!!v.review} label="REC" hint={v.review ? "review submitted" : "no review yet"} />
                        <Dot on={!!v.votes?.complete} label="VOTE" hint={v.votes ? `${v.votes.voted} of ${v.votes.votes.length + v.votes.missing.length} voted` : "outside your scope"} />
                        <Dot on={String(v.status).startsWith("Confirmed")} label="CONF" hint={v.status} />
                        <Dot on={!!v.feedbackSent.sent} label="SENT" hint={v.feedbackSent.sent ? `by ${v.feedbackSent.by}` : "feedback not delivered"} />
                      </span>
                      {v.staged && <Badge tone="lock">STAGED</Badge>}
                    </button>
                    <div className="rv-cell">
                      {step === "recommend" && <RecommendCell f={f} v={v} canWrite={canWriteRow(f)} editing={editor?.kind === "rec" && editor.id === f.id} onEdit={() => openRec(f)} />}
                      {step === "vote" && <VoteCell v={v} authId={auth.id} canVote={current && isL3} editing={editor?.kind === "vote" && editor.id === f.id} onVote={() => openVote(f)} />}
                      {step === "confirm" && <ConfirmCell v={v} myVote={myVote} canVote={current && isL3} busy={busy} onVote={(st) => run(() => setReviewStatus(v.review.id, st), { success: `Vote recorded for ${f.name}.`, onDone: afterWrite })} />}
                      {step === "feedback" && <FeedbackCell f={f} v={v} canWrite={canWriteRow(f)} editing={editor?.kind === "feedback" && editor.id === f.id} onCompose={() => setEditor(editor?.kind === "feedback" && editor.id === f.id ? null : { kind: "feedback", id: f.id })} />}
                      {step === "promotions" && <PromotionCell f={f} v={v} current={current} isL3={isL3} canWrite={canWriteRow(f) || (current && isL3)} busy={busy}
                        onComplete={() => { if (window.confirm(`Complete the promotion for ${f.name}? Do this after the RP has run.`)) run(() => completePromotion(f.id), { success: `${f.name} promoted.`, onDone: afterWrite }); }}
                        onCancel={() => { if (window.confirm(`Cancel the staged promotion for ${f.name}?`)) run(() => cancelPromotion(f.id), { success: "Staged promotion cancelled.", onDone: afterWrite }); }}
                        onStage={() => openPromote(f)} onDemote={() => setModal({ kind: "demote", f, tier: String(Math.max(0, f.tier - 1)) })} />}
                    </div>
                  </div>

                  {editor?.kind === "rec" && editor.id === f.id && (
                    <div className="inline-form">
                      <span className="lbl">{f.currentReview ? "Update" : "Write"} the team's recommendation for {f.name} — {month}</span>
                      <div className="chips">{REVIEW_RECOMMENDATIONS.map(r => <button key={r} className={`chip${editor.recommendation === r ? " on" : ""}`} onClick={() => setEditor({ ...editor, recommendation: r })}>{r}</button>)}</div>
                      <Field label="Written feedback (confidential to leadership; the basis of the 15th message)"><textarea rows={5} value={editor.feedback} onChange={e => setEditor({ ...editor, feedback: e.target.value })} placeholder="How the month went, what to keep doing, what must change…" /></Field>
                      <div className="actions-inline">
                        <Button disabled={busy || !editor.recommendation || !editor.feedback.trim()} onClick={() => run(() => submitReview({ factionId: f.id, recommendation: editor.recommendation, feedback: editor.feedback }), { success: f.currentReview ? "Review updated." : "Review submitted — leadership has been pinged to vote.", onDone: afterWrite })}>{f.currentReview ? "Update review" : "Submit review"}</Button>
                        <Button variant="quiet" onClick={() => setEditor(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                  {editor?.kind === "vote" && editor.id === f.id && (
                    <div className="inline-form">
                      <span className="lbl">{myVote ? "Your vote this month (saving again updates it)" : "Your vote this month"} — {f.name}</span>
                      {editor.loading ? <div className="skeleton" style={{ height: 60 }} /> : <>
                        <div className="chips">{REVIEW_STATUSES.map(st => <button key={st} className={`chip${editor.status === st ? " on" : ""}`} onClick={() => setEditor({ ...editor, status: editor.status === st ? "" : st })}>{st === "Pending Discussion" ? "Discuss" : short(st)}</button>)}</div>
                        <Field label="Private note (required; the note's status is the vote)" help="A note without a vote counts as a note only. The faction lead is pinged to fold it into the 15th message."><textarea rows={3} value={editor.note} onChange={e => setEditor({ ...editor, note: e.target.value })} placeholder="Your note on this faction's month…" /></Field>
                        <div className="actions-inline">
                          <Button disabled={busy || !editor.note.trim()} onClick={() => run(() => submitPersonalNote(f.id, f.name, editor.note, editor.status), { success: myVote ? "Note and vote updated." : "Note and vote saved.", onDone: afterWrite })}>{myVote ? "Update note & vote" : "Save note & vote"}</Button>
                          <Button variant="quiet" onClick={() => setEditor(null)}>Cancel</Button>
                        </div>
                      </>}
                    </div>
                  )}
                  {editor?.kind === "feedback" && editor.id === f.id && (
                    <FeedbackComposer faction={{ ...f, currentReview: v.review, feedbackSent: v.feedbackSent }} reviewMonth={month} readOnly={!current} onDone={afterWrite} onClose={() => setEditor(null)} />
                  )}

                  {isOpen && (
                    <div className="rv-detail">
                      {!d ? <div className="skeleton" style={{ height: 90 }} /> : (
                        <div className="grid two">
                          <div>
                            <div className="lbl">Leadership notes · {month}</div>
                            {(() => { const notes = d.notes.filter(x => x.review_month === month); return notes.length === 0 ? <div className="muted small" style={{ marginTop: 4 }}>No leadership notes for {month}.</div> : (
                              <div className="list">{notes.map(x => <div key={x.id} className="li"><div className="body"><div className="d" style={{ color: "var(--ink-1)", whiteSpace: "pre-wrap" }}>{x.note}</div><div className="tiny faint" style={{ marginTop: 2 }}>— {x.author_name || x.author_id}{x.created_at ? ` · ${fmtDate(x.created_at)}` : ""}</div></div>{x.status && <div className="side"><Badge tone={statusTone(x.status)}>{short(x.status)}</Badge></div>}</div>)}</div>
                            ); })()}
                            {v.review && <div style={{ marginTop: 10 }}><div className="lbl">Team lead's note · {v.review.reviewer_name || v.review.submitted_by || "—"}</div><div className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{v.review.feedback || <span className="muted">No written feedback.</span>}</div></div>}
                          </div>
                          <div className="stack" style={{ gap: 10 }}>
                            <div className="stats rv-stats">
                              <div className="stat"><div className="l">Scenes 30d</div><div className="v">{f.scenes30}</div></div>
                              <div className="stat"><div className="l">31–60d</div><div className="v">{f.scenes60}</div></div>
                              <div className="stat"><div className="l">61–90d</div><div className="v">{f.scenes90}</div></div>
                              <div className="stat"><div className="l">Forum 30d</div><div className="v">{f.forumPosts}</div></div>
                              <div className="stat"><div className="l">Intel 30d</div><div className="v">{f.noteCount}</div></div>
                            </div>
                            {d.readiness ? (
                              <div>
                                <div className="lbl">Promotion readiness · {d.readiness.nextTier == null ? "top tier" : `next: Tier ${d.readiness.nextTier}`} · {d.readiness.met}/{d.readiness.checks.length} met</div>
                                <div className="list">{d.readiness.checks.map(c => <div key={c.id} className="li rd-row"><span className={`rd-ok${c.ok ? " yes" : ""}`}>{c.ok ? "✓" : "✕"}</span><div className="body small">{c.label}</div><div className="side mono small"><b>{c.value}</b> <span className="faint">· {c.op === "max" ? "≤" : "≥"} {c.target}</span></div></div>)}</div>
                                <div className="tiny faint" style={{ marginTop: 4 }}>{d.readiness.archived ? "Archived — for the record only." : d.readiness.staged ? "A promotion is already staged." : d.readiness.ready ? "Every check is met — worth raising at this review." : "A guide for the review, not a gate."}</div>
                              </div>
                            ) : <div className="muted small">Readiness is not available for this faction.</div>}
                            <div className="row small">
                              <span className="muted">Last promoted: {f.lastPromoted === "Never" ? "never" : fmtDate(f.lastPromoted)}</span>
                              <span className="faint">·</span>
                              <Link className="rv-link" href={`/v3/factions/${encodeURIComponent(f.name)}?tab=review`}>Open the hub's Review tab →</Link>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {modal?.kind === "promote" && (
        <Modal title={`Stage promotion — ${modal.f.name}`} saveLabel="Stage" saveDisabled={busy} onClose={() => setModal(null)}
          onSave={() => run(() => stagePromotion(modal.f.id, modal.f.name, parseInt(modal.tier), [...modal.picks].filter(nm => { const it = modal.imports.find(i => i.name === nm); return it && parseInt(it.tier || "1") <= parseInt(modal.tier); })), { success: `Promotion staged for ${modal.f.name}. Complete it after the RP.`, onDone: afterWrite })}>
          <Field label="Promote to tier"><select value={modal.tier} onChange={e => setModal({ ...modal, tier: e.target.value })}>{[...Array(9)].map((_, i) => i + 1).filter(t => t > modal.f.tier).map(t => <option key={t} value={t}>Tier {t}</option>)}</select></Field>
          <div className="lbl">Imports after promotion ({[...modal.picks].filter(nm => { const it = modal.imports.find(i => i.name === nm); return it && parseInt(it.tier || "1") <= parseInt(modal.tier); }).length}) — items above the target tier cannot be granted</div>
          <div className="imp-list">
            {modal.imports.length === 0 && <div className="muted small">No import items are defined.</div>}
            {modal.imports.map(i => { const over = parseInt(i.tier || "1") > parseInt(modal.tier); const on = modal.picks.has(i.name) && !over; return (
              <button key={i.id} type="button" className={`chip${on ? " on" : ""}`} disabled={over} title={over ? `Tier ${i.tier} — above the target tier` : i.category || ""} onClick={() => { const p = new Set(modal.picks); p.has(i.name) ? p.delete(i.name) : p.add(i.name); setModal({ ...modal, picks: p }); }}>
                {i.name} <span className="tiny faint">T{i.tier}{i.permitted ? " · current" : ""}</span>
              </button>
            ); })}
          </div>
        </Modal>
      )}
      {modal?.kind === "demote" && (
        <Modal title={`Demote — ${modal.f.name}`} saveLabel="Confirm demotion" saveDisabled={busy} onClose={() => setModal(null)}
          onSave={() => run(() => demoteFaction(modal.f.id, modal.f.name, parseInt(modal.tier)), { success: `${modal.f.name} demoted to Tier ${modal.tier}.`, onDone: afterWrite })}>
          <Field label="Demote to tier" help="Imports above the new tier are revoked and any staged promotion is cleared."><select value={modal.tier} onChange={e => setModal({ ...modal, tier: e.target.value })}>{[...Array(modal.f.tier)].map((_, i) => <option key={i} value={i}>Tier {i}</option>)}</select></Field>
        </Modal>
      )}
    </>
  );
}

/* ── Step cells ── */
function Dot({ on, label, hint }) {
  return <span className={`rv-dot${on ? " on" : ""}`} title={`${label} — ${hint || ""}`}><i /><span>{label}</span></span>;
}

function RecommendCell({ f, v, canWrite, editing, onEdit }) {
  const r = v.review;
  return (
    <div className="rv-cellin">
      <div className="row" style={{ gap: 8 }}>
        {r ? <Badge tone={recTone(r.recommendation)}>{r.recommendation || "—"}</Badge> : <Badge tone="warn">Not reviewed</Badge>}
        {r && <span className="small muted">by {r.reviewer_name || r.submitted_by || "—"}{r.created_at ? ` · ${fmtDate(r.created_at)}` : ""}</span>}
        {!r && f.leadName && <span className="small muted">lead: {f.leadName}</span>}
        {canWrite && <Button size="sm" variant={editing ? "" : "ghost"} onClick={onEdit}>{r ? "Edit" : "Write recommendation"}</Button>}
      </div>
      {r?.feedback && <div className="rv-note small">{r.feedback}</div>}
    </div>
  );
}

function VoteCell({ v, authId, canVote, editing, onVote }) {
  const vr = v.votes;
  if (!vr) return <span className="small muted">Votes are outside your team's scope.</span>;
  const voted = vr.votes.filter(x => x.status);
  const noteOnly = vr.votes.filter(x => !x.status);
  const total = voted.length + noteOnly.length + vr.missing.length;
  const mine = vr.votes.find(x => x.authorId === authId);
  return (
    <div className="rv-cellin">
      <div className="votes">
        {voted.map(x => <span key={x.authorId} className={`vote yes${x.authorId === authId ? " me" : ""}`} title={x.status}>✓ {x.authorName} · {short(x.status)}</span>)}
        {noteOnly.map(x => <span key={x.authorId} className={`vote note${x.authorId === authId ? " me" : ""}`}>{x.authorName} · note, no vote</span>)}
        {vr.missing.map(m => <span key={m.id} className={`vote missing${m.id === authId ? " me" : ""}`}>— {m.name}</span>)}
        <span className={`mono tiny ${total && voted.length === total ? "good-text" : "faint"}`}>{voted.length} of {total} voted</span>
        {canVote && <Button size="sm" variant={editing ? "" : "ghost"} onClick={onVote}>{mine?.status ? "Change my vote" : mine ? "Add my vote" : "Vote"}</Button>}
      </div>
    </div>
  );
}

function ConfirmCell({ v, myVote, canVote, busy, onVote }) {
  const confirmed = String(v.status).startsWith("Confirmed");
  const outcome = confirmed ? short(v.status) : null;
  const tallyText = (() => { const c = {}; (v.votes?.votes || []).forEach(x => { if (x.status) c[x.status] = (c[x.status] || 0) + 1; }); return Object.entries(c).map(([s, n]) => `${short(s)} ×${n}`).join(" · "); })();
  return (
    <div className="rv-cellin">
      <div className="row" style={{ gap: 8 }}>
        <Badge tone={statusTone(v.status)}>{confirmed ? v.status : "Pending Discussion"}</Badge>
        <span className="small muted">{tallyText || (v.review ? "awaiting leadership votes" : "needs a review first")}</span>
      </div>
      {confirmed && (outcome === "Demote" || outcome === "Remove") && <div className="tiny faint">A leadership task was raised to apply the {outcome.toLowerCase()}.</div>}
      {canVote && (
        <div className="row" style={{ gap: 6 }}>
          <span className="mono tiny faint">Your vote:</span>
          {!v.review ? <span className="tiny muted">vote from the Vote step once the review is in</span>
            : CONFIRMED.map(st => <button key={st} className={`chip${myVote?.status === st ? " on" : ""}`} disabled={busy} onClick={() => onVote(st)}>{short(st)}</button>)}
        </div>
      )}
      {canVote && <div className="tiny faint">The outcome is the strict majority of leadership votes — there is no manual override.</div>}
    </div>
  );
}

function FeedbackCell({ f, v, canWrite, editing, onCompose }) {
  const s = v.feedbackSent;
  return (
    <div className="rv-cellin">
      <div className="row" style={{ gap: 8 }}>
        {s.sent ? <Badge tone="good">Sent</Badge> : <Badge tone={v.review ? "warn" : ""}>{v.review ? "Not sent" : "No review yet"}</Badge>}
        {s.sent && <span className="small muted">by {s.by}{s.at ? ` · ${fmtDate(s.at)}` : ""}</span>}
        {!s.sent && v.review && <span className="small muted">due the 15th</span>}
        {canWrite && <Button size="sm" variant={editing ? "" : s.sent ? "ghost" : "good"} onClick={onCompose} title={s.sent ? "Delivered this month — write another or re-send" : "Write and send this month's feedback"}>{editing ? "Close" : "Feedback"}</Button>}
        {!canWrite && !f.mine && <span className="tiny faint">{f.teamName || "the owning team"}'s lead sends it</span>}
      </div>
    </div>
  );
}

function PromotionCell({ f, v, current, isL3, canWrite, busy, onComplete, onCancel, onStage, onDemote }) {
  if (!current) return <span className="small muted">Promotion state is only tracked for the current month.</span>;
  const outcome = String(v.status).startsWith("Confirmed") ? short(v.status) : null;
  if (v.staged) {
    const p = v.promo;
    return (
      <div className="rv-cellin">
        <div className="row" style={{ gap: 8 }}>
          <Badge tone="lock">Staged → T{p?.tier ?? "?"}</Badge>
          <span className="small muted">from T{f.tier}{p?.newImports?.length ? ` · +${p.newImports.length} import${p.newImports.length === 1 ? "" : "s"}` : " · tier change only"}</span>
          {canWrite && <><Button size="sm" variant="good" disabled={busy} onClick={onComplete}>Complete</Button><Button size="sm" variant="danger ghost" disabled={busy} onClick={onCancel}>Cancel</Button></>}
          {!canWrite && <span className="tiny faint">the owning team lead completes it after the RP</span>}
        </div>
      </div>
    );
  }
  if (!outcome) return <span className="small muted">Waiting for a confirmed outcome.</span>;
  if (outcome === "Promote") return <div className="row" style={{ gap: 8 }}><Badge tone="good">Promote confirmed</Badge>{isL3 ? <Button size="sm" disabled={busy} onClick={onStage}>Stage promotion ↑</Button> : <span className="tiny faint">an L3 stages the promotion</span>}</div>;
  if (outcome === "Demote") return <div className="row" style={{ gap: 8 }}><Badge tone="bad">Demote confirmed</Badge>{isL3 ? <Button size="sm" variant="danger ghost" disabled={busy} onClick={onDemote}>Demote ↓</Button> : <span className="tiny faint">an L3 applies the demotion</span>}</div>;
  if (outcome === "Remove") return <div className="row" style={{ gap: 8 }}><Badge tone="bad">Remove confirmed</Badge><span className="small muted">archive the faction from the hub's Admin tab when the RP has concluded</span></div>;
  return <div className="row" style={{ gap: 8 }}><Badge tone="accent">Hold confirmed</Badge><span className="small muted">no tier change this month</span></div>;
}
