-- 022_verify_sessions.sql
-- Revocable sessions for the /verify portal (lib/verifySession.js creates it on
-- first use too; this keeps schema.sql and bootstrap in step). Ids only, no secrets.
CREATE TABLE IF NOT EXISTS verify_sessions (
  jti TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL,
  discord_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verify_sessions_exp ON verify_sessions(expires_at);
