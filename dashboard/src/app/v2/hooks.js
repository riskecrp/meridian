"use client";
import { useState } from "react";

// Copy-to-clipboard with a transient "copied" marker (id-keyed).
export function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = (text, id) => { navigator.clipboard?.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500); };
  return [copied, copy];
}

// The one action-runner: every server-action call goes through run() so
// failures surface instead of silently closing forms. Handles both the
// `{ ok:false, error }` convention and thrown errors.
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = async (fn, onDone) => {
    setBusy(true); setErr("");
    let r;
    try { r = await fn(); }
    catch (e) { setErr(e?.message || "Action failed."); setBusy(false); return false; }
    if (r && r.ok === false) { setErr(r.error || "Action failed."); setBusy(false); return false; }
    setBusy(false);
    if (onDone) await onDone(r);
    return true;
  };
  return { busy, err, setErr, run };
}
