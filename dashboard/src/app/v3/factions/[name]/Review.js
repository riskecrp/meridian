"use client";
import { useEffect, useState } from "react";
import {
  submitReview, setReviewStatus, submitPersonalNote, getVoteStatus,
  generateFeedbackDraft, adjustFeedbackDraft, sendFeedbackToFaction, markFeedbackSent, getFeedbackDraft,
} from "../../../fm/leadership/actions.js";
import { stagePromotion, completePromotion, cancelPromotion, demoteFaction } from "../../../fm/factions/actions.js";
import { Card, Badge, Button, Empty, Field, useAction, useToast } from "../../ui.js";
import { REVIEW_STATUSES } from "../../../../../../shared/validate.js";

const REC = ["Promote", "Hold", "Demote", "Remove"];
const voteLabel = (s) => String(s || "").replace("Confirmed ", "");

/* Which active L3s have voted on this faction this month, who only left a note,
   and who is still missing (getVoteStatus). */
export function VoteStrip({ factionId, refreshKey }) {
  const [row, setRow] = useState(null);
  const [month, setMonth] = useState("");
  useEffect(() => {
    if (!factionId) return;
    getVoteStatus().then(r => {
      if (!r?.ok) return;
      setMonth(r.month);
      setRow((r.factions || []).find(f => f.factionId === factionId) || { votes: [], missing: r.voters || [] });
    }).catch(() => {});
  }, [factionId, refreshKey]);
  if (!row) return null;
  const voted = row.votes.filter(v => v.status), noteOnly = row.votes.filter(v => !v.status);
  const total = voted.length + noteOnly.length + row.missing.length;
  return (
    <div className="vote-strip">
      <span className="lbl">Votes · {month}</span>
      {voted.map(v => <Badge key={v.authorId} tone="good">✓ {v.authorName} · {voteLabel(v.status)}</Badge>)}
      {noteOnly.map(v => <Badge key={v.authorId} tone="accent">{v.authorName} · note, no vote</Badge>)}
      {row.missing.map(m => <Badge key={m.id} tone="warn">— {m.name}</Badge>)}
      <span className="sp" />
      <span className="mono tiny" style={{ color: total && voted.length === total ? "var(--good)" : "var(--ink-3)" }}>{voted.length} of {total} voted</span>
    </div>
  );
}

function Step({ n, done, children }) { return <span><span className={`step${done ? " done" : ""}`}>{done ? "✓" : n}</span>{children}</span>; }

/* The monthly cycle as numbered steps. Staging machinery (tier + imports) stays
   behind the final step and only unlocks once the outcome is confirmed — or
   when a promotion is already staged. Writes key off `canWrite` (the server's
   team-scope answer); the vote itself is L3. */
