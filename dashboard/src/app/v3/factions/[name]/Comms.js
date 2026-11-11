"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { postPortalMessage, deletePortalMessage, togglePortalMessagePin, markContactRead, getStaffForTeam } from "../../../fm/factions/actions.js";
import { assignIcContact, setIcContactStatus, completeIcContact, getThreadMessages } from "../../../fm/teams/actions.js";
import { getFactionICThread, getAnnouncementHistory } from "../../../fm/communications/actions.js";
import { FM_GUILD_ID } from "../../../../lib/constants.js";
import { Card, Badge, Button, Empty, Field, useAction } from "../../ui.js";
import { IcStatusBadge, short } from "../shared.js";

/* One incoming IC contact: status, read marker, assignment, thread, and the
   bridge to an RP change request (the contact id rides along so the server
   advances it to pending_roleplay and tells its thread). */
function Contact({ c, hub, onChanged }) {
  const { detail, level, canWrite, setModal } = hub;
  const { run, busy } = useAction();
  const [assign, setAssign] = useState(null);    // { staff, sel }
  const [thread, setThread] = useState(null);    // null | "loading" | [...]
  const manage = level >= 2 && canWrite;
  const setStatus = async (v) => {
    if (v === "completed") { if (!window.confirm("Complete and archive this contact?")) return; await run(() => completeIcContact(c.id), { success: "Contact completed.", onDone: onChanged }); }
    else await run(() => setIcContactStatus(c.id, v), { success: "Status updated.", onDone: onChanged });
  };
  const openAssign = async () => { const staff = (await getStaffForTeam(detail.name).catch(() => [])) || []; setAssign({ staff, sel: "" }); };
  const showThread = async () => {
    if (thread && thread !== "loading") { setThread(null); return; }
    setThread("loading");
    setThread((await getThreadMessages(c.thread_id).catch(() => [])) || []);
  };
  return (
    <div className={`note${c.is_read && c.status === "completed" ? " dim" : ""}`}>
      <div className="nh">
        {!c.is_read && <span className="unread" title="Unread" />}
        <span className="who">{c.sender_name}</span>
        {c.contact_type && <Badge tone="accent">{c.contact_type}</Badge>}
        {manage
          ? <select className="inp auto compact" disabled={busy} value={c.status || "pending_discussion"} onChange={e => setStatus(e.target.value)}>
            <option value="pending_discussion">Pending Discussion</option><option value="pending_roleplay">Pending Roleplay</option><option value="completed">Completed</option>
          </select>
          : <IcStatusBadge status={c.status} />}
        <span className="sp" />
        <span className="mono tiny faint">{short(c.submitted_at)}</span>
        {!c.is_read && canWrite && <Button size="sm" variant="quiet" disabled={busy} onClick={() => run(() => markContactRead(c.id), { onDone: onChanged })}>Mark read</Button>}
      </div>
      <div className="body">{c.message}</div>
      <div className="row mt-s">
        <span className="hint">{c.assigned_name ? <><span className="c-accent">{c.assigned_name}</span> assigned</> : "Unassigned"}{c.rp_change_id ? <> · RP request #{c.rp_change_id}</> : null}</span>
        <span className="grow" />
        {c.thread_id && <a className="btn quiet sm" href={`https://discord.com/channels/${FM_GUILD_ID}/${c.thread_id}`} target="_blank" rel="noreferrer">Thread ↗</a>}
        {c.thread_id && <Button size="sm" variant="quiet" onClick={showThread}>{thread && thread !== "loading" ? "Hide messages" : "Messages"}</Button>}
        {manage && <Button size="sm" variant="ghost" onClick={openAssign}>Assign</Button>}
        {manage && c.status !== "completed" && <Button size="sm" onClick={() => setModal({ kind: "rp", contactId: c.id })}>Request RP change</Button>}
      </div>
      {thread === "loading" && <div className="skeleton sk-row mt-s" />}
      {Array.isArray(thread) && (
        <div className="list mt-s">
          {thread.length === 0 ? <div className="hint">No messages in the thread (or the bot cannot read it).</div> : thread.map(m => <div className="li" key={m.id}><div className="body"><div className="t small">{m.author}{m.authorBot && <Badge>bot</Badge>} <span className="faint mono tiny">{short(m.timestamp)}</span></div><div className="d body" style={{ whiteSpace: "pre-wrap" }}>{m.content}</div></div></div>)}
        </div>
      )}
      {assign && (
        <div className="row mt-s">
          <select className="inp grow auto" value={assign.sel} onChange={e => setAssign({ ...assign, sel: e.target.value })}>
            <option value="">Select a team member…</option>
            {assign.staff.map(s => <option key={s.discord_id} value={s.discord_id}>{s.display_name}</option>)}
          </select>
          <Button size="sm" disabled={!assign.sel || busy} onClick={() => run(() => assignIcContact(c.id, assign.sel), { success: "Contact assigned.", onDone: async () => { setAssign(null); await onChanged(); } })}>Confirm</Button>
          <Button size="sm" variant="ghost" onClick={() => setAssign(null)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

export default function Comms({ hub }) {
  const { detail, auth, level, isL3, canWrite, archived, contacts, portal, reloadContacts, reloadPortal } = hub;
  const { run, busy } = useAction();
  const [text, setText] = useState("");
  const [pin, setPin] = useState(false);
  const [ic, setIc] = useState(null);           // IC memos sent (L2+)
  const [ann, setAnn] = useState(null);         // announcements that reached this faction (L2+)
  const isLeadPlus = level >= 2;

  useEffect(() => {
    if (!isLeadPlus) return;
    getFactionICThread(detail.id).then(r => setIc(r || [])).catch(() => setIc([]));
    getAnnouncementHistory("announcement", 100).then(rows => setAnn((rows || []).filter(r => (r.deliveries || []).some(d => d.faction_id === detail.id || d.faction_name === detail.name)))).catch(() => setAnn([]));
  }, [detail.id, isLeadPlus]);

  const unread = contacts.filter(c => !c.is_read).length;
  const post = () => run(() => postPortalMessage(detail.id, detail.name, text, pin), { success: "Posted to the faction page.", onDone: async () => { setText(""); setPin(false); await reloadPortal(); } });

  return (
    <div className="grid two">
      <div className="stack">
        <Card title="Incoming contacts" right={<span className="muted small">{unread} unread · {contacts.filter(c => c.status !== "completed").length} open</span>}>
          {contacts.length === 0 ? <Empty title="No messages received.">Faction members write in through the public portal; their messages land here.</Empty>
            : contacts.map(c => <Contact key={c.id} c={c} hub={hub} onChanged={reloadContacts} />)}
        </Card>
        {isLeadPlus && (
          <Card title="IC memos sent" right={!archived && <Link className="btn ghost sm" href={`/v3/comms?tab=ic&faction=${detail.id}`}>Send IC memo →</Link>}>
            {ic === null ? <div className="skeleton sk-box" /> : ic.length === 0 ? <Empty>No IC memos have reached this faction yet{!isL3 ? " (or it is outside your team)" : ""}.</Empty> : (
              <div className="list">{ic.map(m => <div className="li" key={m.id}><div className="body"><div className="t small">{m.author_name} <span className="faint mono tiny">{short(m.created_at)}</span></div>{m.message && <div className="d body" style={{ whiteSpace: "pre-wrap" }}>{m.message}</div>}</div><div className="side"><a className="badge accent" href={m.link} target="_blank" rel="noreferrer">Image ↗</a></div></div>)}</div>
            )}
          </Card>
        )}
      </div>
      <div className="stack">
        {canWrite && (
          <Card title="Post to faction page" right={<span className="muted small">public portal</span>}>
            <Field><textarea rows={3} placeholder="Write a message for the faction's public page…" value={text} onChange={e => setText(e.target.value)} /></Field>
            <div className="row spread mt-s">
              <label className="check"><input type="checkbox" checked={pin} onChange={e => setPin(e.target.checked)} /> Pin to top</label>
              <Button size="sm" disabled={busy || !text.trim()} onClick={post}>Post message</Button>
            </div>
          </Card>
        )}
        <Card title="Faction page messages" right={<span className="muted small">{portal.length}</span>}>
          {portal.length === 0 ? <Empty>Nothing posted to the faction page yet.</Empty> : portal.map(m => (
            <div className="note" key={m.id}>
              <div className="nh">
                <span className="who c-accent">{m.author_name}</span>
                {m.is_pinned === 1 && <Badge tone="accent">PINNED</Badge>}
                <span className="mono tiny faint">{short(m.created_at)}</span><span className="sp" />
                {canWrite && <Button size="sm" variant="quiet" disabled={busy} onClick={() => run(() => togglePortalMessagePin(m.id), { onDone: reloadPortal })}>{m.is_pinned ? "Unpin" : "Pin"}</Button>}
                {(m.author_id === auth.id || isL3) && !archived && <Button size="sm" variant="danger ghost" disabled={busy} onClick={() => { if (window.confirm("Delete this message from the faction page?")) run(() => deletePortalMessage(m.id), { success: "Message deleted.", onDone: reloadPortal }); }}>Delete</Button>}
              </div>
              <div className="body">{m.message}</div>
            </div>
          ))}
        </Card>
        {isLeadPlus && (
          <Card title="Announcements sent" right={!archived && <Link className="btn ghost sm" href={`/v3/comms?faction=${detail.id}`}>Announce →</Link>}>
            {ann === null ? <div className="skeleton sk-box" /> : ann.length === 0 ? <Empty>No announcements have been sent to this faction's Discord{!isL3 ? " by you" : ""}.</Empty> : (
              <div className="list">{ann.map(r => { const d = (r.deliveries || []).filter(x => x.faction_id === detail.id || x.faction_name === detail.name); return (
                <div className="li" key={r.id}><div className="body"><div className="t small">{r.author_name || r.sent_by || "FM"} <span className="faint mono tiny">{short(r.created_at || r.sent_at)}</span></div><div className="d body" style={{ whiteSpace: "pre-wrap" }}>{String(r.message || "").slice(0, 400)}{String(r.message || "").length > 400 ? "…" : ""}</div></div><div className="side">{d.map(x => <Badge key={x.id} tone={x.ok ? "good" : "bad"} title={x.error || ""}>{x.ok ? "✓" : "✗"} {x.channel_type}</Badge>)}</div></div>
              ); })}</div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
