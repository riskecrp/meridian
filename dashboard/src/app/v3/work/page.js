"use client";
// /v3/work — one list of work items. Views: mine | my team | all (L3 only).
// Filters: kind (task / reminder / event / RP request / IC contact / mention),
// status (open / completed) and search. "My team" is the v2 Teams board: the
// team's roster + factions, its task board, events, IC contacts (with the RP
// request form) and create task/event aimed at the team.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/useAuth.js";
import { PageHeader, Button, Tabs, Empty, Restricted, Card, useQueryParam, setQueryParam } from "../ui.js";
import {
  getMyTasks, getMyCreatedTasks, getAllServerTasks, getMyReminders, getMyRecurringInstances, getQACountsForTasks,
} from "../../fm/dashboard/actions.js";
import { getTeams, getTeamTasks, getTeamReminders, getTeamIcContactsAll, getAllIcContacts } from "../../fm/teams/actions.js";
import { getMyRPRequests, getPendingExecutions } from "../../fm/operations/actions.js";
import { getPendingQueue } from "../../fm/leadership/actions.js";
import TaskRow from "./TaskRow.js";
import { EventRow, ReminderInstanceRow, RpRequestRow, IcContactCard, TeamSummary } from "./WorkItems.js";
import { CreateDialog } from "./CreateDialog.js";
import { useInbox, InboxItem } from "./Notifications.js";
import { Skeleton, usePickerData } from "./shared.js";

const KINDS = [
  ["all", "All"], ["task", "Tasks"], ["reminder", "Reminders"], ["event", "Events"], ["rp", "RP requests"], ["contact", "IC contacts"], ["mention", "Mentions"],
];
// v2 ids that land here: ?view=team (from /v2/teams), ?tab=… from the old task tabs.
const VIEW_ALIAS = { mine: "mine", team: "team", all: "all", assigned: "mine", created: "mine", history: "mine", teams: "team" };

