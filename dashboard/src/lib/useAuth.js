"use client";
import { useEffect, useState } from "react";
import { useAuthContext } from "./AuthContext.js";

// The client-side view of the current actor: exactly what /api/auth/session
// returns, which is exactly what requireActor resolves server-side (owner
// view-as included — it is a cookie the server applies, never a client-side
// override, so what the UI shows and what actions allow always agree).
const EMPTY = { loading: true, ok: false, id: "", name: "", level: 0, displayName: "", teamId: "", teamName: "", rank: "", isEventTeam: false, isLeadStoryteller: false, isOwner: false, _impersonating: false, _realId: "", _realName: "" };

function shape(s, loading) {
  return {
    loading,
    ok: s?.authenticated || false,
    id: s?.discordId || "",
    name: s?.discordName || "",
    level: s?.clearance || 0,
    displayName: s?.displayName || "",
    teamId: s?.teamId || "",
    teamName: s?.teamName || "",
    rank: s?.rank || "",
    isEventTeam: !!s?.isEventTeam,
    isLeadStoryteller: !!s?.isLeadStoryteller,
    isOwner: !!s?.isOwner,
    _impersonating: !!s?._impersonating,
    _realId: s?._realId || "",
    _realName: s?._realName || "",
  };
}

/** Fetches the session once. `enabled: false` skips the fetch (a layout above already provides the auth). */
export function useAuthReal({ enabled = true } = {}) {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/auth/session").then(r => {
      // The middleware only checks the session cookie EXISTS, not that it's valid
      // (it can't query the DB in the Edge runtime). A stale cookie slips onto the
      // app pages; detect the 401 here and route through logout to clear it.
      if (r.status === 401 && typeof window !== "undefined" && /^\/(fm|v2|v3)(\/|$)/.test(window.location.pathname)) {
        window.location.href = "/api/auth/logout?reason=expired";
        return null;
      }
      return r.ok ? r.json() : null;
    }).then(d => { if (alive) { setS(d); setLoading(false); } }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [enabled]);
  return enabled ? shape(s, loading) : EMPTY;
}

/**
 * Auth for any client component. Hooks run unconditionally (rules of hooks):
 * the context value wins when a layout provides one, otherwise the fetched
 * session is used.
 */
export function useAuth() {
  const ctxAuth = useAuthContext();
  const real = useAuthReal({ enabled: ctxAuth === null });
  return ctxAuth !== null ? ctxAuth : real;
}

export default useAuth;
