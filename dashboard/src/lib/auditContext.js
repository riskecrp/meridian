// Who is really acting behind an owner view-as session.
//
// resolveActor() records "target id → owner name" whenever it builds an
// impersonated actor, and clears the entry whenever the target resolves as
// themselves. lib/audit.js consults it so an impersonated action is written as
// "Target (as Owner)". Entries expire on their own; the only way to mislabel is
// the owner viewing-as someone in the same minute that person acts, and even
// then the entry is cleared the moment they resolve a request of their own.
const TTL_MS = 60_000;
const marks = new Map();
export function markImpersonation(targetId, realId, realName) { marks.set(String(targetId), { realId, realName, until: Date.now() + TTL_MS }); }
export function clearImpersonation(targetId) { marks.delete(String(targetId)); }
export function impersonationFor(actorId) {
  const m = marks.get(String(actorId));
  if (!m) return null;
  if (m.until < Date.now()) { marks.delete(String(actorId)); return null; }
  return m;
}
