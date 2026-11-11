"use client";
// Everything that pinged you (the v2 Inbox): personal mentions, leadership-role
// mentions (L3), server watch-role pings and forwarded DMs. One hook feeds the
// Home notifications panel and the "mention" rows on Work; the bell polls the
// cheap unread count.
import { useEffect, useMemo, useState } from "react";
import { Modal, Tabs, Button, Badge, Empty, useAction } from "../ui.js";
import {
  getMyMentions, markMentionRead, markAllMentionsRead, replyToMention,
  getLeadershipMentions, markLeadershipMentionRead, markAllLeadershipMentionsRead, replyToLeadershipMention,
  getTeamWatchPings, markWatchPingRead, markAllWatchPingsRead, replyToWatchPing,
  getDMTrackingStatus, toggleDMTracking, getForwardedDMs, markDMRead, markAllDMsRead, deleteDM,
  createMyTask, getInboxUnreadCount,
} from "../../fm/dashboard/actions.js";
import { InlineForm, TargetPicker, parseTarget, usePickerData, cleanMentions, shortWhen } from "./shared.js";

const PAGE_SIZE = 50;
export const KIND = {
  mention:    { label: "Mention",     tone: "accent", reply: replyToMention, read: markMentionRead },
  leadership: { label: "Leadership",  tone: "lock",   reply: replyToLeadershipMention, read: markLeadershipMentionRead },
  watch:      { label: "Server ping", tone: "good",   reply: replyToWatchPing, read: markWatchPingRead },
  dm:         { label: "DM",          tone: "info",   reply: null, read: markDMRead },
};

/** Live unread count: one COUNT query every 3 minutes and on tab focus. */
export function useInboxUnread(auth) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!auth?.ok) return;
    let alive = true;
    const tick = () => getInboxUnreadCount().then(a => { if (alive) setN(a?.unread || 0); }).catch(() => {});
    tick();
    const iv = setInterval(tick, 180000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [auth?.ok]);
  return n;
}

/** All streams normalised to one shape, unread first. */
export function useInbox(auth, enabled = true) {
  const isL3 = (auth?.level || 0) >= 3;
  const [raw, setRaw] = useState({ mentions: [], leadership: [], watch: [], dms: [], dmOn: false });
  const [loading, setLoading] = useState(true);
  const load = async () => {
    const [m, w, dt] = await Promise.all([getMyMentions().catch(() => []), getTeamWatchPings().catch(() => []), getDMTrackingStatus().catch(() => ({ enabled: false }))]);
    const dms = dt?.enabled ? await getForwardedDMs().catch(() => []) : [];
    const leadership = isL3 ? await getLeadershipMentions().catch(() => []) : [];
    setRaw({ mentions: m || [], leadership: leadership || [], watch: w || [], dms: dms || [], dmOn: !!dt?.enabled });
    setLoading(false);
  };
  useEffect(() => { if (enabled && auth?.ok && !auth?.loading) load(); }, [enabled, auth?.ok, auth?.loading, auth?.id]);
  const items = useMemo(() => {
    const out = [];
    raw.mentions.forEach(m => out.push({ kind: "mention", uid: `m-${m.id}`, id: m.id, author: m.author_name, content: m.content, ts: m.created_at, is_read: m.is_read, channel: m.channel_name, server: m.guild_name, guild_id: m.guild_id, channel_id: m.channel_id, message_id: m.message_id }));
    raw.leadership.forEach(m => out.push({ kind: "leadership", uid: `L-${m.id}`, id: m.id, author: m.author_name, content: m.content, ts: m.created_at, is_read: m.is_read, channel: m.channel_name, server: m.guild_name, guild_id: m.guild_id, channel_id: m.channel_id, message_id: m.message_id }));
    raw.watch.forEach(p => out.push({ kind: "watch", uid: `w-${p.id}`, id: p.id, author: p.author_name, content: p.content, ts: p.created_at, is_read: p.is_read, channel: p.channel_name, server: p.server_name || p.guild_name, faction: p.faction_name, role: p.watch_role_name, guild_id: p.guild_id, channel_id: p.channel_id, message_id: p.message_id }));
    raw.dms.forEach(d => out.push({ kind: "dm", uid: `d-${d.id}`, id: d.id, author: d.author_name, content: d.content, ts: d.forwarded_at, is_read: d.is_read, dmChannel: d.source_channel_id, dmMsg: d.source_message_id }));
    return out.sort((a, b) => (a.is_read - b.is_read) || (new Date(b.ts) - new Date(a.ts)));
  }, [raw]);
  const unread = (arr) => arr.filter(x => !x.is_read).length;
  const counts = { mention: unread(raw.mentions), leadership: unread(raw.leadership), watch: unread(raw.watch), dm: unread(raw.dms) };
  counts.total = counts.mention + counts.leadership + counts.watch + counts.dm;
  return { items, counts, dmOn: raw.dmOn, loading, reload: load };
}

