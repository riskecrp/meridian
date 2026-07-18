"use client";
import { useEffect, useMemo, useState } from "react";

const STATUS_LABELS = { 'Pending Discussion':'Pending', 'Confirmed Hold':'Hold', 'Confirmed Promote':'Promote', 'Confirmed Demote':'Demote', 'Confirmed Remove':'Remove' };
const displayStatus = s => STATUS_LABELS[s] || s || '';
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getReviewData, submitReview, editReview, getReviewHistory, getMyPersonalNotes, submitPersonalNote, editPersonalNote, getAllLeadershipNotes, getFactionLeadershipSummary, generateFeedbackDraft, adjustFeedbackDraft, sendFeedbackToFaction, markFeedbackSent } from "../actions";
import { s } from "../_shared/styles";
import LeadershipShell from "../_shared/Shell";
import { useDraft, loadDraft } from "../../../../lib/useDraft";

// Keep only per-faction entries that actually contain typed content, so the
// stored draft stays small and we never restore empty rows.
const pruneReviewForm = (map) => {
  const o = {};
  for (const k in map) { const v = map[k]; if (v && ((v.feedback || '').trim() || v.recommendation)) o[k] = v; }
  return o;
};
const pruneStrMap = (map) => {
  const o = {};
  for (const k in map) { if ((map[k] || '').trim()) o[k] = map[k]; }
  return o;
};