export default function Review({ hub }) {
  const { detail, auth, isL3, canWrite, archived, reviewInfo, reviews, leadSummary, imports, reload } = hub;
  const { run, busy } = useAction();
  const toast = useToast();
  const cur = reviewInfo?.currentReview || null;
  const fbSent = reviewInfo?.feedbackSent || null;
  const promo = detail.promo || null;
  const canReview = canWrite && !archived;

  const [rec, setRec] = useState({ recommendation: cur?.recommendation || "", feedback: cur?.feedback || "" });
  const [note, setNote] = useState({ text: leadSummary?.mine?.note || "", status: leadSummary?.mine?.status || "" });
  const [fb, setFb] = useState("");
  const [adj, setAdj] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState(null);      // { kind: 'promote'|'demote', ... }
  useEffect(() => { setRec({ recommendation: cur?.recommendation || "", feedback: cur?.feedback || "" }); }, [cur?.id, cur?.recommendation, cur?.feedback]);
  useEffect(() => { if (leadSummary?.mine) setNote({ text: leadSummary.mine.note || "", status: leadSummary.mine.status || "" }); }, [leadSummary?.mine?.id, leadSummary?.mine?.status]);

  // Derived from the L3 votes (policy 7): a strict majority of the "Confirmed …" votes confirms the outcome.
  const tally = leadSummary?.tally || reviewInfo?.tally || { counts: {}, confirmed: 0 };
  const derived = leadSummary?.status || tally.derived || cur?.status || "Pending Discussion";
  const confirmed = derived.startsWith("Confirmed");
  const outcome = confirmed ? derived.replace("Confirmed ", "") : null;
  const notes = leadSummary?.notes || [], pending = leadSummary?.pending || [];
  const myVote = notes.find(n => n.author_id === auth.id) || null;
  const tallyText = Object.entries(tally.counts || {}).filter(([s]) => s).map(([s, c]) => `${voteLabel(s)} ×${c}`).join(" · ");

  const draft = async (fn, { adjust } = {}) => {
    setAiBusy(true);
    const r = await fn().catch(e => ({ ok: false, error: e?.message }));
    setAiBusy(false);
    if (r?.ok) { setFb(r.draft || r.message || ""); setSources(r.sources || []); if (adjust) setAdj(""); }
    else toast(r?.error || "Draft failed.", "bad");
  };
  const after = (msg, extra) => ({ success: msg, onDone: async () => { if (extra) extra(); await reload(); } });

  let n = 0;
  return (
    <div className="grid two">
      <div className="stack">
        <Card title={<Step n={++n} done>Evidence</Step>} right={<span className="muted small">auto</span>}>
          <div className="stats">
            <div className="stat"><div className="l">Scenes · this mo</div><div className="v">{reviewInfo?.scenes30 ?? detail.scenes30d ?? 0}</div></div>
            <div className="stat"><div className="l">Prev mo</div><div className="v">{reviewInfo?.scenes60 ?? 0}</div></div>
            <div className="stat"><div className="l">2 mo ago</div><div className="v">{reviewInfo?.scenes90 ?? 0}</div></div>
            <div className="stat"><div className="l">Forum · 30d</div><div className="v">{reviewInfo?.forumPosts ?? detail.forumPosts ?? 0}</div></div>
          </div>
        </Card>

        <Card title={<Step n={++n} done={!!cur}>Recommendation</Step>} right={<span className="muted small">{cur ? `${cur.recommendation} · by ${cur.reviewer_name || cur.submitted_by || "—"}` : "not started"}</span>}>
          <div className="restricted" style={{ marginBottom: 8 }}>Confidential to leadership · shared with the team lead for the 15th message</div>
          {!canReview ? <>
            {cur ? <div className="note" style={{ borderBottom: "none" }}><b>{cur.recommendation}</b> — <span className="body" style={{ display: "inline" }}>{cur.feedback}</span></div> : <Empty>No recommendation yet.</Empty>}
            <div className="hint">Only {reviewInfo?.teamName || "the owning team"}'s leads (or leadership) edit this review.</div>
          </> : <>
            <div className="chips" style={{ marginBottom: 10 }}>{REC.map(r => <button key={r} className={`chip${rec.recommendation === r ? " on" : ""}`} onClick={() => setRec({ ...rec, recommendation: r })}>{r}</button>)}</div>
            <Field label="Written feedback"><textarea rows={5} placeholder="What the team saw this month…" value={rec.feedback} onChange={e => setRec({ ...rec, feedback: e.target.value })} /></Field>
            <div className="inline-actions"><Button size="sm" disabled={busy || !rec.recommendation || !rec.feedback.trim()} onClick={() => run(() => submitReview({ factionId: detail.id, recommendation: rec.recommendation, feedback: rec.feedback }), after(cur ? "Review updated." : "Review submitted — leadership pinged to vote."))}>{cur ? "Update review" : "Submit review"}</Button></div>
          </>}
        </Card>

        <Card title={<Step n={++n} done={notes.length > 0 && pending.length === 0}>Leadership notes &amp; votes</Step>} right={<span className="muted small">{notes.length} of {notes.length + pending.length} voted{tallyText ? ` · ${tallyText}` : ""}</span>}>
          <VoteStrip factionId={detail.id} refreshKey={notes.map(x => `${x.id}:${x.status}`).join(",")} />
          {isL3 && !archived && <>
            <div className="lbl" style={{ marginBottom: 4 }}>{myVote ? "Your vote this month (saving again updates it)" : "Your vote this month"}</div>
            <div className="chips" style={{ marginBottom: 8 }}>{REVIEW_STATUSES.map(st => <button key={st} className={`chip${note.status === st ? " on" : ""}`} onClick={() => setNote({ ...note, status: note.status === st ? "" : st })}>{st === "Pending Discussion" ? "Discuss" : voteLabel(st)}</button>)}</div>
            <Field><textarea rows={3} placeholder="Private note this month…" value={note.text} onChange={e => setNote({ ...note, text: e.target.value })} /></Field>
            <div className="inline-actions"><Button size="sm" disabled={busy || !note.text.trim()} onClick={() => run(() => submitPersonalNote(detail.id, detail.name, note.text, note.status), after(myVote ? "Note & vote updated." : "Note & vote saved."))}>{myVote ? "Update note & vote" : "Save note & vote"}</Button></div>
          </>}
          <div style={{ marginTop: 10 }}>
            {notes.length === 0 ? <Empty>No leadership notes yet.</Empty> : notes.map((x, i) => <div className="note" key={x.id || i}><div className="body">{x.note}{x.status ? <> <Badge tone={x.status === "Confirmed Promote" ? "good" : x.status === "Confirmed Hold" ? "accent" : "warn"}>{voteLabel(x.status)}</Badge></> : null}</div><div className="hint mono">— {x.author_name || x.author_id}</div></div>)}
            {pending.length > 0 && <div className="hint mono" style={{ paddingTop: 8 }}>Awaiting: {pending.map(p => p.display_name).join(", ")}</div>}
          </div>
        </Card>

        <Card title={<Step n={++n} done={!!fbSent?.sent}>Feedback to the faction</Step>} right={<span className="muted small">{fbSent?.sent ? `sent by ${fbSent.by}` : "the 15th message"}</span>}>
          {fbSent?.sent && <div className="notice" style={{ marginBottom: 8 }}>✓ Delivered this month by {fbSent.by} ({String(fbSent.at || "").slice(0, 10)}).</div>}
          {!canReview ? <Empty>{reviewInfo?.teamName || "The owning team"}'s lead sends the feedback.</Empty> : <>
            {!cur && <div className="hint" style={{ marginBottom: 8 }}>Submit the recommendation first — the feedback is recorded against it.</div>}
            <div className="actions-inline">
              <Button size="sm" disabled={aiBusy || busy} onClick={() => draft(() => getFeedbackDraft(detail.id))}>{aiBusy ? "Working…" : "Draft from review & notes"}</Button>
              <Button size="sm" variant="ghost" disabled={aiBusy || busy} onClick={() => draft(() => generateFeedbackDraft(detail.id))}>{aiBusy ? "Working…" : "✦ AI draft"}</Button>
            </div>
            {sources.length > 0 && <div className="hint mono" style={{ marginTop: 6 }}>Built from: {sources.map(s => s.label).join(" · ")}</div>}
            <Field><textarea rows={6} placeholder="Message sent to the faction." value={fb} onChange={e => setFb(e.target.value)} /></Field>
            {fb.trim() && <div className="row" style={{ marginTop: 6 }}>
              <input className="inp" style={{ flex: 1, width: "auto", minWidth: 160 }} placeholder="Adjust the draft — e.g. “warmer tone, mention the new HQ”" value={adj} onChange={e => setAdj(e.target.value)} onKeyDown={e => e.key === "Enter" && adj.trim() && draft(() => adjustFeedbackDraft(detail.id, fb, adj), { adjust: true })} />
              <Button size="sm" variant="ghost" disabled={aiBusy || !adj.trim()} onClick={() => draft(() => adjustFeedbackDraft(detail.id, fb, adj), { adjust: true })}>Adjust ↺</Button>
            </div>}
            <div className="inline-actions">
              <Button size="sm" disabled={busy || !fb.trim() || !cur} onClick={() => { if (window.confirm(`Send this feedback to ${detail.name}'s Command channel?`)) run(() => sendFeedbackToFaction(detail.id, fb), after("Feedback sent to the faction.", () => setFb(""))); }}>Send to faction</Button>
              <Button size="sm" variant="ghost" disabled={busy || !cur || !!fbSent?.sent} onClick={() => run(() => markFeedbackSent(detail.id), after("Marked as sent."))}>Mark sent manually</Button>
            </div>
          </>}
        </Card>

        <Card title={<Step n={++n} done={confirmed}>Confirm outcome</Step>} right={<span className="muted small">{confirmed ? derived : tally.confirmed ? "no majority yet" : cur ? "awaiting leadership votes" : "needs a review first"}</span>}>
          <div className="small muted">The outcome is the majority of leadership votes{tallyText ? ` — ${tallyText}` : ""}. {confirmed ? <b style={{ color: "var(--good)" }}>{derived}.</b> : <span>Still <b>Pending Discussion</b>.</span>}
            {confirmed && (outcome === "Demote" || outcome === "Remove") && <div className="hint" style={{ marginTop: 6 }}>A leadership task was raised to apply the {outcome.toLowerCase()}.</div>}
          </div>
          {isL3 && !archived && (
            <div className="row" style={{ paddingTop: 8 }}>
              <span className="lbl">Your vote:</span>
              {!cur ? <span className="hint">vote from the notes step once the review is in</span>
                : ["Confirmed Promote", "Confirmed Hold", "Confirmed Demote", "Confirmed Remove"].map(st => <button key={st} className={`chip${myVote?.status === st ? " on" : ""}`} disabled={busy} onClick={() => run(() => setReviewStatus(cur.id, st), after(`Vote recorded: ${voteLabel(st)}.`))}>{voteLabel(st)}</button>)}
            </div>
          )}
        </Card>

        <Card title={<Step n={++n} done={false}>Apply</Step>} right={<span className="muted small">Tier {detail.tier}</span>}>
          {archived ? <div className="hint">Archived — nothing to apply.</div>
            : promo ? <>
              <div className="callout good" style={{ marginBottom: 10 }}><span>📋 Staged → Tier {promo.tier}{promo.imports?.length ? ` · ${promo.imports.length} imports` : ""}<span className="sub-l">Complete it after the RP has run.</span></span></div>
              <div className="actions-inline">
                {canReview && <Button size="sm" variant="good" disabled={busy} onClick={() => { if (window.confirm(`Complete the promotion for ${detail.name}? Do this after the RP has run.`)) run(() => completePromotion(detail.id), after("Promotion completed.")); }}>Complete promotion</Button>}
                {(isL3 || canReview) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Cancel this staged promotion?")) run(() => cancelPromotion(detail.id), after("Staged promotion cancelled.")); }}>Cancel</Button>}
                {!canReview && !isL3 && <span className="hint">The owning team lead completes it after the RP.</span>}
              </div>
            </>
            : !confirmed ? <div className="hint">🔒 Waiting for a confirmed outcome — the tier &amp; import controls unlock here.</div>
            : !isL3 ? <div className="hint">Outcome confirmed — leadership applies the {outcome.toLowerCase()} from here.</div>
            : outcome === "Promote" ? <>
              {form?.kind !== "promote" && <Button size="sm" onClick={() => setForm({ kind: "promote", tier: String(Math.min(9, detail.tier + 1)), picks: new Set(imports.filter(i => i.permitted).map(i => i.name)) })}>Stage promotion ↑</Button>}
              {form?.kind === "promote" && <div className="stack" style={{ gap: 8 }}>
                <Field label="Promote to tier"><select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>{[...Array(9)].map((_, i) => i + 1).filter(t => t > detail.tier).map(t => <option key={t} value={t}>Tier {t}</option>)}</select></Field>
                <div className="lbl">Imports after promotion ({form.picks.size}) — items above the target tier cannot be granted</div>
                <div className="scroll-box list">{imports.map(i => { const over = parseInt(i.tier || "1") > parseInt(form.tier); return <div className="li" key={i.id} style={{ opacity: over ? .45 : 1 }}><div className="body"><div className="t small">{i.name} <span className="faint tiny mono">T{i.tier}</span>{i.permitted && <span className="faint tiny"> · current</span>}</div></div><div className="side"><button className={`tg${form.picks.has(i.name) && !over ? " on" : ""}`} disabled={over} onClick={() => { const p = new Set(form.picks); p.has(i.name) ? p.delete(i.name) : p.add(i.name); setForm({ ...form, picks: p }); }}>{over ? "Above tier" : form.picks.has(i.name) ? "Granted" : "Off"}</button></div></div>; })}</div>
                <div className="inline-actions"><Button size="sm" disabled={busy} onClick={() => run(() => stagePromotion(detail.id, detail.name, parseInt(form.tier), [...form.picks].filter(nm => { const it = imports.find(i => i.name === nm); return it && parseInt(it.tier || "1") <= parseInt(form.tier); })), after("Promotion staged — complete it after the RP.", () => setForm(null)))}>Stage</Button><Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button></div>
              </div>}
            </>
            : outcome === "Demote" ? <>
              {form?.kind !== "demote" && <Button size="sm" variant="danger ghost" onClick={() => setForm({ kind: "demote", tier: String(Math.max(0, detail.tier - 1)) })}>Demote ↓</Button>}
              {form?.kind === "demote" && <div className="stack" style={{ gap: 8 }}>
                <Field label="Demote to tier" help="Imports above the new tier are revoked."><select value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}>{[...Array(detail.tier)].map((_, i) => <option key={i} value={i}>Tier {i}</option>)}</select></Field>
                <div className="inline-actions"><Button size="sm" variant="danger" disabled={busy} onClick={() => { if (window.confirm(`Demote ${detail.name} to Tier ${form.tier}?`)) run(() => demoteFaction(detail.id, detail.name, parseInt(form.tier)), after("Faction demoted.", () => setForm(null))); }}>Confirm demotion</Button><Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button></div>
              </div>}
            </>
            : outcome === "Remove" ? <div className="small muted">Removal confirmed — archive the faction from the <b>Admin tab → Danger zone</b> when ready.</div>
            : <div className="small muted">Hold confirmed — no tier change this month. ✓</div>}
        </Card>
      </div>

      <div className="stack">
        <Card flush title="Review history" right={<span className="muted small">{reviews.length}</span>}>
          {reviews.length === 0 ? <div style={{ padding: "0 16px 16px" }}><Empty>No reviews on file.</Empty></div> : (
            <div className="tblwrap"><table className="tbl"><thead><tr><th>Month</th><th>Rec</th><th>Outcome</th><th className="hide-sm">Sent</th></tr></thead><tbody>
              {reviews.map((r, i) => <tr key={r.id || i}><td><b>{r.review_month}</b></td><td>{r.recommendation || "—"}</td><td className="muted">{voteLabel(r.status) || "—"}</td><td className="faint small hide-sm">{r.feedback_sent_at ? `✓ ${r.feedback_sent_by}` : "—"}</td></tr>)}
            </tbody></table></div>
          )}
        </Card>
      </div>
    </div>
  );
}