/** One ping with its actions: reply (as the bot, attributed), make a task, open, mark read, delete (DMs). */
export function InboxItem({ it, auth, onChanged }) {
  const [form, setForm] = useState(null); // 'reply' | 'task'
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");
  const { run, busy } = useAction();
  const level = auth?.level || 0, canWrite = level >= 1;
  const k = KIND[it.kind];
  const { staffList, roleTargets } = usePickerData(form === "task");
  const appLink = it.kind === "dm" ? null : `discord://-/channels/${it.guild_id}/${it.channel_id}/${it.message_id}`;
  const webLink = it.kind === "dm" ? `https://discord.com/channels/@me/${it.dmChannel}${it.dmMsg ? "/" + it.dmMsg : ""}` : `https://discord.com/channels/${it.guild_id}/${it.channel_id}/${it.message_id}`;
  const close = () => { setForm(null); setText(""); setTarget(""); setErr(""); };
  const open = (kind) => { close(); setForm(kind); if (kind === "task") setText(cleanMentions(it.content).slice(0, 200)); };
  const reply = () => { if (!text.trim()) return setErr("Message is empty."); run(() => k.reply(it.id, text.trim()), { success: "Reply sent.", onDone: () => { close(); onChanged?.(); } }); };
  const task = () => {
    if (!target) return setErr("Pick who the task is for.");
    if (!text.trim()) return setErr("Description required.");
    const { targetType, targetId } = parseTarget(target);
    run(() => createMyTask({ desc: text.trim(), targetType, targetId, enableDM: false }), { success: "Task created.", onDone: close });
  };
  return (
    <div className={`li${it.is_read ? "" : " unread"}`}>
      <div className="body">
        <div className="row small">
          <Badge tone={k.tone}>{k.label}</Badge>
          <b>{it.author}</b>
          {it.role && <Badge tone="good">@{it.role}</Badge>}
          {it.channel && <span className="mono tiny muted">#{it.channel}</span>}
          {it.server && <Badge>{it.server}</Badge>}
          {it.faction && it.faction !== it.server && <Badge tone="accent">{it.faction}</Badge>}
          <span className="mono tiny faint">{shortWhen(it.ts)}</span>
        </div>
        <div className="msg">{cleanMentions(it.content)}</div>
        <div className="actions-inline">
          {k.reply && canWrite && <Button size="sm" variant="ghost" onClick={() => open("reply")}>↩ Reply</Button>}
          {canWrite && <Button size="sm" variant="ghost" onClick={() => open("task")}>+ Task</Button>}
          {appLink && <a className="btn ghost sm" href={appLink} target="_blank" rel="noreferrer">Open app</a>}
          <a className="btn ghost sm" href={webLink} target="_blank" rel="noreferrer">{it.kind === "dm" ? "Open DM" : "Web"}</a>
          {!it.is_read && <Button size="sm" variant="quiet" disabled={busy} onClick={() => run(() => k.read(it.id), { onDone: onChanged })}>✓ Read</Button>}
          {it.kind === "dm" && <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm("Delete this forwarded DM?")) run(() => deleteDM(it.id), { success: "Deleted.", onDone: onChanged }); }}>Delete</Button>}
        </div>
        {form === "reply" && (
          <InlineForm label={`Reply to ${it.author} in #${it.channel} — sends as the bot, attributed to you (audited)`} error={err} busy={busy} onConfirm={reply} onCancel={close} confirmLabel="Send reply" confirmDisabled={!text.trim()}>
            <textarea rows={3} autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) reply(); if (e.key === "Escape") close(); }} />
          </InlineForm>
        )}
        {form === "task" && (
          <InlineForm label="Create a task from this" error={err} busy={busy} onConfirm={task} onCancel={close} confirmLabel="Create task" confirmDisabled={!target || !text.trim()}>
            <textarea rows={2} value={text} onChange={e => setText(e.target.value)} />
            <TargetPicker value={target} onChange={setTarget} roleTargets={roleTargets} staffList={staffList} level={level} placeholder="Assign to…" />
          </InlineForm>
        )}
      </div>
    </div>
  );
}

