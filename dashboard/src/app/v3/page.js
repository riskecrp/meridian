"use client";
// /v3 Home — shaped by role. Guides see their factions, tasks, scenes due,
// upcoming events and the notifications panel; team leads add "In flight" and
// their team's queue; leadership gets the Queue as the main surface with the
// rest folded below; Event Team / Lead Storyteller get storytelling shortcuts
// and read-only items. ?panel=notifications opens the inbox, ?panel=queue
// scrolls to the queue, ?create=task|event opens the creation dialog.
import { useEffect, useState } from "react";
import { useAuth } from "../../lib/useAuth.js";
import { PageHeader, Button, Badge, Restricted, Card, useQueryParam, setQueryParam } from "./ui.js";
import { CreateRow, CreateDialog } from "./work/CreateDialog.js";
import { NotificationsPanel, useInboxUnread } from "./work/Notifications.js";
import Queue from "./work/Queue.js";
import { useHomeData, AttentionCard, MyTasksCard, UpcomingCard, FactionsCard, ScenesDueCard, InFlightCard, StorytellingShortcuts } from "./work/HomeSections.js";
import { Collapsible, Skeleton } from "./work/shared.js";

const Bell = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2a3.5 3.5 0 0 0-3.5 3.5V8L3 10.5h10L11.5 8V5.5A3.5 3.5 0 0 0 8 2zM6.5 12a1.5 1.5 0 0 0 3 0" /></svg>;

export default function HomePage() {
  const auth = useAuth();
  const level = auth?.level || 0;
  const isET = !!auth?.isEventTeam, isLST = !!auth?.isLeadStoryteller;
  const panel = useQueryParam("panel");
  const create = useQueryParam("create");
  const unread = useInboxUnread(auth);
  const data = useHomeData(auth);
  const [queueCount, setQueueCount] = useState(null);
  const [createMode, setCreateMode] = useState(null);

  // The global "+ New" verbs land here with ?create=task|event.
  useEffect(() => { if (create === "task" || create === "event") { setCreateMode(create); setQueryParam("create", ""); } }, [create]);
  // ?panel=queue scrolls to the queue once it has rendered.
  useEffect(() => {
    if (panel !== "queue") return;
    const t = setTimeout(() => document.getElementById("queue")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => clearTimeout(t);
  }, [panel, data.loading]);

  if (auth?.loading) return <><PageHeader eyebrow="Home" title="Loading…" /><Skeleton rows={5} /></>;
  if (!auth?.ok) return <><PageHeader eyebrow="Home" title="Meridian" /><Restricted>Your session has ended. <a href="/api/auth/logout?reason=expired" style={{ textDecoration: "underline" }}>Sign in again</a>.</Restricted></>;
  if (level < 1 && !isET && !isLST) return <><PageHeader eyebrow="Home" title={`Welcome, ${auth.displayName || auth.name}`} /><Restricted>Your account has no FM clearance yet. Ask a team lead to add you to the staff roster.</Restricted></>;

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const unclaimed = (data.tasks.forMyTeam || []).filter(t => !t.claimed_by || t.claimed_by === "None").length;
  const sub = `${today} · ${data.facs.factions.length} faction${data.facs.factions.length === 1 ? "" : "s"} in view${level >= 1 ? (unclaimed > 0 ? ` · ${unclaimed} unclaimed on your team` : " · nothing unclaimed") : ""}`;
  const reload = data.reload;

  const header = (
    <PageHeader eyebrow="Home" title={`Welcome back, ${auth.displayName || auth.name}`} sub={data.loading ? today : sub}
      actions={<>
        <button className="ib" onClick={() => setQueryParam("panel", "notifications")} title="Notifications — your pings" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}><Bell />{unread > 0 && <span className="dot">{unread > 99 ? "99+" : unread}</span>}</button>
        {level >= 2 && <Button variant="ghost" onClick={() => setQueryParam("panel", "queue")}>Queue{queueCount !== null && <Badge tone={queueCount > 0 ? "warn" : "good"}>{queueCount}</Badge>}</Button>}
      </>} />
  );

  const common = {
    attention: <AttentionCard auth={auth} att={data.att} onChanged={reload} />,
    tasks: <MyTasksCard auth={auth} tasks={data.tasks} created={data.created} qa={data.qa} onChanged={reload} title={level >= 1 ? "My tasks" : "Tasks (read-only)"} />,
    upcoming: <UpcomingCard auth={auth} reminders={data.reminders} onChanged={reload} />,
    factions: <FactionsCard facs={data.facs} />,
    scenes: <ScenesDueCard scenesDue={data.scenesDue} />,
    inflight: level >= 2 ? <InFlightCard auth={auth} rp={data.rp} reviews={data.reviews} tasks={data.tasks} qa={data.qa} onChanged={reload} /> : null,
  };

  let body;
  if (data.loading) body = <Skeleton rows={6} />;
  else if (level >= 3) {
    body = (
      <div className="stack">
        <Card id="queue" title="Queue" right={<span className="mono tiny faint">everything waiting on leadership · oldest first</span>}>
          <Queue auth={auth} onCount={setQueueCount} />
        </Card>
        <Collapsible title="Needs attention" defaultOpen={!!((data.att?.counts?.inboxUnread || 0) + (data.att?.counts?.reviewsDue || 0) + (data.att?.reminderInstances || []).length)}>{common.attention}</Collapsible>
        <Collapsible title="In flight" defaultOpen={false}>{common.inflight}</Collapsible>
        <div className="grid two">
          <Collapsible title="My tasks" defaultOpen={false}>{common.tasks}</Collapsible>
          <Collapsible title="Upcoming" defaultOpen={false}>{common.upcoming}</Collapsible>
        </div>
        <Collapsible title="Factions" defaultOpen={false}>{common.factions}</Collapsible>
        <Collapsible title="Scenes due" defaultOpen={false}>{common.scenes}</Collapsible>
      </div>
    );
  } else if (level >= 2) {
    body = (
      <div className="stack">
        {common.attention}
        <Card id="queue" title="In flight — your team's queue" right={<span className="mono tiny faint">RP requests, verifications, questions</span>}>
          <Queue auth={auth} onCount={setQueueCount} />
        </Card>
        {common.inflight}
        <div className="grid two">{common.tasks}{common.upcoming}</div>
        {common.factions}
        {common.scenes}
      </div>
    );
  } else if (level >= 1) {
    body = (
      <div className="stack">
        {common.attention}
        <div className="grid two">{common.tasks}{common.upcoming}</div>
        {common.factions}
        {common.scenes}
      </div>
    );
  } else {
    body = (
      <div className="stack">
        <StorytellingShortcuts auth={auth} />
        {common.attention}
        <div className="grid two">{common.tasks}{common.upcoming}</div>
        <FactionsCard facs={data.facs} title={isLST ? "All factions" : "Factions"} />
        {common.scenes}
      </div>
    );
  }

  return (
    <>
      {header}
      <div className="mb14"><CreateRow auth={auth} onCreated={reload} /></div>
      {body}
      {panel === "notifications" && <NotificationsPanel auth={auth} onClose={() => { setQueryParam("panel", ""); reload(); }} />}
      {createMode && <CreateDialog auth={auth} mode={createMode} onClose={() => setCreateMode(null)} onDone={() => { setCreateMode(null); reload(); }} />}
    </>
  );
}
