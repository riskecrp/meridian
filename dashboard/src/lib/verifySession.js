// Sessions for the /verify portal (the external activity-verification view).
//
// A session is an HMAC-signed cookie whose id (jti) is also stored in the
// verify_sessions table, so a session can be revoked (logout) before the
// 3-day expiry even though the cookie is self-contained. The signing secret is
// SESSION_SECRET, or a random one generated once next to the database
// (shared/secret.js); the old literal "fallback" is refused.
import crypto from 'node:crypto';
import { queryOne, run } from './db.js';
import { getSessionSecret } from '../../../shared/secret.js';

const DAYS = 3;
const COOKIE = 'meridian_verify_session';

function secret() { return getSessionSecret(); }

let ready = false;
function ensureTable() {
  if (ready) return;
  run("CREATE TABLE IF NOT EXISTS verify_sessions (jti TEXT PRIMARY KEY, discord_id TEXT NOT NULL, discord_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL)");
  ready = true;
}

const sign = (payload, sec) => crypto.createHmac('sha256', sec).update(payload).digest('base64url');

/** Mint a session token. Throws only when no secret can be read or generated. */
export function createVerifySession(discordId, discordName) {
  const sec = secret();
  ensureTable();
  const jti = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + DAYS * 86400000;
  run("DELETE FROM verify_sessions WHERE expires_at < ?", [new Date().toISOString()]);
  run("INSERT INTO verify_sessions (jti, discord_id, discord_name, expires_at) VALUES (?, ?, ?, ?)", [jti, String(discordId), String(discordName || ''), new Date(exp).toISOString()]);
  const payload = Buffer.from(JSON.stringify({ discord_id: String(discordId), discord_name: String(discordName || ''), exp, jti })).toString('base64url');
  return `${payload}.${sign(payload, sec)}`;
}

/** The session payload, or null when the token is missing, tampered, expired, revoked, or the secret is unset. */
export function validateVerifySession(token) {
  if (!token || typeof token !== 'string') return null;
  let sec;
  try { sec = secret(); } catch { return null; }
  try {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const payload = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(sign(payload, sec));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data || typeof data.exp !== 'number' || data.exp < Date.now() || !data.jti) return null;
    ensureTable();
    if (!queryOne("SELECT 1 FROM verify_sessions WHERE jti = ? AND expires_at > ?", [data.jti, new Date().toISOString()])) return null;
    return data;
  } catch { return null; }
}

/** Revoke a session (logout). Safe to call with a bad token. */
export function revokeVerifySession(token) {
  const data = validateVerifySession(token);
  if (data?.jti) run("DELETE FROM verify_sessions WHERE jti = ?", [data.jti]);
  return !!data;
}

export const VERIFY_COOKIE = COOKIE;
