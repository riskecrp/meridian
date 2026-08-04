"use client";
import { useEffect, useState } from "react";
import { useAuthContext } from "./AuthContext.js";
export function useAuthReal() {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/auth/session").then(r => {
      // The middleware only checks the session cookie EXISTS, not that it's valid
      // (it can't query the DB in the Edge runtime). So a stale cookie whose session
      // has expired/been removed slips onto /fm pages, where reads are ungated — then
      // any write throws "Not authenticated". Detect that here (401) and route the
      // user through logout (which clears the stale cookie) to log in again.
      if (r.status === 401 && typeof window !== "undefined" && (window.location.pathname.startsWith("/fm") || window.location.pathname.startsWith("/v2"))) {
        window.location.href = "/api/auth/logout";
        return null;
      }
      return r.ok ? r.json() : null;
    }).then(d => { setS(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  return { loading, ok: s?.authenticated || false, id: s?.discordId || "", name: s?.discordName || "", level: s?.clearance || 0, displayName: s?.displayName || "", teamId: s?.teamId || "", teamName: s?.teamName || "", rank: s?.rank || "", isEventTeam: !!s?.isEventTeam, isLeadStoryteller: !!s?.isLeadStoryteller, _impersonating: s?._impersonating || false, _realId: s?._realId || "" };
}


// View As impersonation — L3 only.
// When set in localStorage, returns a modified auth object with the
// chosen level. Server-side actions still run with the real session.
import { useEffect as _useEffect, useState as _useState } from "react";

export function useAuth() {
  const ctxAuth = useAuthContext();
  if (ctxAuth !== null) return ctxAuth;
  const real = useAuthReal();
  const [override, setOverride] = _useState(null);

  _useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      try {
        const v = localStorage.getItem("meridian-view-as");
        if (!v) { setOverride(null); return; }
        if (v === "event_team") { setOverride("event_team"); return; }
        if (v === "lead_storyteller") { setOverride("lead_storyteller"); return; }
        setOverride(parseInt(v, 10));
      } catch (e) { setOverride(null); }
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("meridian-view-as-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("meridian-view-as-changed", sync);
    };
  }, []);

  // Only L3 users can use the override.
  if (real?.level === 3 && override !== null) {
    if (override === "event_team") {
      return { ...real, isEventTeam: true, level: 0, _impersonating: true, _realLevel: real.level, _viewAsEventTeam: true };
    }
    if (override === "lead_storyteller") {
      return { ...real, isLeadStoryteller: true, level: 0, _impersonating: true, _realLevel: real.level, _viewAsLeadStoryteller: true };
    }
    if (typeof override === 'number' && override >= 1 && override <= 3 && override !== real.level) {
      return { ...real, level: override, _impersonating: true, _realLevel: real.level };
    }
  }
  return real;
}

export default useAuth;