/** The panel (?panel=notifications on Home): tabs per stream, mark-all-read, DM forwarding toggle, paging. */
export function NotificationsPanel({ auth, onClose }) {
  const isL3 = (auth?.level || 0) >= 3;
  const { items, counts, dmOn, loading, reload } = useInbox(auth);
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(0);
  const { run, busy } = useAction();
  const TABS = [
    { id: "all", label: "All", count: counts.total },
    { id: "mention", label: "Mentions", count: counts.mention },
    ...(isL3 ? [{ id: "leadership", label: "Leadership", count: counts.leadership }] : []),
    { id: "watch", label: "Server pings", count: counts.watch },
    { id: "dm", label: "Forwarded DMs", count: counts.dm },
  ];
  const filtered = tab === "all" ? items : items.filter(i => i.kind === tab);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const shown = filtered.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE);
  const markAll = () => run(async () => {
    const kinds = tab === "all" ? ["mention", "leadership", "watch", "dm"] : [tab];
    if (kinds.includes("mention")) await markAllMentionsRead();
    if (kinds.includes("leadership") && isL3) await markAllLeadershipMentionsRead();
    if (kinds.includes("watch")) await markAllWatchPingsRead();
    if (kinds.includes("dm") && dmOn) await markAllDMsRead();
    return { ok: true };
  }, { success: "Marked as read.", onDone: reload });

  return (
    <Modal title="Notifications" onClose={onClose} maxWidth={760}>
      <div className="row spread">
        <Tabs tabs={TABS} active={tab} onChange={(t) => { setTab(t); setPage(0); }} />
        {filtered.some(i => !i.is_read) && <Button size="sm" variant="ghost" disabled={busy} onClick={markAll}>Mark all read</Button>}
      </div>
      {tab === "dm" && !dmOn && (
        <div className="info">
          Forward any Discord DM to the <b>Meridian Database bot</b> and it appears here — with a link back and a “make task” button.
          <div className="row mt8"><Button size="sm" disabled={busy} onClick={() => run(() => toggleDMTracking(true), { success: "DM forwarding enabled.", onDone: reload })}>Enable DM forwarding</Button></div>
        </div>
      )}
      {loading ? <div className="stack tight"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        : shown.length === 0 ? <Empty title="Nothing here">Mentions, server pings and forwarded DMs land here.</Empty>
          : <div className="list">{shown.map(it => <InboxItem key={it.uid} it={it} auth={auth} onChanged={reload} />)}</div>}
      {filtered.length > PAGE_SIZE && (
        <div className="row small muted">
          <Button size="sm" variant="ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)}>← Prev</Button>
          <span>Page {cur + 1} of {pages} · {filtered.length} items</span>
          <Button size="sm" variant="ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next →</Button>
        </div>
      )}
      {tab === "dm" && dmOn && <div><Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm("Disable DM forwarding?")) run(() => toggleDMTracking(false), { success: "DM forwarding disabled.", onDone: reload }); }}>Disable DM forwarding</Button></div>}
    </Modal>
  );
}
