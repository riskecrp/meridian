"use client";
import { useEffect, useRef } from "react";

// Local, on-disk autosave for in-progress form input. localStorage survives a
// page reload, a browser close, and a computer restart, so anything typed into
// a large data-entry field (scene logs, meeting notes, reviews) is not lost if
// the machine goes down before the user hits Save. This is deliberately
// client-only and never touches the server, so it cannot trigger side effects
// like duplicate Discord posts or half-finished database rows.

const PREFIX = "meridian:draft:";

// A draft counts as "blank" (nothing worth keeping) when it is empty text, an
// empty Quill document, an empty array, or an object with no keys.
export function isBlankDraft(v) {
  if (v == null) return true;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" || t === "<p><br></p>";
  }
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

export function loadDraft(key) {
  if (typeof window === "undefined" || !key) return undefined;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function saveDraft(key, value) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {}
}

export function clearDraft(key) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {}
}

// Write-through persistence. Saves `value` to localStorage every time it
// changes (i.e. on every keystroke, since each keystroke updates state and
// re-renders). Pass `enabled: false` to pause writing without erasing the
// stored draft — e.g. while a modal is closed — so a previously saved draft
// stays available for a "Resume" prompt. When the value is blank the draft is
// removed instead of stored.
export function useDraft(key, value, { enabled = true, blank = isBlankDraft } = {}) {
  // Keep the blank predicate in a ref so callers can pass an inline function
  // without making the effect re-run on every render.
  const blankRef = useRef(blank);
  blankRef.current = blank;

  useEffect(() => {
    if (!enabled || !key) return;
    if (blankRef.current(value)) clearDraft(key);
    else saveDraft(key, value);
  }, [key, value, enabled]);
}
