"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import {
  getMyMentions, markMentionRead, markAllMentionsRead, replyToMention,
  getLeadershipMentions, markLeadershipMentionRead, markAllLeadershipMentionsRead, replyToLeadershipMention,
  getTeamWatchPings, markWatchPingRead, markAllWatchPingsRead, replyToWatchPing,
  getDMTrackingStatus, toggleDMTracking, getForwardedDMs, markDMRead, markAllDMsRead, deleteDM,
  createMyTask, getStaffForCreate, getRoleTargetsForCreate,
} from "../../fm/dashboard/actions.js";

const clean = (s) => (s || "").replace(/<@[!&]?[0-9]+>/g, "@…");
const when = (t) => (t ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

// per-kind config: label, color, and action dispatch
const KIND = {
  mention:    { label: "Mention",     color: "var(--accent)", reply: replyToMention, read: markMentionRead },
  leadership: { label: "Leadership",  color: "var(--lock)",   reply: replyToLeadershipMention, read: markLeadershipMentionRead },
  watch:      { label: "Watch ping",  color: "var(--good)",   reply: replyToWatchPing, read: markWatchPingRead },
  dm:         { label: "DM",          color: "var(--sky)",    reply: null, read: markDMRead },
};

export default function V2Inbox() {
  const auth = useAuth();
  const level = auth?.level || 0;
  const isL3 = level >= 3;

  const [mentions, setMentions] = useState([]);
  const [leadership, setLeadership] = useState([]);
  const [watch, setWatch] = useState([]);
  const [dms, setDms] = useState([]);
  const [dmOn, setDmOn] = useState(false);
  const [staff, setStaff] = useState([]);
  const [roles, setRoles] = useState({ teams: [] });
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(true);

  const [replyTo, setReplyTo] = useState(null); // uid
  const [replyText, setReplyText] = useState("");
  const [taskFor, setTaskFor] = useState(null); // uid
  const [taskDesc, setTaskDesc] = useState("");
  const [taskTarget, setTaskTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    const [m, w, dt] = await Promise.all([
      getMyMentions().catch(() => []),
      getTeamWatchPings().catch(() => []),
      getDMTrackingStatus().catch(() => ({ enabled: false })),
    ]);
    setMentions(m || []); setWatch(w || []);
    setDmOn(!!dt.enabled);
    setDms(dt.enabled ? (await getForwardedDMs().catch(() => [])) : []);
    if (isL3) setLeadership(await getLeadershipMentions().catch(() => []));
    setLoading(false);
  };
  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    load();
    getStaffForCreate().then(setStaff).catch(() => {});
    getRoleTargetsForCreate().then(setRoles).catch(() => {});
  }, [auth?.id, auth?.loading]);

  // Normalize every stream into one shape.
  const items = useMemo(() => {
    const out = [];
    mentions.forEach(m => out.push({ kind: "mention", uid: `m-${m.id}`, id: m.id, author: m.author_name, content: m.content, ts: m.created_at, is_read: m.is_read, channel: m.channel_name, server: m.guild_name, guild_id: m.guild_id, channel_id: m.channel_id, message_id: m.message_id }));
    leadership.forEach(m => out.push({ kind: "leadership", uid: `L-${m.id}`, id: m.id, author: m.author_name, content: m.content, ts: m.created_at, is_read: m.is_read, channel: m.channel_name, server: m.guild_name, guild_id: m.guild_id, channel_id: m.channel_id, message_id: m.message_id }));
    watch.forEach(p => out.push({ kind: "watch", uid: `w-${p.id}`, id: p.id, author: p.author_name, content: p.content, ts: p.created_at, is_read: p.is_read, channel: p.channel_name, server: p.server_name || p.guild_name, faction: p.faction_name, role: p.watch_role_name, guild_id: p.guild_id, channel_id: p.channel_id, message_id: p.message_id }));
    dms.forEach(d => out.push({ kind: "dm", uid: `d-${d.id}`, id: d.id, author: d.author_name, content: d.content, ts: d.forwarded_at, is_read: d.is_read, dmChannel: d.source_channel_id, dmMsg: d.source_message_id }));
    return out.sort((a, b) => (a.is_read - b.is_read) || (new Date(b.ts) - new Date(a.ts)));
  }, [mentions, leadership, watch, dms]);

  const unread = (arr) => arr.filter(x => !x.is_read).length;
  const counts = { mention: unread(mentions), leadership: unread(leadership), watch: unread(watch), dm: unread(dms) };
  const TABS = [
    { id: "all", label: "All", n: counts.mention + counts.leadership + counts.watch + counts.dm },
    { id: "mention", label: "Mentions", n: counts.mention },
    ...(isL3 ? [{ id: "leadership", label: "Leadership", n: counts.leadership }] : []),
    { id: "watch", label: "Server pings", n: counts.watch },
    { id: "dm", label: "Forwarded DMs", n: counts.dm },
  ];
  const shown = tab === "all" ? items : items.filter(i => i.kind === tab);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  const closeAll = () => { setReplyTo(null); setReplyText(""); setTaskFor(null); setTaskDesc(""); setTaskTarget(""); setErr(""); };
  const doReply = async (it) => {
    if (!replyText.trim()) return;
    setBusy(true); setErr("");
    const r = await KIND[it.kind].reply(it.id, replyText).catch(() => ({ ok: false }));
    setBusy(false);
    if (r?.ok) { closeAll(); load(); } else setErr(r?.error || "Failed to send.");
  };
  const doRead = async (it) => { await KIND[it.kind].read(it.id); load(); };
  const doDeleteDM = async (it) => { await deleteDM(it.id); load(); };
  const doTask = async () => {
    if (!taskTarget || !taskDesc.trim()) return;
    setBusy(true);
    const [type, ...rest] = taskTarget.split(":");
    await createMyTask({ desc: taskDesc.trim(), targetType: type, targetId: rest.join(":"), enableDM: false });
    setBusy(false); closeAll();
  };
  const markAllVisible = async () => {
    const kinds = tab === "all" ? ["mention", "leadership", "watch", "dm"] : [tab];
    if (kinds.includes("mention")) await markAllMentionsRead();
    if (kinds.includes("leadership") && isL3) await markAllLeadershipMentionsRead();
    if (kinds.includes("watch")) await markAllWatchPingsRead();
    if (kinds.includes("dm") && dmOn) await markAllDMsRead();
    load();
  };

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">Inbox</p>
          <h1>Everything that pinged you</h1>
          <div className="sub">Mentions, {isL3 ? "leadership pings, " : ""}server-role pings and forwarded DMs, in one place.</div>
        </div>
        {shown.some(i => !i.is_read) && <button className="btn ghost" onClick={markAllVisible}>Mark all read</button>}
      </div>

      <div className="hub-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`hub-tab${tab === t.id ? " on" : ""}`} onClick={() => { setTab(t.id); closeAll(); }}>
            {t.label}{t.n > 0 && <span className="chip" style={{ background: "var(--rose-bg)", color: "var(--rose)" }}>{t.n}</span>}
          </button>
        ))}
      </div>

      {tab === "dm" && !dmOn && (
        <div className="card">
          <div style={{ padding: "6px 0", fontSize: 13, color: "var(--ink-1)" }}>
            Forward any Discord DM to the <b>Meridian Database bot</b> and it appears here — with a link back and a “make task” button.
            <div style={{ marginTop: 10 }}><button className="btn" onClick={() => toggleDMTracking(true).then(load)}>Enable DM forwarding</button></div>
          </div>
        </div>
      )}

      {shown.length === 0 ? <div className="empty">Nothing here.</div> : (
        <div className="card">
          {shown.map(it => {
            const k = KIND[it.kind];
            const appLink = it.kind === "dm" ? null : `discord://-/channels/${it.guild_id}/${it.channel_id}/${it.message_id}`;
            const webLink = it.kind === "dm"
              ? `https://discord.com/channels/@me/${it.dmChannel}${it.dmMsg ? "/" + it.dmMsg : ""}`
              : `https://discord.com/channels/${it.guild_id}/${it.channel_id}/${it.message_id}`;
            return (
              <div key={it.uid} style={{ borderBottom: "1px solid var(--line)", padding: "12px 2px", background: it.is_read ? "transparent" : "var(--accent-bg)", borderRadius: it.is_read ? 0 : 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                  {!it.is_read && <span style={{ width: 6, height: 6, borderRadius: "50%", background: k.color, flexShrink: 0 }} />}
                  <span className="chip" style={{ background: "color-mix(in srgb, " + k.color + " 15%, transparent)", color: k.color }}>{k.label}</span>
                  <span style={{ fontWeight: 700, color: "var(--ink-0)", fontSize: 13 }}>{it.author}</span>
                  {it.role && <span className="chip" style={{ background: "var(--good-bg)", color: "var(--good)" }}>@{it.role}</span>}
                  {it.channel && <span style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--ink-2)" }}>#{it.channel}</span>}
                  {it.server && <span className="chip role">{it.server}</span>}
                  {it.faction && it.faction !== it.server && <span className="chip" style={{ background: "var(--accent-bg)", color: "var(--accent)" }}>{it.faction}</span>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>{when(it.ts)}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-1)", lineHeight: 1.5, marginBottom: 8, wordBreak: "break-word" }}>{clean(it.content)}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {k.reply && <button className="act" onClick={() => { closeAll(); setReplyTo(it.uid); }}>↩ Reply</button>}
                  <button className="act" onClick={() => { closeAll(); setTaskFor(it.uid); setTaskDesc(clean(it.content).slice(0, 200)); }}>＋ Task</button>
                  {appLink && <a className="act" href={appLink} target="_blank" rel="noreferrer">Open app</a>}
                  <a className="act" href={webLink} target="_blank" rel="noreferrer">{it.kind === "dm" ? "Open DM" : "Web"}</a>
                  {!it.is_read && <button className="act" onClick={() => doRead(it)}>✓ Read</button>}
                  {it.kind === "dm" && <button className="act" style={{ color: "var(--rose)", marginLeft: "auto" }} onClick={() => doDeleteDM(it)}>Delete</button>}
                </div>

                {replyTo === it.uid && (
                  <div className="inline-form" style={{ marginTop: 10 }}>
                    <div className="lbl">Reply to {it.author} in #{it.channel} — sends as the bot, attributed to you</div>
                    <textarea className="filter-inp" rows={3} autoFocus value={replyText} onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doReply(it); if (e.key === "Escape") closeAll(); }} />
                    {err && <div className="err">{err}</div>}
                    <div className="row-btns"><button className="act primary" disabled={busy || !replyText.trim()} onClick={() => doReply(it)}>{busy ? "Sending…" : "Send reply"}</button><button className="act" onClick={closeAll}>Cancel</button></div>
                  </div>
                )}
                {taskFor === it.uid && (
                  <div className="inline-form" style={{ marginTop: 10 }}>
                    <div className="lbl">Create task from this</div>
                    <textarea className="filter-inp" rows={2} value={taskDesc} onChange={e => setTaskDesc(e.target.value)} />
                    <select className="filter-inp" value={taskTarget} onChange={e => setTaskTarget(e.target.value)}>
                      <option value="">Assign to…</option>
                      <optgroup label="Roles & Teams">
                        {roles.leadershipId && <option value={`Role:${roles.leadershipId}`}>FM Leadership</option>}
                        {roles.leadId && <option value={`Role:${roles.leadId}`}>FM Team Leads</option>}
                        {roles.allFmId && <option value={`Role:${roles.allFmId}`}>All FM</option>}
                        {(roles.teams || []).map(t => <option key={t.team_id} value={`Role:${t.team_id}`}>Team {t.team_name}</option>)}
                      </optgroup>
                      <optgroup label="Staff">{staff.map(s => <option key={s.discord_id} value={`User:${s.discord_id}`}>{s.display_name}</option>)}</optgroup>
                    </select>
                    <div className="row-btns"><button className="act primary" disabled={busy || !taskTarget || !taskDesc.trim()} onClick={doTask}>{busy ? "Creating…" : "Create task"}</button><button className="act" onClick={closeAll}>Cancel</button></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "dm" && dmOn && (
        <div style={{ marginTop: 10 }}>
          <button className="act" style={{ color: "var(--rose)" }} onClick={() => { if (window.confirm("Disable DM forwarding?")) toggleDMTracking(false).then(load); }}>Disable DM forwarding</button>
        </div>
      )}
    </div>
  );
}