export default function WorkPage() {
  const auth = useAuth();
  const level = auth?.level || 0;
  const isL3 = level >= 3;
  const rawView = useQueryParam("view", "mine");
  const view = VIEW_ALIAS[rawView] || "mine";
  const kind = useQueryParam("kind", "all");
  const status = useQueryParam("status", "open");
  const teamParam = useQueryParam("team");
  const [q, setQ] = useState("");
  const [create, setCreate] = useState(null);
  const [data, setData] = useState({ loading: true });
  const [teams, setTeams] = useState(null);
  const { staffList, roleTargets } = usePickerData(level >= 1);
  const inbox = useInbox(auth, view === "mine");
  const unknownView = rawView && !VIEW_ALIAS[rawView];
  const effView = view === "all" && !isL3 ? "mine" : view;
  const teamId = effView === "team" ? (teamParam || auth?.teamId || teams?.[0]?.id || "") : "";
  const team = (teams || []).find(t => t.id === teamId) || null;

  const load = async () => {
    if (!auth?.ok) return;
    setData(d => ({ ...d, loading: true }));
    let tasks = [], events = [], instances = [], rp = [], contacts = [], completedTasks = [];
    if (effView === "mine") {
      const [t, c, r, i, m, h] = await Promise.all([
        getMyTasks().catch(() => ({ assignedToMe: [], forMyTeam: [] })),
        getMyCreatedTasks().catch(() => []),
        getMyReminders().catch(() => []),
        getMyRecurringInstances().catch(() => []),
        getMyRPRequests().catch(() => []),
        getMyCreatedTasks({ status: "completed" }).catch(() => []),
      ]);
      const seen = new Set();
      for (const x of [...(t.assignedToMe || []), ...(c || []), ...(t.forMyTeam || []).map(y => ({ ...y, _role: true }))]) { if (!seen.has(x.task_uid)) { seen.add(x.task_uid); tasks.push(x); } }
      events = r || []; instances = i || []; rp = m || []; completedTasks = h || [];
    } else if (effView === "team") {
      if (!teamId) { setData({ loading: false, tasks, events, instances, rp, contacts, completedTasks, qa: {} }); return; }
      const [t, r, c, pq] = await Promise.all([
        getTeamTasks(teamId).catch(() => []),
        getTeamReminders(teamId).catch(() => []),
        getTeamIcContactsAll(teamId).catch(() => []),
        level >= 2 ? getPendingQueue().catch(() => null) : Promise.resolve(null),
      ]);
      tasks = t || []; events = r || []; contacts = c || [];
      const fids = new Set((team?.factions || []).map(f => f.id));
      rp = (pq?.rpChanges || []).filter(x => fids.has(x.faction_id));
    } else {
      const [t, h, r, p, c] = await Promise.all([
        getAllServerTasks().catch(() => []),
        getAllServerTasks({ status: "completed" }).catch(() => []),
        getMyReminders().catch(() => []),
        getPendingExecutions().catch(() => []),
        getAllIcContacts().catch(() => []),
      ]);
      tasks = t || []; completedTasks = h || []; events = r || []; rp = p || []; contacts = c || [];
    }
    const uids = [...tasks, ...completedTasks].map(x => x.task_uid).filter(Boolean);
    const qa = uids.length ? await getQACountsForTasks(uids).catch(() => ({})) : {};
    setData({ loading: false, tasks, events, instances, rp, contacts, completedTasks, qa });
  };

  useEffect(() => { if (auth?.ok && !auth?.loading && level >= 1 && teams === null) getTeams().then(t => setTeams(t || [])).catch(() => setTeams([])); }, [auth?.ok, auth?.loading, level]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (auth?.ok && !auth?.loading && (effView !== "team" || teams !== null)) load(); }, [auth?.ok, auth?.loading, auth?.id, effView, teamId, teams === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = q.trim().toLowerCase();
  const match = (s) => !needle || String(s || "").toLowerCase().includes(needle);
  const rows = useMemo(() => {
    if (data.loading) return [];
    const out = [];
    const want = (k) => kind === "all" || kind === k;
    const completed = status === "completed";
    if (want("task")) {
      for (const t of (completed ? data.completedTasks : data.tasks) || []) if (match(`${t.description} ${t.targetLabel} ${t.claimerName} ${t.created_by_name} ${t.teamContext || ""}`)) out.push({ k: "task", key: `t-${t.task_uid}`, at: t.created_at, el: <TaskRow auth={auth} task={t} qa={data.qa?.[t.task_uid]} staffList={staffList} roleTargets={roleTargets} onRefresh={load} showTeam /> });
    }
    if (!completed && want("reminder")) for (const ri of data.instances || []) if (match(`${ri.title} ${ri.body || ""}`)) out.push({ k: "reminder", key: `ri-${ri.id}`, at: `${ri.year}-${String(ri.month).padStart(2, "0")}`, el: <ReminderInstanceRow auth={auth} ri={ri} onChanged={load} /> });
    if (!completed && want("event")) for (const r of data.events || []) if (match(`${r.message} ${r.authorName}`)) out.push({ k: "event", key: `e-${r.uuid}`, at: new Date(r.epochMs).toISOString(), el: <EventRow auth={auth} r={r} onChanged={load} /> });
    if (want("rp")) for (const r of data.rp || []) if ((completed ? r.status === "EXECUTED" : r.status !== "EXECUTED") && match(`${r.execution_type} ${r.old_value} ${r.new_value} ${r.faction_name} ${r.requested_by}`)) out.push({ k: "rp", key: `rp-${r.id}`, at: r.created_at, el: <RpRequestRow auth={auth} r={r} onChanged={load} /> });
    if (want("contact")) for (const c of data.contacts || []) if ((completed ? c.status === "completed" : c.status !== "completed") && match(`${c.faction_name} ${c.sender_name} ${c.message} ${c.assigned_name || ""}`)) out.push({ k: "contact", key: `c-${c.id}`, at: c.submitted_at, el: <IcContactCard auth={auth} contact={c} staffList={staffList} onChanged={load} /> });
    if (effView === "mine" && want("mention")) for (const it of inbox.items || []) if ((completed ? it.is_read : !it.is_read) && match(`${it.author} ${it.content} ${it.channel || ""}`)) out.push({ k: "mention", key: it.uid, at: it.ts, el: <InboxItem it={it} auth={auth} onChanged={inbox.reload} /> });
    return out;
  }, [data, kind, status, needle, inbox.items, effView, staffList, roleTargets]); // eslint-disable-line react-hooks/exhaustive-deps

  if (auth?.loading) return <><PageHeader eyebrow="Work" title="Work" /><Skeleton rows={5} /></>;
  if (!auth?.ok) return <><PageHeader eyebrow="Work" title="Work" /><Restricted>You are not signed in.</Restricted></>;
  if (level < 1) return <><PageHeader eyebrow="Work" title="Work" /><Restricted>Work is for FM staff (L1+). Event Team and Lead Storytellers see tasks on Home.</Restricted></>;

  const VIEWS = [{ id: "mine", label: "Mine" }, { id: "team", label: "My team" }, ...(isL3 ? [{ id: "all", label: "All" }] : [])];
  const kindsHere = KINDS.filter(([k]) => k === "all" || (effView === "mine" ? k !== "contact" : k !== "mention" && k !== "reminder"));
  const counts = {};
  for (const r of rows) counts[r.k] = (counts[r.k] || 0) + 1;
  const defaultTarget = effView === "team" && team ? { targetType: "Role", targetId: team.id } : undefined;

  return (
    <>
      <PageHeader eyebrow="Work" title="Work" sub={effView === "all" ? "Every open task, event, RP request and IC contact on the server." : effView === "team" ? "Your team's board: tasks, events and IC contacts for the factions it leads." : "Everything assigned to you, created by you, or aimed at your roles."}
        actions={<><Button variant="ghost" onClick={() => setCreate("task")}>+ Task</Button><Button variant="ghost" onClick={() => setCreate("event")}>+ Event</Button></>} />
      {unknownView && <div className="info">Unknown view “{rawView}” — showing your own work.</div>}
      <Tabs tabs={VIEWS} active={effView} onChange={(v) => { setQueryParam("view", v === "mine" ? "" : v); }} />

      {effView === "team" && (
        teams === null ? <Skeleton rows={2} /> : teams.length === 0 ? <Empty title="No teams yet">Staff are assigned to teams on Settings › Staff &amp; Teams.</Empty> : (
          <div className="stack mb14">
            <div className="chips">{teams.map(t => <button key={t.id} className={`chip${t.id === teamId ? " on" : ""}`} onClick={() => setQueryParam("team", t.id === auth?.teamId ? "" : t.id)}>{t.name}{t.id === auth?.teamId ? " · mine" : ""}</button>)}</div>
            {team && <TeamSummary team={team} selected />}
          </div>
        )
      )}

      <div className="filters">
        <div className="chips">{kindsHere.map(([k, label]) => <button key={k} className={`chip${kind === k ? " on" : ""}`} onClick={() => setQueryParam("kind", k === "all" ? "" : k)}>{label}{k !== "all" && counts[k] > 0 && <span className="ct">{counts[k]}</span>}</button>)}</div>
        <div className="chips">
          <button className={`chip${status !== "completed" ? " on" : ""}`} onClick={() => setQueryParam("status", "")}>Open</button>
          <button className={`chip${status === "completed" ? " on" : ""}`} onClick={() => setQueryParam("status", "completed")} title={effView === "team" ? "Completed IC contacts and executed RP requests (team tasks are kept under Mine › Completed by their creator)" : "Completed tasks are kept, never deleted"}>Completed</button>
        </div>
        <input className="inp search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search text, target, claimer…" aria-label="Search work" />
      </div>

      {data.loading ? <Skeleton rows={5} /> : rows.length === 0
        ? <Empty title={needle ? "No matches" : status === "completed" ? "Nothing completed here" : "Nothing open"}>{needle ? "Try another search." : effView === "team" && !teamId ? "Pick a team above." : status === "completed" && effView === "mine" ? "Completed tasks you created will appear here." : "You're all caught up."}</Empty>
        : <Card flush><div className="list pad">{rows.map(r => <div key={r.key} className={`wrow ${r.k}`}>{r.el}</div>)}</div></Card>}

      {effView === "mine" && (
        <div className="faint tiny mt8">Task links from Discord pings open the task page with its Q&amp;A thread. <Link href="/v3?panel=notifications">Notifications →</Link></div>
      )}
      {create && <CreateDialog auth={auth} mode={create} defaultTarget={defaultTarget} onClose={() => setCreate(null)} onDone={() => { setCreate(null); load(); }} />}
    </>
  );
}
