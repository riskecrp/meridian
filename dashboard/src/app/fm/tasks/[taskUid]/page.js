"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getTaskByUid, getTaskQuestions, answerTaskQuestion } from "../../dashboard/actions";

export default function TaskQAPage() {
  const auth = useAuth();
  const params = useParams();
  const taskUid = params?.taskUid;
  const { showAlert } = useDialog();
  const [task, setTask] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState({}); // questionId -> draft text
  const [submittingId, setSubmittingId] = useState(null);
  const [err, setErr] = useState('');

  const refresh = async () => {
    if (!taskUid) return;
    const [t, qs] = await Promise.all([getTaskByUid(taskUid), getTaskQuestions(taskUid)]);
    setTask(t); setQuestions(qs); setLoading(false);
  };

  useEffect(() => {
    if (auth.loading) return;
    refresh();
  }, [auth.loading, taskUid]);

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (!task) return <div className="p-10 text-sm" style={{color:'var(--red)'}}>Task not found.</div>;

  const isCreator = task.created_by_id === auth.id;
  const unanswered = questions.filter(q => !q.answer);
  const answered = questions.filter(q => q.answer);

  const submitAnswer = async (qid) => {
    setErr('');
    const text = (answers[qid] || '').trim();
    if (!text) { setErr('Answer cannot be empty.'); return; }
    setSubmittingId(qid);
    const res = await answerTaskQuestion(qid, text);
    setSubmittingId(null);
    if (!res.ok) { setErr(res.error || 'Failed'); return; }
    setAnswers(prev => { const n = {...prev}; delete n[qid]; return n; });
    await refresh();
  };

  return (
    <div className="w-full max-w-3xl mx-auto p-6 lg:p-10 space-y-6">
      <div className="pb-4" style={{borderBottom:'1px solid var(--border)'}}>
        <Link href="/fm/dashboard" className="text-[11px] uppercase tracking-widest" style={{color:'var(--fg-4)'}}>← Back to Dashboard</Link>
        <h1 className="text-2xl font-black tracking-tighter italic uppercase mt-1">Task Q&amp;A</h1>
      </div>

      {/* Task summary */}
      <div className="rounded-xl p-5" style={{background:'var(--bg-1)', border:'1px solid var(--border)'}}>
        <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{color:'var(--fg-4)'}}>Task</div>
        <p className="text-sm whitespace-pre-wrap" style={{color:'var(--fg-1)'}}>{task.description}</p>
        {task.created_by_id === 'promotion-bot' && (() => {
          const factionName = task.description.split(' — ')[0].trim();
          return (
            <div className="mt-3">
              <Link
                href={`/fm/factions/promote?name=${encodeURIComponent(factionName)}`}
                style={{display:'inline-flex',alignItems:'center',gap:6,background:'var(--accent)',color:'white',border:'none',padding:'8px 16px',borderRadius:8,fontSize:11,fontWeight:800,textDecoration:'none',textTransform:'uppercase',letterSpacing:'0.1em'}}
              >
                Stage Promotion →
              </Link>
            </div>
          );
        })()}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-3" style={{borderTop:'1px solid var(--border)'}}>
          <div><div className="text-[9px] font-bold uppercase" style={{color:'var(--fg-4)'}}>Created By</div><div className="text-xs" style={{color:'var(--fg-2)'}}>{task.created_by_name}</div></div>
          <div><div className="text-[9px] font-bold uppercase" style={{color:'var(--fg-4)'}}>Target</div><div className="text-xs" style={{color:'var(--fg-2)'}}>{task.target_type}: {task.targetLabel}</div></div>
          <div><div className="text-[9px] font-bold uppercase" style={{color:'var(--fg-4)'}}>Status</div><div className="text-xs" style={{color: task.claimed_by === 'None' ? 'var(--amber)' : 'var(--green)'}}>{task.claimed_by === 'None' ? 'Unclaimed' : 'Claimed by ' + task.claimerName}</div></div>
          <div><div className="text-[9px] font-bold uppercase" style={{color:'var(--fg-4)'}}>Created</div><div className="text-xs font-mono" style={{color:'var(--fg-3)'}}>{task.created_at}</div></div>
        </div>
      </div>

      {/* Unanswered questions */}
      {unanswered.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{color:'var(--amber)'}}>Open Questions ({unanswered.length})</div>
          <div className="space-y-3">
            {unanswered.map(q => (
              <div key={q.id} className="rounded-xl p-4" style={{background:'var(--bg-1)', border:'1px solid var(--amber)'}}>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-bold" style={{color:'var(--amber)'}}>{q.asked_by_name}</span>
                  <span className="text-[10px] font-mono" style={{color:'var(--fg-4)'}}>{new Date(q.asked_at).toLocaleString()}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap mb-3" style={{color:'var(--fg-1)'}}>{q.question}</p>
                {isCreator ? (
                  <div className="space-y-2">
                    <textarea
                      value={answers[q.id] || ''}
                      onChange={e => setAnswers({...answers, [q.id]: e.target.value})}
                      placeholder="Your answer..."
                      rows={3}
                      style={{width:'100%', background:'var(--bg-2)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--fg-0)', resize:'vertical'}}
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={() => submitAnswer(q.id)}
                        disabled={submittingId === q.id || !(answers[q.id] || '').trim()}
                        style={{background:'var(--accent)', color:'white', border:'none', padding:'8px 16px', borderRadius:8, fontSize:11, fontWeight:800, cursor: submittingId === q.id ? 'wait' : 'pointer', textTransform:'uppercase', letterSpacing:'0.08em', opacity: (submittingId === q.id || !(answers[q.id] || '').trim()) ? 0.6 : 1}}>
                        {submittingId === q.id ? 'Sending...' : 'Send Answer'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] italic" style={{color:'var(--fg-4)'}}>Waiting for the task creator to respond.</div>
                )}
              </div>
            ))}
          </div>
          {err && <div className="text-xs mt-2" style={{color:'var(--red)'}}>{err}</div>}
        </div>
      )}

      {/* Answered Q&A history */}
      {answered.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{color:'var(--fg-4)'}}>Answered ({answered.length})</div>
          <div className="space-y-3">
            {answered.map(q => (
              <div key={q.id} className="rounded-xl overflow-hidden" style={{background:'var(--bg-1)', border:'1px solid var(--border)'}}>
                <div className="p-4" style={{borderBottom:'1px solid var(--border)'}}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold" style={{color:'var(--fg-3)'}}>❓ {q.asked_by_name}</span>
                    <span className="text-[10px] font-mono" style={{color:'var(--fg-4)'}}>{new Date(q.asked_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap" style={{color:'var(--fg-1)'}}>{q.question}</p>
                </div>
                <div className="p-4" style={{background:'var(--bg-2)'}}>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-bold" style={{color:'var(--accent)'}}>💬 {q.answered_by_name}</span>
                    <span className="text-[10px] font-mono" style={{color:'var(--fg-4)'}}>{new Date(q.answered_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap" style={{color:'var(--fg-1)'}}>{q.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {questions.length === 0 && (
        <div className="text-center py-10 text-sm italic" style={{color:'var(--fg-4)'}}>No questions on this task yet.</div>
      )}
    </div>
  );
}
