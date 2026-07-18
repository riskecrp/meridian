"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../lib/useAuth";
import {
  getMyTasks, getMyCreatedTasks, getAllServerTasks,
  getStaffForCreate, getRoleTargetsForCreate, getQACountsForTasks,
} from "../../fm/dashboard/actions.js";
import TaskList from "../TaskList.js";

// The full task view — reached on demand via "View all →" on Home, not a nav
// item. Adds the L3 all-server backlog + search on top of My Work's tabs.
export default function V2Tasks() {
  const auth = useAuth();
  const [tasks, setTasks] = useState({ assignedToMe: [], forMyTeam: [] });
  const [created, setCreated] = useState([]);
  const [allServer, setAllServer] = useState(null);
  const [staffList, setStaffList] = useState([]);
  const [roleTargets, setRoleTargets] = useState({ teams: [] });
  const [qaCounts, setQaCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const isL3 = (auth?.level || 0) >= 3;

  const load = () => {
    Promise.all([
      getMyTasks().catch(() => ({ assignedToMe: [], forMyTeam: [] })),
      getMyCreatedTasks().catch(() => []),
      isL3 ? getAllServerTasks().catch(() => []) : Promise.resolve(null),
    ]).then(([t, c, a]) => {
      setTasks(t); setCreated(c || []); setAllServer(a);
      const uids = [...(t.assignedToMe || []), ...(t.forMyTeam || []), ...(c || []), ...(a || [])].map(x => x.task_uid).filter(Boolean);
      if (uids.length) getQACountsForTasks(uids).then(setQaCounts).catch(() => {});
      setLoading(false);
    });
  };

  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    load();
    getStaffForCreate().then(setStaffList).catch(() => {});
    getRoleTargetsForCreate().then(setRoleTargets).catch(() => {});
  }, [auth?.id, auth?.loading]);

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow"><Link href="/v2" style={{ color: "var(--ink-3)" }}>Home</Link> · Tasks</p>
          <h1>All tasks</h1>
          <div className="sub">Your work, plus{isL3 ? " the full server backlog" : " your team"} — filterable.</div>
        </div>
      </div>

      <TaskList auth={auth} assigned={tasks.assignedToMe} created={created} team={tasks.forMyTeam}
        allServer={allServer} staffList={staffList} roleTargets={roleTargets} qaCounts={qaCounts}
        onRefresh={load} full />

      <div className="disclaimer">Reached via “View all” — not a nav item. Single-task links (from Discord) open the task detail page.</div>
    </div>
  );
}
