"use client";
// Shared bits for the Library and Storytelling pages: the section ids both
// pages know (so a v2 link to either lands on the right page), the v2 aliases,
// and a copy-to-clipboard hook.
import { useState } from "react";

export const LIBRARY_TABS = [
  { id: "kb", label: "Knowledge Base" },
  { id: "docs", label: "Documents" },
  { id: "peds", label: "Peds" },
  { id: "vehicles", label: "Vehicle Catalog" },
  { id: "arsenal", label: "Arsenal" },
];
export const STORY_TABS = [
  { id: "scenelogs", label: "Scene Logs" },
  { id: "scenes", label: "Scene Library" },
  { id: "changelog", label: "Change Log" },
  { id: "npcs", label: "NPC Ecosystem", min: 2 },
];
export const LIBRARY_IDS = LIBRARY_TABS.map(t => t.id);
export const STORY_IDS = STORY_TABS.map(t => t.id);

// Every spelling /v2/story accepted (its TAB_ALIASES), plus the legacy /fm names.
export const TAB_ALIASES = {
  library: "scenes", scene: "scenes", ideas: "scenes",
  network: "npcs", npc: "npcs", turfs: "npcs",
  loadouts: "arsenal", weapons: "arsenal", spawner: "arsenal", spawn: "arsenal", spawns: "arsenal",
  changes: "changelog", log: "changelog",
  knowledge: "kb", lore: "kb",
  documents: "docs", sop: "docs", sops: "docs",
  ped: "peds", scenelog: "scenelogs", logs: "scenelogs",
  vehicle: "vehicles", catalog: "vehicles", garage: "vehicles",
};
// ?tab= spellings that mean "Arsenal, open on the spawn commands".
export const SPAWN_ALIASES = ["spawner", "spawn", "spawns"];

export function resolveTab(raw) {
  const t = String(raw || "").trim().toLowerCase();
  return { raw: t, id: TAB_ALIASES[t] || t };
}

/** Set several query keys in one history entry (ui.js setQueryParam does one). */
export function setQuery(patch) {
  const u = new URL(window.location.href);
  Object.entries(patch).forEach(([k, v]) => { if (v == null || v === "") u.searchParams.delete(k); else u.searchParams.set(k, String(v)); });
  window.history.pushState({}, "", u.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Rebuild the current query string for a hand-off to the other page, swapping the tab. */
export function carryQuery(tab) {
  const u = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  u.set("tab", tab);
  return `?${u.toString()}`;
}

/** Everyone the Library and Storytelling pages admit: staff, Event Team, Lead Storytellers. */
export function canEnter(auth) {
  return !!auth?.ok && ((auth.level || 0) >= 1 || !!auth.isEventTeam || !!auth.isLeadStoryteller);
}

// Copy-to-clipboard with a transient "copied" marker, keyed by id.
export function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = (text, id) => { try { navigator.clipboard?.writeText(text); } catch {} setCopied(id); setTimeout(() => setCopied(null), 1500); };
  return [copied, copy];
}

export function CopyButton({ text, id, copied, copy, label = "Copy", title }) {
  const done = copied === id;
  return <button type="button" className={`copybtn${done ? " done" : ""}`} title={title || `Copy ${text}`} onClick={() => copy(text, id)}>{done ? "✓ Copied" : label}</button>;
}

export const confirmIt = (msg) => typeof window !== "undefined" && window.confirm(msg);
