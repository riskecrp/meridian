"use client";
// Small helpers shared by Home, Work and the task page. Pure presentation:
// every server call lives in the page/section that owns it.
import { useEffect, useState } from "react";
import { Button, Badge, Field } from "../ui.js";
import { TargetSelect as V2TargetSelect, parseTarget } from "../../v2/TargetPicker.js";
import { getStaffForCreate, getRoleTargetsForCreate } from "../../fm/dashboard/actions.js";
import { translatePath } from "../../../lib/uiRoutes.js";

export { parseTarget };

/** A v2 href (from server queue items / urls.*) → its /v3 equivalent. */
export function toV3(href) {
  if (!href) return "/v3";
  if (/^https?:\/\//.test(href)) return href;
  if (href.startsWith("/v3")) return href;
  if (!href.startsWith("/v2")) return href;
  try { return translatePath(href, "v3"); } catch { return href; }
}

export const factionHref = (name, tab) => `/v3/factions/${encodeURIComponent(name || "")}${tab ? `?tab=${tab}` : ""}`;
export const taskHref = (uid) => `/v3/work/${encodeURIComponent(uid || "")}`;

export const cleanMentions = (s) => (s || "").replace(/<@[!&]?[0-9]+>/g, "@…");
export const shortWhen = (t) => (t ? new Date(String(t).replace(" ", "T")).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
export const timeOnly = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
export const dayStamp = (ms) => { const d = new Date(ms); return { d: d.toLocaleDateString(undefined, { day: "2-digit" }), m: d.toLocaleDateString(undefined, { month: "short" }) }; };

export const isClaimed = (t) => !!t?.claimed_by && t.claimed_by !== "None";
export const isLeadershipScoped = (t) => t?.targetLabel === "FM Leadership" || t?.targetLabel === "Game Affairs";
export const tierTone = (t) => (t >= 7 ? "good" : t >= 4 ? "accent" : "");

/** Picker data (staff + role/team ids), fetched once per session and shared by every form. */
let pickerPromise = null;
export function usePickerData(enabled = true) {
  const [data, setData] = useState({ staffList: [], roleTargets: { teams: [] } });
  useEffect(() => {
    if (!enabled) return;
    if (!pickerPromise) {
      pickerPromise = Promise.all([getStaffForCreate().catch(() => []), getRoleTargetsForCreate().catch(() => ({ teams: [] }))])
        .then(([staffList, roleTargets]) => ({ staffList: staffList || [], roleTargets: roleTargets || { teams: [] } }));
    }
    let alive = true;
    pickerPromise.then(d => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [enabled]);
  return data;
}

/** The v2 grouped target picker (roles/teams + staff) in the v3 input style. Emits "Role:<id>" / "User:<id>". */
export function TargetPicker(props) {
  return <V2TargetSelect className="inp" {...props} />;
}

/** Inline confirm form that opens under a row (completion note, question, reassign…). */
export function InlineForm({ label, children, error, onConfirm, onCancel, busy, confirmLabel = "Confirm", confirmDisabled }) {
  return (
    <div className="inline" onClick={e => e.stopPropagation()}>
      {label && <div className="lbl">{label}</div>}
      {children}
      {error && <div className="err">{error}</div>}
      <div className="row">
        <Button size="sm" disabled={busy || confirmDisabled} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** Status badge for a task row. */
export function TaskStatusBadge({ task }) {
  const open = (task.status || "open") === "open";
  if (!open) return <Badge tone={task.status === "completed" ? "good" : ""}>{task.status}</Badge>;
  return isClaimed(task) ? <Badge tone="good">claimed · {task.claimerName}</Badge> : <Badge tone="warn">unclaimed</Badge>;
}

export function TargetBadge({ task }) {
  return isLeadershipScoped(task) ? <Badge tone="lock">🔒 {task.targetLabel}</Badge> : <Badge>{task.targetLabel || "—"}</Badge>;
}

/** RP-change status → badge tone + label. */
export function rpStatusMeta(status) {
  switch (status) {
    case "PENDING": return { tone: "warn", label: "pending approval" };
    case "APPROVED": return { tone: "info", label: "approved · awaiting RP" };
    case "RP_DONE": return { tone: "accent", label: "ready to execute" };
    case "EXECUTED": return { tone: "good", label: "executed" };
    case "DENIED": return { tone: "bad", label: "denied" };
    default: return { tone: "", label: String(status || "").toLowerCase() };
  }
}

/** Card header toggle — a card that can fold. */
export function Collapsible({ title, right, defaultOpen = true, id, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fold" id={id}>
      <button className="fold-h" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="t">{title}</span>{right}<span className="tg" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && children}
    </div>
  );
}

/** Three grey bars while a section loads. */
export function Skeleton({ rows = 3 }) {
  return <div className="stack tight">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" />)}</div>;
}

export function LabeledField({ label, children }) { return <Field label={label}>{children}</Field>; }