export default function ReviewsPage() {
  const auth = useAuth();
  const { showAlert, showConfirm } = useDialog();
  const [loading, setLoading] = useState(true);
  const [reviewData, setReviewData] = useState([]);
  const [reviewExpanded, setReviewExpanded] = useState(null);
  const [reviewForm, setReviewForm] = useState({});
  const [reviewHistoryView, setReviewHistoryView] = useState(null);
  const [reviewHistory, setReviewHistory] = useState([]);
  const [leadershipNoteHistory, setLeadershipNoteHistory] = useState([]);
  const [personalNotes, setPersonalNotes] = useState({});          // factionId → []
  const [personalNoteText, setPersonalNoteText] = useState({});    // factionId → string
  const [personalNoteStatus, setPersonalNoteStatus] = useState({}); // factionId → status string
  const [noteSubmitting, setNoteSubmitting] = useState(null);
  const [editingNote, setEditingNote] = useState(null);            // { id, note, status }
  const [noteEditSaving, setNoteEditSaving] = useState(false);
  const [leadershipSummary, setLeadershipSummary] = useState({});  // factionId → { notes, pending }
  const [feedbackMsg, setFeedbackMsg] = useState({});              // factionId → string
  const [aiGenerating, setAiGenerating] = useState(null);          // factionId | null
  const [aiAdjusting, setAiAdjusting] = useState(null);           // factionId | null
  const [adjustOpen, setAdjustOpen] = useState(null);              // factionId | null
  const [adjustInstruction, setAdjustInstruction] = useState({});  // factionId → string
  const [feedbackSending, setFeedbackSending] = useState(null);    // factionId | null
  const [feedbackResult, setFeedbackResult] = useState({});        // factionId → { ok, error }

  const loadFactionNotes = async (factionId) => {
    const [summary, myNotes] = await Promise.all([
      getFactionLeadershipSummary(factionId),
      auth.level >= 3 ? getMyPersonalNotes(factionId) : Promise.resolve([]),
    ]);
    setLeadershipSummary(prev => ({ ...prev, [factionId]: summary }));
    if (auth.level >= 3) setPersonalNotes(prev => ({ ...prev, [factionId]: myNotes || [] }));
  };

  const canAccess = !auth.loading && auth.level >= 2;

  useEffect(() => {
    if (auth.loading || !canAccess) return;
    (async () => { setLoading(true); setReviewData(await getReviewData()); setLoading(false); })();
  }, [auth.loading, canAccess]);

  // Restore any unsaved review text saved before a reload/crash, then autosave
  // it on every keystroke. The inline textareas already fall back to the server
  // value when there is no draft entry, so restoring these maps is safe.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const rf = loadDraft('reviews:form');         if (rf) setReviewForm(rf);
    const pn = loadDraft('reviews:personalNote'); if (pn) setPersonalNoteText(pn);
    const fm = loadDraft('reviews:feedbackMsg');  if (fm) setFeedbackMsg(fm);
    setHydrated(true);
  }, []);
  const reviewFormDraft   = useMemo(() => pruneReviewForm(reviewForm),    [reviewForm]);
  const personalNoteDraft = useMemo(() => pruneStrMap(personalNoteText),  [personalNoteText]);
  const feedbackMsgDraft  = useMemo(() => pruneStrMap(feedbackMsg),       [feedbackMsg]);
  useDraft('reviews:form',         reviewFormDraft,   { enabled: hydrated });
  useDraft('reviews:personalNote', personalNoteDraft, { enabled: hydrated });
  useDraft('reviews:feedbackMsg',  feedbackMsgDraft,  { enabled: hydrated });

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (!canAccess) return <div className="p-10 text-sm" style={{color:'var(--red)'}}>Access denied. Team Lead or FM Leadership required.</div>;

  return (
    <LeadershipShell title="Reviews" docs={[{"title": "Monthly Reviews & Promotions", "label": "Reviews Guide", "minLevel": 1}]} level={auth.level}>
      {loading && <div className="text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>}
      {!loading && (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,fontFamily:'var(--font-display)'}}>Mid-Month Reviews — {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
              <div style={{fontSize:10,color:'var(--fg-4)',marginTop:2,fontFamily:'var(--font-mono)'}}>One per faction per month · all team leads can view · edit your own team · Unsaved feedback auto-saves</div>
            </div>
            <span className="badge badge-dim">{reviewData.filter(r=>r.currentReview).length} / {reviewData.length}</span>
          </div>
          {reviewData.map(f => {
            const isExp = reviewExpanded === f.id;
            const hasReview = !!f.currentReview;
            const form = reviewForm[f.id] || { recommendation: f.currentReview?.recommendation || '', feedback: f.currentReview?.feedback || '' };
            const status = f.currentReview?.status || 'Pending Discussion';
            const canEditDelete = hasReview && (f.currentReview?.reviewer_id === auth.id || auth.level >= 3);
            // Everyone can view; only own-team factions (or L3) are editable.
            const canReview = f.mine || auth.level >= 3;
            const recBg  = r => r==='Promote'?'var(--green-bg)':r==='Demote'||r==='Remove'?'var(--red-bg)':'var(--amber-bg)';
            const recCol = r => r==='Promote'?'var(--green)':r==='Demote'||r==='Remove'?'var(--red)':'var(--amber)';
            const statusStyles = {
              'Pending Discussion': { bg:'rgba(99,102,241,0.12)', color:'var(--accent)' },
              'Confirmed Hold':     { bg:'rgba(251,191,36,0.12)', color:'var(--amber)' },
              'Confirmed Promote':  { bg:'rgba(74,222,128,0.12)', color:'var(--green)' },
              'Confirmed Demote':   { bg:'rgba(248,113,113,0.12)', color:'var(--red)' },
              'Confirmed Remove':   { bg:'rgba(248,113,113,0.18)', color:'var(--red)' },
            };
            const ss = statusStyles[status] || statusStyles['Pending Discussion'];
            return (
              <div key={f.id} className="rounded-xl overflow-hidden" style={{background:'var(--bg-1)',border:isExp?'1px solid var(--accent)':'1px solid var(--border)'}}>
                <div className="flex items-center justify-between px-5 py-3 cursor-pointer" onClick={() => { setReviewExpanded(isExp?null:f.id); if (!isExp) loadFactionNotes(f.id); }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{background:'var(--bg-3)',color:'var(--fg-4)'}}>T{f.tier}</span>
                    <span className="font-bold">{f.name}</span>
                    <span className="text-[11px]" style={{color:'var(--fg-4)'}}>{f.teamName}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px]" style={{color:'var(--fg-4)'}}>📊 {f.scenes30} · 📰 {f.forumPosts} · 📝 {f.noteCount}</span>
                    {f.hasMyNote === false && (
                      <span style={{fontSize:9, fontWeight:700, padding:'1px 7px', borderRadius:4, background:'rgba(251,191,36,0.15)', color:'var(--amber)', border:'1px solid rgba(251,191,36,0.3)', letterSpacing:'0.04em'}}>YOUR INPUT NEEDED</span>
                    )}
                    {hasReview && <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{background:recBg(form.recommendation),color:recCol(form.recommendation)}}>{form.recommendation}</span>}
                    {hasReview && <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{background:ss.bg,color:ss.color}}>{displayStatus(status)}</span>}
                    {!hasReview && <span className="text-[10px] font-bold" style={{color:'var(--fg-4)'}}>PENDING</span>}
                    <span style={{color:'var(--fg-4)',transform:isExp?'rotate(180deg)':'none',transition:'transform 0.15s'}}>▼</span>
                  </div>
                </div>
                {isExp && (
                  <div className="px-5 pb-4 pt-1 space-y-3" style={{borderTop:'1px solid var(--border)'}}>
                    <div className="stat-row" style={{marginBottom:8}}>
                      <div className="stat-box"><div className="stat-num" style={{color:'var(--accent)'}}>{f.scenes30}</div><div className="stat-lbl">30d</div></div>
                      <div className="stat-box"><div className="stat-num" style={{color:'var(--fg-4)'}}>{f.scenes60}</div><div className="stat-lbl">31-60d</div></div>
                      <div className="stat-box"><div className="stat-num" style={{color:'var(--fg-4)'}}>{f.scenes90}</div><div className="stat-lbl">61-90d</div></div>
                      <div className="stat-box"><div className="stat-num" style={{color:'var(--amber)'}}>{f.forumPosts}</div><div className="stat-lbl">Forum 30d</div></div>
                      <div className="stat-box"><div className="stat-num">{f.noteCount}</div><div className="stat-lbl">Intel 30d</div></div>
                    </div>

                    {/* ── Leadership Feedback Summary ── */}
                    {(() => {
                      const summary = leadershipSummary[f.id];
                      const stColors = { 'Pending Discussion':'var(--accent)', 'Confirmed Hold':'var(--amber)', 'Confirmed Promote':'var(--green)', 'Confirmed Demote':'var(--red)', 'Confirmed Remove':'var(--red)' };
                      const stBgs   = { 'Pending Discussion':'rgba(99,102,241,0.12)', 'Confirmed Hold':'rgba(251,191,36,0.12)', 'Confirmed Promote':'rgba(74,222,128,0.12)', 'Confirmed Demote':'rgba(248,113,113,0.12)', 'Confirmed Remove':'rgba(248,113,113,0.18)' };
                      return (
                        <div style={{borderRadius:10, background:'var(--bg-2)', border:'1px solid var(--border)', overflow:'hidden'}}>
                          <div style={{padding:'8px 14px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                            <div style={{fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', color:'var(--fg-4)', fontFamily:'var(--font-mono)'}}>FM Leadership Notes</div>
                            {summary && (() => {
                              const tally = {};
                              summary.notes.forEach(n => { if (n.status) tally[n.status] = (tally[n.status]||0)+1; });
                              const entries = Object.entries(tally);
                              const pendingCount = summary.pending.length;
                              if (entries.length === 0 && pendingCount === 0) return null;
                              return (
                                <div style={{display:'flex', gap:4, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end'}}>
                                  {entries.map(([st, count]) => (
                                    <span key={st} style={{fontSize:9, fontWeight:700, padding:'1px 7px', borderRadius:4, background:stBgs[st]||'var(--bg-3)', color:stColors[st]||'var(--fg-3)'}}>
                                      {displayStatus(st)} ×{count}
                                    </span>
                                  ))}
                                  {pendingCount > 0 && <span style={{fontSize:9, color:'var(--fg-4)', fontStyle:'italic'}}>{pendingCount} pending</span>}
                                </div>
                              );
                            })()}
                          </div>
                          {!summary && <div style={{padding:'10px 14px', fontSize:11, color:'var(--fg-4)', fontStyle:'italic'}}>Loading…</div>}
                          {summary && (
                            <div style={{display:'flex', flexDirection:'column'}}>
                              {summary.notes.map(n => (
                                <div key={n.id} style={{padding:'10px 14px', borderBottom:'1px solid var(--border)', display:'flex', flexDirection:'column', gap:4}}>
                                  <div style={{display:'flex', alignItems:'center', gap:8}}>
                                    <span style={{fontSize:11, fontWeight:700, color:'var(--fg-1)'}}>{n.author_name}</span>
                                    {n.status && <span style={{fontSize:9, fontWeight:700, padding:'1px 7px', borderRadius:4, background:stBgs[n.status]||'var(--bg-3)', color:stColors[n.status]||'var(--fg-3)'}}>{displayStatus(n.status)}</span>}
                                  </div>
                                  <div style={{fontSize:12, color:'var(--fg-2)', lineHeight:1.55, whiteSpace:'pre-wrap'}}>{n.note}</div>
                                </div>
                              ))}
                              {summary.pending.map(l => (
                                <div key={l.discord_id} style={{padding:'6px 14px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:5}}>
                                  <span style={{fontSize:10, color:'var(--fg-4)', fontStyle:'italic'}}>Pending: {l.display_name}</span>
                                </div>
                              ))}
                              {summary.notes.length === 0 && summary.pending.length === 0 && (
                                <div style={{padding:'10px 14px', fontSize:11, color:'var(--fg-4)', fontStyle:'italic'}}>No leadership feedback yet.</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {/* ── Team Lead Review ── */}
                    <div style={{borderRadius:10, background:'var(--bg-2)', border:'1px solid var(--border)', overflow:'hidden'}}>
                      <div style={{padding:'8px 14px', borderBottom:'1px solid var(--border)', fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', color:'var(--fg-4)', fontFamily:'var(--font-mono)'}}>
                        Team Lead Review{!canReview && <span style={{fontWeight:400, textTransform:'none', letterSpacing:0, color:'var(--fg-4)', marginLeft:6}}>· read-only ({f.teamName || 'another team'})</span>}
                      </div>
                      <div style={{padding:'12px 14px', display:'flex', flexDirection:'column', gap:12}}>
                        <div>
                          <div style={s.label}>Recommendation</div>
                          {canReview ? (
                            <div className="flex gap-2">
                              {['Promote','Hold','Demote','Remove'].map(r => (
                                <button key={r} onClick={() => setReviewForm({...reviewForm, [f.id]: {...form, recommendation: r}})} className="px-3 py-1.5 rounded text-[11px] font-bold" style={{background: form.recommendation===r?(r==='Promote'?'var(--green)':r==='Hold'?'var(--amber)':'var(--red)'):'var(--bg-3)', color: form.recommendation===r?'white':'var(--fg-3)', border:'1px solid var(--border)', cursor:'pointer'}}>{r}</button>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm font-bold" style={{color: form.recommendation ? recCol(form.recommendation) : 'var(--fg-4)'}}>{form.recommendation || 'No recommendation yet'}</div>
                          )}
                        </div>
                        <div>
                          <div style={s.label}>Feedback</div>
                          {canReview ? (
                            <textarea rows="5" style={{...s.input, minHeight:120, fontFamily:'inherit'}} value={form.feedback} onChange={e => setReviewForm({...reviewForm, [f.id]: {...form, feedback: e.target.value}})} placeholder="Detailed feedback for the faction..." />
                          ) : (
                            <div className="text-sm whitespace-pre-wrap" style={{color: form.feedback ? 'var(--fg-2)' : 'var(--fg-4)', lineHeight:1.55}}>{form.feedback || 'No feedback recorded yet.'}</div>
                          )}
                        </div>
                        <div className="flex justify-between items-center gap-2 flex-wrap">
                          <button onClick={async () => {
                            const [h, ln] = await Promise.all([getReviewHistory(f.id), auth.level >= 3 ? getAllLeadershipNotes(f.id) : Promise.resolve([])]);
                            setReviewHistory(h); setLeadershipNoteHistory(ln || []); setReviewHistoryView(f);
                          }} style={s.btnGhost}>History</button>
                          <div className="flex gap-2 items-center">
                            {hasReview && <span className="text-[10px]" style={{color:'var(--fg-4)'}}>Last saved: {f.currentReview.updated_at?.substring(0,16)}</span>}
                            {canReview && <button style={s.btn} onClick={async () => {
                              if (!form.recommendation) return showAlert('Please select a recommendation.');
                              if (!form.feedback.trim()) return showAlert('Please provide feedback.');
                              if (hasReview) {
                                await editReview(f.currentReview.id, { recommendation: form.recommendation, feedback: form.feedback });
                              } else {
                                await submitReview({ factionId: f.id, factionName: f.name, recommendation: form.recommendation, feedback: form.feedback });
                              }
                              setReviewData(await getReviewData());
                              // Saved — drop the local draft so the field tracks the server value.
                              setReviewForm(prev => { const n = { ...prev }; delete n[f.id]; return n; });
                            }}>{hasReview ? 'Save Changes' : 'Submit Review'}</button>}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Send Feedback to Faction (own-team factions / L3 only) ── */}
                    {(() => {
                      if (!canReview) return null;
                      const msg = feedbackMsg[f.id] || '';
                      const generating = aiGenerating === f.id;
                      const sending = feedbackSending === f.id;
                      const result = feedbackResult[f.id];
                      const adjusting = aiAdjusting === f.id;
                      const isAdjustOpen = adjustOpen === f.id;
                      const adjInstruction = adjustInstruction[f.id] || '';
                      return (
                        <div style={{borderRadius:10, background:'rgba(74,222,128,0.04)', border:'1px solid rgba(74,222,128,0.2)', overflow:'hidden'}}>
                          <div style={{padding:'8px 14px', borderBottom:'1px solid rgba(74,222,128,0.15)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                            <div style={{fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', color:'var(--green)', fontFamily:'var(--font-mono)'}}>
                              Send Feedback to Faction
                            </div>
                            <div style={{display:'flex', gap:6}}>
                              {msg.trim() && (
                                <button
                                  disabled={adjusting || generating}
                                  style={{fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:6, cursor:(adjusting||generating)?'not-allowed':'pointer', opacity:(adjusting||generating)?0.6:1, background:isAdjustOpen?'rgba(251,191,36,0.2)':'rgba(251,191,36,0.1)', color:'var(--amber)', border:`1px solid ${isAdjustOpen?'rgba(251,191,36,0.5)':'rgba(251,191,36,0.25)'}`}}
                                  onClick={() => { setAdjustOpen(isAdjustOpen ? null : f.id); }}>
                                  Adjust with AI
                                </button>
                              )}
                              <button
                                disabled={generating || adjusting}
                                style={{fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:6, cursor:(generating||adjusting)?'not-allowed':'pointer', opacity:(generating||adjusting)?0.6:1, background:'rgba(160,126,245,0.12)', color:'var(--accent)', border:'1px solid rgba(160,126,245,0.3)'}}
                                onClick={async () => {
                                  setAiGenerating(f.id);
                                  setFeedbackResult(prev => ({...prev, [f.id]: null}));
                                  const res = await generateFeedbackDraft(f.id);
                                  setAiGenerating(null);
                                  if (res.ok) {
                                    setFeedbackMsg(prev => ({...prev, [f.id]: res.draft}));
                                    setAdjustOpen(null);
                                  } else {
                                    setFeedbackResult(prev => ({...prev, [f.id]: { ok: false, error: res.error }}));
                                  }
                                }}>
                                {generating ? 'Drafting…' : '✨ Draft with AI'}
                              </button>
                            </div>
                          </div>
                          {isAdjustOpen && (
                            <div style={{padding:'8px 14px', borderBottom:'1px solid rgba(74,222,128,0.15)', display:'flex', gap:6, alignItems:'center', background:'rgba(251,191,36,0.04)'}}>
                              <input
                                autoFocus
                                type="text"
                                placeholder="e.g. make it shorter, be more stern about the thread issue…"
                                value={adjInstruction}
                                onChange={e => setAdjustInstruction(prev => ({...prev, [f.id]: e.target.value}))}
                                onKeyDown={async e => {
                                  if (e.key !== 'Enter' || !adjInstruction.trim() || adjusting) return;
                                  setAiAdjusting(f.id);
                                  setFeedbackResult(prev => ({...prev, [f.id]: null}));
                                  const res = await adjustFeedbackDraft(f.id, msg, adjInstruction);
                                  setAiAdjusting(null);
                                  if (res.ok) { setFeedbackMsg(prev => ({...prev, [f.id]: res.draft})); setAdjustInstruction(prev => ({...prev, [f.id]: ''})); setAdjustOpen(null); }
                                  else setFeedbackResult(prev => ({...prev, [f.id]: { ok: false, error: res.error }}));
                                }}
                                style={{...s.input, flex:1, fontSize:11, padding:'4px 8px'}}
                              />
                              <button
                                disabled={!adjInstruction.trim() || adjusting}
                                style={{fontSize:10, fontWeight:700, padding:'4px 12px', borderRadius:6, cursor:(!adjInstruction.trim()||adjusting)?'not-allowed':'pointer', opacity:(!adjInstruction.trim()||adjusting)?0.5:1, background:'rgba(251,191,36,0.15)', color:'var(--amber)', border:'1px solid rgba(251,191,36,0.3)', whiteSpace:'nowrap'}}
                                onClick={async () => {
                                  if (!adjInstruction.trim() || adjusting) return;
                                  setAiAdjusting(f.id);
                                  setFeedbackResult(prev => ({...prev, [f.id]: null}));
                                  const res = await adjustFeedbackDraft(f.id, msg, adjInstruction);
                                  setAiAdjusting(null);
                                  if (res.ok) { setFeedbackMsg(prev => ({...prev, [f.id]: res.draft})); setAdjustInstruction(prev => ({...prev, [f.id]: ''})); setAdjustOpen(null); }
                                  else setFeedbackResult(prev => ({...prev, [f.id]: { ok: false, error: res.error }}));
                                }}>
                                {adjusting ? 'Adjusting…' : 'Apply'}
                              </button>
                            </div>
                          )}
                          <div style={{padding:'12px 14px', display:'flex', flexDirection:'column', gap:8}}>
                            <textarea
                              rows={6}
                              style={{...s.input, fontSize:12, resize:'vertical', fontFamily:'inherit', lineHeight:1.6}}
                              placeholder="Write or generate a feedback message to send to this faction's leadership channel…"
                              value={msg}
                              onChange={e => setFeedbackMsg(prev => ({...prev, [f.id]: e.target.value}))}
                            />
                            {result && !result.ok && (
                              <div style={{fontSize:11, color:'var(--red)'}}>{result.error}</div>
                            )}
                            {result && result.ok && (
                              <div style={{fontSize:11, color:'var(--green)'}}>{result.manual ? `Marked as sent for ${f.name}. Team lead channel notified.` : `Feedback sent to ${f.name}.`}</div>
                            )}
                            <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
                              <button
                                disabled={sending}
                                style={{fontSize:11, fontWeight:700, padding:'7px 14px', borderRadius:7, cursor:sending?'not-allowed':'pointer', opacity:sending?0.5:1, background:'transparent', color:'var(--fg-3)', border:'1px solid var(--border)'}}
                                onClick={async () => {
                                  const confirmed = await showConfirm(`Mark feedback as manually sent to ${f.name}? This will post the same notification to the team lead channel.`);
                                  if (!confirmed) return;
                                  setFeedbackSending(f.id);
                                  setFeedbackResult(prev => ({...prev, [f.id]: null}));
                                  const res = await markFeedbackSent(f.id);
                                  setFeedbackSending(null);
                                  setFeedbackResult(prev => ({...prev, [f.id]: res ? { ...res, manual: true } : res}));
                                }}>
                                ✓ Mark as Sent
                              </button>
                              <button
                                disabled={!msg.trim() || sending}
                                style={{...s.btn, opacity:(!msg.trim()||sending)?0.5:1, cursor:(!msg.trim()||sending)?'not-allowed':'pointer'}}
                                onClick={async () => {
                                  const confirmed = await showConfirm(`Send this feedback message to ${f.name} via the faction comms channel?`);
                                  if (!confirmed) return;
                                  setFeedbackSending(f.id);
                                  setFeedbackResult(prev => ({...prev, [f.id]: null}));
                                  const res = await sendFeedbackToFaction(f.id, msg);
                                  setFeedbackSending(null);
                                  setFeedbackResult(prev => ({...prev, [f.id]: res}));
                                  if (res.ok) setFeedbackMsg(prev => ({...prev, [f.id]: ''}));
                                }}>
                                {sending ? 'Sending…' : '📨 Send via Comms'}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Personal Leadership Notes (L3 only) ── */}
                    {auth.level >= 3 && (() => {
                      const currentMonth = new Date().toISOString().substring(0, 7);
                      const statuses = ['Pending Discussion','Confirmed Hold','Confirmed Promote','Confirmed Demote','Confirmed Remove'];
                      const stColors = { 'Pending Discussion':'var(--accent)', 'Confirmed Hold':'var(--amber)', 'Confirmed Promote':'var(--green)', 'Confirmed Demote':'var(--red)', 'Confirmed Remove':'var(--red)' };
                      const stBgs   = { 'Pending Discussion':'rgba(99,102,241,0.12)', 'Confirmed Hold':'rgba(251,191,36,0.12)', 'Confirmed Promote':'rgba(74,222,128,0.12)', 'Confirmed Demote':'rgba(248,113,113,0.12)', 'Confirmed Remove':'rgba(248,113,113,0.18)' };
                      const thisMonthNote = (personalNotes[f.id] || []).find(n => n.review_month === currentMonth);
                      const selectedStatus = personalNoteStatus[f.id] || '';
                      return (
                        <div style={{borderRadius:10, background:'rgba(160,126,245,0.05)', border:'1px solid rgba(160,126,245,0.25)', overflow:'hidden'}}>
                          <div style={{padding:'8px 14px', borderBottom:'1px solid rgba(160,126,245,0.15)', fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.14em', color:'var(--accent)', fontFamily:'var(--font-mono)'}}>
                            Your Note — {auth.displayName || auth.name}
                          </div>
                          <div style={{padding:'12px 14px'}}>

                          {thisMonthNote ? (
                            /* Existing note — show with edit */
                            <div style={{borderRadius:8, background:'rgba(160,126,245,0.06)', border:'1px solid rgba(160,126,245,0.15)', overflow:'hidden'}}>
                              {editingNote?.id === thisMonthNote.id ? (
                                <div style={{padding:'10px 12px'}}>
                                  <div style={{display:'flex', gap:4, flexWrap:'wrap', marginBottom:8}}>
                                    {statuses.map(st => (
                                      <button key={st} onClick={() => setEditingNote(prev => ({...prev, status: prev.status===st?'':st}))}
                                        style={{fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:4, cursor:'pointer', border:`1px solid ${editingNote.status===st?(stColors[st]||'var(--border)'):'var(--border)'}`, background:editingNote.status===st?(stBgs[st]||'var(--bg-2)'):'var(--bg-2)', color:editingNote.status===st?(stColors[st]||'var(--fg-3)'):'var(--fg-3)'}}>
                                        {displayStatus(st)}
                                      </button>
                                    ))}
                                  </div>
                                  <textarea rows={3} autoFocus
                                    style={{...s.input, fontSize:12, resize:'vertical', fontFamily:'inherit', lineHeight:1.5, marginBottom:6}}
                                    value={editingNote.note}
                                    onChange={e => setEditingNote(prev => ({...prev, note: e.target.value}))} />
                                  <div style={{display:'flex', gap:6}}>
                                    <button disabled={noteEditSaving} style={{...s.btn, opacity:noteEditSaving?0.5:1}} onClick={async () => {
                                      setNoteEditSaving(true);
                                      await editPersonalNote(thisMonthNote.id, editingNote.note, editingNote.status);
                                      setNoteEditSaving(false);
                                      setEditingNote(null);
                                      await loadFactionNotes(f.id);
                                      setReviewData(await getReviewData());
                                    }}>{noteEditSaving ? 'Saving…' : 'Save'}</button>
                                    <button style={s.btnGhost} onClick={() => setEditingNote(null)}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div style={{padding:'8px 12px'}}>
                                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4}}>
                                    <div style={{display:'flex', alignItems:'center', gap:6}}>
                                      {thisMonthNote.status && <span style={{fontSize:9, fontWeight:700, padding:'1px 7px', borderRadius:4, background:stBgs[thisMonthNote.status]||'var(--bg-2)', color:stColors[thisMonthNote.status]||'var(--fg-3)'}}>{displayStatus(thisMonthNote.status)}</span>}
                                    </div>
                                    <div style={{display:'flex', alignItems:'center', gap:8}}>
                                      <span style={{fontSize:9, color:'var(--fg-4)', fontFamily:'var(--font-mono)'}}>{thisMonthNote.created_at?.substring(0,16)}</span>
                                      <button onClick={() => setEditingNote({id:thisMonthNote.id, note:thisMonthNote.note, status:thisMonthNote.status||''})}
                                        style={{fontSize:9, fontWeight:700, color:'var(--accent)', background:'none', border:'none', cursor:'pointer', padding:'0 4px'}}>Edit</button>
                                    </div>
                                  </div>
                                  <div style={{fontSize:12, color:'var(--fg-2)', lineHeight:1.55, whiteSpace:'pre-wrap'}}>{thisMonthNote.note}</div>
                                </div>
                              )}
                            </div>
                          ) : (
                            /* No note yet — show blank form */
                            <>
                              <div style={{display:'flex', gap:4, flexWrap:'wrap', marginBottom:8}}>
                                {statuses.map(st => (
                                  <button key={st} onClick={() => setPersonalNoteStatus(prev => ({...prev, [f.id]: prev[f.id]===st?'':st}))}
                                    style={{fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:4, cursor:'pointer', border:`1px solid ${selectedStatus===st?(stColors[st]||'var(--border)'):'var(--border)'}`, background:selectedStatus===st?(stBgs[st]||'var(--bg-2)'):'var(--bg-2)', color:selectedStatus===st?(stColors[st]||'var(--fg-3)'):'var(--fg-3)'}}>
                                    {displayStatus(st)}
                                  </button>
                                ))}
                              </div>
                              <textarea rows={3}
                                style={{...s.input, fontSize:12, resize:'vertical', fontFamily:'inherit', lineHeight:1.5}}
                                placeholder={`Your personal observations about ${f.name}...`}
                                value={personalNoteText[f.id] || ''}
                                onChange={e => setPersonalNoteText(prev => ({...prev, [f.id]: e.target.value}))} />
                              <div style={{display:'flex', justifyContent:'flex-end', marginTop:6}}>
                                <button disabled={noteSubmitting===f.id || !(personalNoteText[f.id]||'').trim()}
                                  style={{...s.btn, opacity:(noteSubmitting===f.id||!(personalNoteText[f.id]||'').trim())?0.5:1}}
                                  onClick={async () => {
                                    const note = (personalNoteText[f.id]||'').trim();
                                    if (!note) return;
                                    setNoteSubmitting(f.id);
                                    await submitPersonalNote(f.id, f.name, note, selectedStatus);
                                    setNoteSubmitting(null);
                                    setPersonalNoteText(prev => ({...prev, [f.id]:''}));
                                    setPersonalNoteStatus(prev => ({...prev, [f.id]:''}));
                                    await loadFactionNotes(f.id);
                                    setReviewData(await getReviewData());
                                  }}>
                                  {noteSubmitting===f.id ? 'Submitting…' : 'Add Note'}
                                </button>
                              </div>
                            </>
                          )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
          {reviewData.length === 0 && <div className="text-center py-10 text-sm" style={{color:'var(--fg-4)'}}>No factions accessible.</div>}
        </div>
      )}

      {reviewHistoryView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{background:'rgba(0,0,0,0.6)'}} onClick={() => setReviewHistoryView(null)}>
          <div className="w-full max-w-2xl max-h-[80vh] rounded-xl overflow-hidden flex flex-col" style={{background:'var(--bg-0)',border:'1px solid var(--border)'}} onClick={e => e.stopPropagation()}>
            <div className="p-5 flex justify-between" style={{borderBottom:'1px solid var(--border)'}}>
              <h3 className="font-bold">Review History: {reviewHistoryView.name}</h3>
              <button onClick={() => setReviewHistoryView(null)} style={{background:'none',border:'none',color:'var(--fg-4)',cursor:'pointer',fontSize:18}}>✕</button>
            </div>
            <div className="flex-1 overflow-y-auto scr p-5 space-y-6">
              {reviewHistory.length === 0 && leadershipNoteHistory.length === 0 && (
                <div className="text-sm" style={{color:'var(--fg-4)'}}>No previous reviews or notes.</div>
              )}

              {/* Official reviews by month */}
              {reviewHistory.length > 0 && reviewHistory.map(r => {
                const monthNotes = leadershipNoteHistory.filter(n => n.review_month === r.review_month);
                return (
                  <div key={r.id}>
                    {/* Month header */}
                    <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.16em',color:'var(--fg-4)',fontFamily:'var(--font-mono)',marginBottom:8}}>{r.review_month}</div>
                    {/* Official review */}
                    <div className="rounded p-3 mb-3" style={{background:'var(--bg-1)',border:'1px solid var(--border)'}}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[11px] font-bold" style={{color:'var(--fg-3)'}}>Team Lead Review — {r.reviewer_name}</span>
                        <div className="flex gap-1">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{background: r.recommendation==='Promote'?'var(--green-bg)':r.recommendation==='Demote'||r.recommendation==='Remove'?'var(--red-bg)':'var(--amber-bg)', color: r.recommendation==='Promote'?'var(--green)':r.recommendation==='Demote'||r.recommendation==='Remove'?'var(--red)':'var(--amber)'}}>{r.recommendation}</span>
                          {r.status && <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{background:'var(--bg-2)',color:'var(--fg-4)'}}>{displayStatus(r.status)}</span>}
                        </div>
                      </div>
                      <div className="text-[10px] mb-2" style={{color:'var(--fg-4)'}}>{r.created_at?.substring(0,16)}</div>
                      <div className="text-sm whitespace-pre-wrap" style={{color:'var(--fg-2)'}}>{r.feedback}</div>
                    </div>
                    {/* Leadership personal notes for this month */}
                    {monthNotes.length > 0 && monthNotes.map(n => (
                      <div key={n.id} className="rounded p-3 mb-2" style={{background:'rgba(160,126,245,0.06)',border:'1px solid rgba(160,126,245,0.18)'}}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[11px] font-bold" style={{color:'var(--accent)'}}>From {n.author_name}</span>
                          <span className="text-[10px]" style={{color:'var(--fg-4)',fontFamily:'var(--font-mono)'}}>{n.created_at?.substring(0,16)}</span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap" style={{color:'var(--fg-2)'}}>{n.note}</div>
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Leadership notes with no matching official review */}
              {leadershipNoteHistory.filter(n => !reviewHistory.find(r => r.review_month === n.review_month)).length > 0 && (
                Object.entries(
                  leadershipNoteHistory
                    .filter(n => !reviewHistory.find(r => r.review_month === n.review_month))
                    .reduce((acc, n) => { (acc[n.review_month] = acc[n.review_month] || []).push(n); return acc; }, {})
                ).sort(([a],[b]) => b.localeCompare(a)).map(([month, notes]) => (
                  <div key={month}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.16em',color:'var(--fg-4)',fontFamily:'var(--font-mono)',marginBottom:8}}>{month}</div>
                    {notes.map(n => (
                      <div key={n.id} className="rounded p-3 mb-2" style={{background:'rgba(160,126,245,0.06)',border:'1px solid rgba(160,126,245,0.18)'}}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[11px] font-bold" style={{color:'var(--accent)'}}>From {n.author_name}</span>
                          <span className="text-[10px]" style={{color:'var(--fg-4)',fontFamily:'var(--font-mono)'}}>{n.created_at?.substring(0,16)}</span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap" style={{color:'var(--fg-2)'}}>{n.note}</div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </LeadershipShell>
  );
}
