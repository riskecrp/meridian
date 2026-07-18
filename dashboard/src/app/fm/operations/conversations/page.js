"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { getConversationStats, generateConversationSummary, getMemberSuggestions, getAvailableChannels } from "../actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

export default function ConversationsPage() {
  const auth = useAuth();

  const [convoFromDate, setConvoFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().substring(0, 10); });
  const [convoToDate, setConvoToDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [convoMember, setConvoMember] = useState('');
  const [convoMemberSuggestions, setConvoMemberSuggestions] = useState([]);
  const [convoStats, setConvoStats] = useState(null);
  const [convoSummary, setConvoSummary] = useState(null);
  const [convoLoading, setConvoLoading] = useState(false);
  const [convoChannel, setConvoChannel] = useState('');
  const [convoAvailableChannels, setConvoAvailableChannels] = useState([]);

  useEffect(() => {
    if (auth.loading || auth.level < 3) return;
    if (convoAvailableChannels.length === 0) {
      getAvailableChannels().then(setConvoAvailableChannels);
    }
  }, [auth.loading, auth.level]);

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{color:'var(--accent)'}}>Loading...</div>;
  if (auth.level < 3) return <div className="p-10" style={{color:'var(--red)'}}>Access denied.</div>;

  return (
    <OperationsShell title="Conversations" docs={[{"title": "Operations — Conversations Tab", "label": "Conversations Guide", "minLevel": 3}]} authLevel={auth?.level || 3}>
      <div className="space-y-4">
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px] relative">
              <div style={st.label}>Member (optional)</div>
              <input style={st.input} value={convoMember} onChange={async e => {
                const v = e.target.value; setConvoMember(v);
                if (v.length >= 1) { const s = await getMemberSuggestions(v); setConvoMemberSuggestions(s); } else { setConvoMemberSuggestions([]); }
              }} placeholder="Search by member name..." />
              {convoMemberSuggestions.length > 0 && convoMember && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded max-h-[200px] overflow-y-auto z-50" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                  {convoMemberSuggestions.map(s => (
                    <div key={s.author_id} className="px-3 py-2 cursor-pointer hover:bg-[var(--bg-3)] text-sm" onClick={() => { setConvoMember(s.author_name); setConvoMemberSuggestions([]); }}>
                      {s.author_name} <span className="text-[10px]" style={{ color: 'var(--fg-4)' }}>{s.c} msgs</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ minWidth: 180 }}>
              <div style={st.label}>Channel</div>
              <select style={st.input} value={convoChannel} onChange={e => setConvoChannel(e.target.value)}>
                <option value="">All Channels</option>
                {convoAvailableChannels.map(ch => (<option key={ch.channel_id} value={ch.channel_id}>#{ch.channel_name}</option>))}
              </select>
            </div>
            <div><div style={st.label}>From</div><input type="date" style={st.input} value={convoFromDate} onChange={e => setConvoFromDate(e.target.value)} /></div>
            <div><div style={st.label}>To</div><input type="date" style={st.input} value={convoToDate} onChange={e => setConvoToDate(e.target.value)} /></div>
            <div className="flex gap-1">
              {[{ d: 7, l: '7d' }, { d: 30, l: '30d' }, { d: 90, l: '90d' }].map(q => (
                <button key={q.l} style={{ ...st.btnGhost, padding: '6px 10px', fontSize: 10 }} onClick={() => {
                  const to = new Date(); const from = new Date(); from.setDate(from.getDate() - q.d);
                  setConvoFromDate(from.toISOString().substring(0, 10)); setConvoToDate(to.toISOString().substring(0, 10));
                }}>{q.l}</button>
              ))}
            </div>
            <button style={st.btn} disabled={convoLoading} onClick={async () => {
              setConvoLoading(true);
              const stats = await getConversationStats(convoFromDate, convoToDate, convoMember, convoChannel);
              setConvoStats(stats);
              const summary = await generateConversationSummary(convoFromDate, convoToDate, convoMember, convoChannel);
              setConvoSummary(summary);
              setConvoLoading(false);
            }}>{convoLoading ? 'Loading...' : 'Fetch Stats'}</button>
          </div>
        </div>

        {convoStats && (
          <>
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
              <div className="flex justify-between items-center mb-3">
                <div className="text-sm font-bold">Results</div>
                <div className="text-[11px]" style={{ color: 'var(--fg-4)' }}>{convoStats.members.length} member{convoStats.members.length !== 1 ? 's' : ''} · {convoStats.channelsScanned} channels scanned · {convoStats.totalMessages} messages</div>
              </div>
              <div className="rounded overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                <div className="grid grid-cols-12 px-4 py-2 text-[9px] font-bold uppercase" style={{ background: 'var(--bg-2)', color: 'var(--fg-4)' }}>
                  <div className="col-span-5">Member</div>
                  <div className="col-span-2 text-right">Messages ▼</div>
                  <div className="col-span-2 text-right">Open Tasks</div>
                  <div className="col-span-1 text-right">Completed</div>
                  <div className="col-span-2 text-right">Total Activity</div>
                </div>
                {convoStats.members.map(m => (
                  <div key={m.author_id} className="grid grid-cols-12 px-4 py-2 text-[12px]" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="col-span-5 font-bold">{m.author_name}</div>
                    <div className="col-span-2 text-right">{m.message_count}</div>
                    <div className="col-span-2 text-right" style={{ color: m.openTasks > 0 ? 'var(--amber)' : 'var(--fg-4)' }}>{m.openTasks}</div>
                    <div className="col-span-1 text-right" style={{ color: m.completed > 0 ? 'var(--green)' : 'var(--fg-4)' }}>{m.completed}</div>
                    <div className="col-span-2 text-right font-bold">{m.totalActivity}</div>
                  </div>
                ))}
                {convoStats.members.length === 0 && <div className="text-center py-6 text-sm" style={{ color: 'var(--fg-4)' }}>No activity in date range.</div>}
              </div>
            </div>

            <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
              <div className="text-sm font-bold mb-3">Channels ({convoStats.channels.length})</div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {convoStats.channels.map(ch => (
                  <div key={ch.channel_id} className="rounded p-2" style={{ background: 'var(--bg-2)' }}>
                    <div className="font-mono text-[11px]" style={{ color: 'var(--accent)' }}>#{ch.channel_name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--fg-4)' }}>{ch.message_count} msgs · {ch.unique_members} members</div>
                  </div>
                ))}
              </div>
            </div>

            {convoSummary && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <div className="text-sm font-bold mb-3">Team Themes</div>
                  <div className="text-[13px] quill-content" style={{ color: 'var(--fg-2)' }} dangerouslySetInnerHTML={{ __html: convoSummary.teamThemes }} />
                </div>
                <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <div className="text-sm font-bold mb-3">Summary: {convoMember || 'All Members'}</div>
                  {convoMember ? (
                    <div className="text-[13px] quill-content" style={{ color: 'var(--fg-2)' }} dangerouslySetInnerHTML={{ __html: convoSummary.memberSummary || '<em style="color:var(--fg-4)">Select a member to see their individual summary.</em>' }} />
                  ) : (
                    <div className="text-[13px]" style={{ color: 'var(--fg-4)' }}><em>Select a member above to see their individual activity summary.</em></div>
                  )}
                </div>
                <div className="rounded-xl p-4" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
                  <div className="text-sm font-bold mb-3">By Channel</div>
                  <div className="text-[13px] quill-content" style={{ color: 'var(--fg-2)' }} dangerouslySetInnerHTML={{ __html: convoSummary.channelSummaries }} />
                </div>
              </div>
            )}
          </>
        )}

        {!convoStats && !convoLoading && (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--fg-4)' }}>
            Set a date range and click <strong>Fetch Stats</strong> to load conversation data and AI summaries.
          </div>
        )}
      </div>
    </OperationsShell>
  );
}
