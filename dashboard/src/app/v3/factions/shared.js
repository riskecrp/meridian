"use client";
// Small helpers shared by the faction list and the hub.
import { Badge } from "../ui.js";

export const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");
export const money = (n) => "$" + Number(n || 0).toLocaleString();
export const hubHref = (name, tab) => `/v3/factions/${encodeURIComponent(name)}${tab && tab !== "overview" ? `?tab=${tab}` : ""}`;

export function TierPill({ tier, long }) {
  return <span className={`tier-pill ${tierBand(tier)}`}>{long ? `Tier ${tier}` : `T${tier}`}</span>;
}

export const IC_STATUS = {
  pending_discussion: { tone: "warn", label: "Pending Discussion" },
  pending_roleplay: { tone: "info", label: "Pending Roleplay" },
  completed: { tone: "good", label: "Completed" },
};
export function IcStatusBadge({ status }) {
  const s = IC_STATUS[status] || IC_STATUS.pending_discussion;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** "YYYY-MM-DD HH:MM" from an ISO/SQLite timestamp, for compact rows. */
export const short = (v) => (v ? String(v).slice(0, 16).replace("T", " ") : "");
export const day = (v) => (v ? String(v).slice(0, 10) : "");

/** Member role → badge. */
export function RoleBadge({ role }) {
  if (role >= 2) return <Badge tone="lock">Leader</Badge>;
  if (role === 1) return <Badge tone="accent">Command</Badge>;
  return <span className="muted small">Member</span>;
}
