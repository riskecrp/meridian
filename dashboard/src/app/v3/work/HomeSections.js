"use client";
// Home sections. Each is a self-contained card fed by the page's one data load
// (useHomeData) so the role-shaped layouts in v3/page.js only arrange them.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge, Empty, Tabs, Stat, setQueryParam } from "../ui.js";
import { getMyTasks, getMyCreatedTasks, getMyReminders, getMyTeamFactions, getQACountsForTasks } from "../../fm/dashboard/actions.js";
import { getMyAttention } from "../../v2/actions.js";
import { getAttentionFactions } from "../../fm/scenes/actions.js";
import { getReviewData } from "../../fm/leadership/actions.js";
import { getMyRPRequests } from "../../fm/operations/actions.js";
import TaskRow from "./TaskRow.js";
import { EventRow, ReminderInstanceRow, RpRequestRow } from "./WorkItems.js";
import { Skeleton, usePickerData, factionHref, isClaimed, tierTone } from "./shared.js";

/** Everything Home reads, in one place. Every read fails soft. */
export function useHomeData(auth) {
  const level = auth?.level || 0;
  const [d, setD] = useState({ loading: true, tasks: { assignedToMe: [], forMyTeam: [] }, created: [], qa: {}, reminders: [], facs: { teamName: "", factions: [] }, att: null, scenesDue: null, reviews: null, rp: [] });
  const load = () => Promise.all([
    getMyTasks().catch(() => ({ assignedToMe: [], forMyTeam: [] })),
    getMyCreatedTasks().catch(() => []),
    getMyReminders().catch(() => []),
    getMyTeamFactions().catch(() => ({ teamName: "", factions: [] })),
    getMyAttention().catch(() => null),
    getAttentionFactions().catch(() => null),
    level >= 2 || auth?.isLeadStoryteller ? getReviewData().catch(() => null) : Promise.resolve(null),
    getMyRPRequests().catch(() => []),
  ]).then(async ([tasks, created, reminders, facs, att, scenesDue, reviews, rp]) => {
    const uids = [...(tasks.assignedToMe || []), ...(tasks.forMyTeam || []), ...(created || [])].map(x => x.task_uid).filter(Boolean);
    const qa = uids.length ? await getQACountsForTasks(uids).catch(() => ({})) : {};
    setD({ loading: false, tasks, created: created || [], qa, reminders: reminders || [], facs, att, scenesDue, reviews, rp: rp || [] });
  });
  useEffect(() => { if (auth?.ok && !auth?.loading) load(); }, [auth?.ok, auth?.loading, auth?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...d, reload: load };
}

/** "Needs attention": what getMyAttention says, every row linking into the v3 shell. */
export function AttentionCard({ auth, att, onChanged }) {
  const level = auth?.level || 0, isL3 = level >= 3;
  if (!att) return null;
  const c = att.counts || {};
  const items = [];
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  if (c.inboxUnread > 0) items.push({ chip: "INBOX", tone: "accent", text: `${n(c.inboxUnread, "unread ping", "unread pings")}`, onClick: () => setQueryParam("panel", "notifications") });
  if (c.teamUnclaimed > 0) items.push({ chip: "TASKS", tone: "warn", text: `${n(c.teamUnclaimed, "unclaimed task", "unclaimed tasks")} on your team`, href: "/v3/work?view=team" });
  if (c.approvals > 0) items.push({ chip: "APPROVALS", tone: "lock", text: `${n(c.approvals, "item", "items")} awaiting approval`, onClick: () => setQueryParam("panel", "queue") });
  if (c.reviewsDue > 0) items.push({ chip: "REVIEWS", tone: "warn", text: `${n(c.reviewsDue, "faction", "factions")} not reviewed this month`, href: "/v3/reviews", sub: (att.reviewsDue || []).map(f => ({ label: f.name, href: factionHref(f.name, "review") })), more: Math.max(0, c.reviewsDue - (att.reviewsDue || []).length) });
  if (c.icActive > 0) items.push({ chip: "IC", tone: "info", text: `${n(c.icActive, "active IC contact", "active IC contacts")}`, href: isL3 ? "/v3/reviews?tab=contacts" : "/v3/work?view=team&kind=contact" });
  const instances = att.reminderInstances || [];
  if (!items.length && !instances.length) return <div className="notice">✓ All clear — nothing needs you right now.</div>;
  return (
    <Card title="Needs attention" right={<Badge tone="warn">{items.length + instances.length}</Badge>}>
      <div className="list">
        {instances.map(ri => <ReminderInstanceRow key={ri.id} auth={auth} ri={ri} onChanged={onChanged} />)}
        {items.map((it, i) => {
          const body = <><div className="body"><div className="t row"><Badge tone={it.tone}>{it.chip}</Badge>{it.text}</div></div><div className="side faint">→</div></>;
          return (
            <div key={i} className="lirow">
              {it.href ? <Link href={it.href} className="li link">{body}</Link> : <div className="li link" onClick={it.onClick} role="button">{body}</div>}
              {it.sub?.length > 0 && <div className="chips mb8">{it.sub.map(s => <Link key={s.label} href={s.href} className="chip" title={`Open ${s.label}'s Review tab`}>{s.label} →</Link>)}{it.more > 0 && <Link href={it.href} className="chip">+{it.more} more →</Link>}</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** My Work: Assigned / Created / Team tabs, capped, with the row actions. */
export function MyTasksCard({ auth, tasks, created, qa, onChanged, initialTab = "assigned", cap = 8, title = "My tasks" }) {
  const [tab, setTab] = useState(initialTab);
  const { staffList, roleTargets } = usePickerData((auth?.level || 0) >= 1);
  const TABS = [
    { id: "assigned", label: "Assigned", count: (tasks.assignedToMe || []).length },
    { id: "created", label: "Created by me", count: (created || []).length },
    { id: "team", label: "Team", count: (tasks.forMyTeam || []).length },
  ];
  const list = tab === "created" ? created : tab === "team" ? tasks.forMyTeam : tasks.assignedToMe;
  return (
    <Card title={title} right={<Link href="/v3/work" className="btn quiet sm">View all →</Link>}>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {(list || []).length === 0
        ? <Empty>{tab === "created" ? "You haven't created any open tasks." : tab === "team" ? "No team tasks." : "Nothing assigned to you."}</Empty>
        : <div className="list">{(list || []).slice(0, cap).map(t => <TaskRow key={t.task_uid} auth={auth} task={t} qa={qa?.[t.task_uid]} staffList={staffList} roleTargets={roleTargets} onRefresh={onChanged} />)}
          {list.length > cap && <Link href="/v3/work" className="li link small muted">+{list.length - cap} more on Work →</Link>}</div>}
    </Card>
  );
}

/** Upcoming events (next 5) with snooze/delete. */
export function UpcomingCard({ auth, reminders, onChanged, cap = 5 }) {
  const now = Date.now();
  const upcoming = [...(reminders || [])].filter(r => r.epochMs > now).sort((a, b) => a.epochMs - b.epochMs);
  const upcoming7 = upcoming.filter(r => r.epochMs - now < 7 * 86400000).length;
  return (
    <Card title="Upcoming" right={<Badge>{upcoming7} in 7 days</Badge>}>
      {upcoming.length === 0 ? <Empty>No upcoming events.</Empty>
        : <div className="list">{upcoming.slice(0, cap).map(r => <EventRow key={r.uuid} auth={auth} r={r} onChanged={onChanged} />)}
          {upcoming.length > cap && <Link href="/v3/work?kind=event" className="li link small muted">+{upcoming.length - cap} more on Work →</Link>}</div>}
    </Card>
  );
}

/** My factions (team-led for L1/L2; all for L3 / LST) with hub quick links. */
export function FactionsCard({ facs, title }) {
  const list = [...(facs?.factions || [])].sort((a, b) => (b.tier || 0) - (a.tier || 0));
  return (
    <Card title={title || facs?.teamName || "My factions"} right={<Link href="/v3/factions" className="btn quiet sm">All factions →</Link>}>
      {list.length === 0 ? <Empty>No factions in your scope.</Empty> : (
        <div className="grid cards">
          {list.map(f => (
            <div key={f.id} className="tile">
              <div className="row spread"><Link href={factionHref(f.name)} className="t">{f.name}</Link><Badge tone={tierTone(f.tier)}>T{f.tier}</Badge></div>
              <div className="stats tight">
                <Stat label="Scenes 30d" value={f.scenes30d ?? 0} tone={(f.scenes30d ?? 0) < 2 ? "attn" : ""} />
                <Stat label="Forum 30d" value={f.forum_posts_30d ?? 0} />
              </div>
              <div className="d">↳ {f.leadName}{f.pending_promo ? " · promo staged" : ""}</div>
              <div className="chips">
                <Link href={factionHref(f.name)} className="chip">Hub</Link>
                <Link href={factionHref(f.name, "review")} className="chip">Review</Link>
                <Link href={factionHref(f.name, "members")} className="chip">Members</Link>
                <Link href={factionHref(f.name, "timeline")} className="chip">Timeline</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Factions under the 30-day scene threshold (fm/scenes getAttentionFactions). */
export function ScenesDueCard({ scenesDue }) {
  if (scenesDue === null || scenesDue === undefined) return null;
  return (
    <Card title="Scenes due" right={<Badge tone={scenesDue.length ? "warn" : "good"}>{scenesDue.length}</Badge>}>
      {scenesDue.length === 0 ? <Empty>Every active faction has had scenes in the last 30 days.</Empty> : (
        <div className="list">
          {scenesDue.map(([name, n]) => (
            <div key={name} className="li">
              <div className="body"><div className="t"><Link href={factionHref(name)}>{name}</Link></div><div className="d">{n === 0 ? "no scenes" : `${n} scene`} in 30 days</div></div>
              <div className="side"><Link href={`/v3/storytelling?tab=scenelogs&new=1&faction=${encodeURIComponent(name)}`} className="btn ghost sm">Log a scene</Link></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Team lead "In flight": RP requests, this month's review status per faction, unclaimed team tasks. */
export function InFlightCard({ auth, rp, reviews, tasks, qa, onChanged }) {
  const { staffList, roleTargets } = usePickerData((auth?.level || 0) >= 1);
  const unclaimed = (tasks?.forMyTeam || []).filter(t => !isClaimed(t));
  const rows = (reviews || []).filter(r => (auth?.level || 0) >= 3 || r.mine);
  const open = (rp || []).filter(r => r.status !== "EXECUTED");
  return (
    <Card title="In flight">
      <div className="section">
        <div className="lbl">RP requests</div>
        {open.length === 0 ? <div className="faint small">No open RP change requests of yours.</div>
          : <div className="list">{open.map(r => <RpRequestRow key={r.id} auth={auth} r={r} onChanged={onChanged} />)}</div>}
      </div>
      {reviews && (
        <div className="section">
          <div className="row spread"><span className="lbl">This month's reviews</span><Link href="/v3/reviews" className="btn quiet sm">Reviews →</Link></div>
          {rows.length === 0 ? <div className="faint small">No factions in your scope.</div> : (
            <div className="tblwrap">
              <table className="tbl">
                <thead><tr><th>Faction</th><th>Recommendation</th><th>Leadership</th><th className="hide-sm">Votes</th><th className="hide-sm">Feedback</th></tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td><Link href={factionHref(r.name, "review")}><b>{r.name}</b></Link></td>
                      <td>{r.currentReview?.recommendation ? <Badge tone="accent">{r.currentReview.recommendation}</Badge> : <Badge tone="warn">not submitted</Badge>}</td>
                      <td><Badge tone={String(r.status || "").startsWith("Confirmed") ? "good" : ""}>{r.status || "Pending Discussion"}</Badge></td>
                      <td className="hide-sm mono">{r.tally?.recorded || 0}/{r.tally?.voters || 0}</td>
                      <td className="hide-sm">{r.feedbackSent?.sent ? <Badge tone="good">sent</Badge> : <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div className="section">
        <div className="row spread"><span className="lbl">Unclaimed team tasks</span><Link href="/v3/work?view=team" className="btn quiet sm">Team board →</Link></div>
        {unclaimed.length === 0 ? <div className="faint small">Nothing unclaimed on your team.</div>
          : <div className="list">{unclaimed.slice(0, 6).map(t => <TaskRow key={t.task_uid} auth={auth} task={t} qa={qa?.[t.task_uid]} staffList={staffList} roleTargets={roleTargets} onRefresh={onChanged} />)}</div>}
      </div>
    </Card>
  );
}

/** Event Team / Lead Storyteller shortcuts. */
export function StorytellingShortcuts({ auth }) {
  const isET = !!auth?.isEventTeam, isLST = !!auth?.isLeadStoryteller;
  const items = [
    ...(isET ? [
      { t: "Log a scene", d: "Outcome + rewards", href: "/v3/storytelling?tab=scenelogs&new=1" },
      { t: "Scene library", d: "Ideas and run sheets", href: "/v3/storytelling?tab=scenes" },
      { t: "NPC spawner", d: "Spawn commands", href: "/v3/storytelling?tab=spawner" },
      { t: "Change log", d: "World changes", href: "/v3/storytelling?tab=changelog" },
    ] : []),
    ...(isLST ? [
      { t: "Scene ideas", d: "Approve submissions", href: "/v3/storytelling?tab=scenes" },
      { t: "Library", d: "Documents & knowledge base", href: "/v3/library" },
      { t: "Reviews", d: "Read-only this month", href: "/v3/reviews" },
    ] : []),
    { t: "NPCs & turfs", d: "The world registry", href: "/v3/storytelling?tab=npcs" },
    { t: "Factions", d: "Read-only hubs", href: "/v3/factions" },
  ];
  return (
    <Card title="Storytelling">
      <div className="quick">{items.map(it => <Link key={it.t} href={it.href}><span className="t">{it.t}</span><span className="d">{it.d}</span></Link>)}</div>
      <div className="restricted mt8">Your access outside Storytelling is read-only.</div>
    </Card>
  );
}

