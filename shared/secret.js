// The secret that signs /verify portal sessions.
//
// SESSION_SECRET in the environment wins. Without it, a random secret is
// generated once and kept in a 0600 file next to the database
// (<data dir>/.session_secret), so a fresh install signs sessions without a
// manual step and the secret survives restarts. Rotating it (delete the file,
// or set the variable) simply logs every portal user out.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

let cached = null;

export function sessionSecretPath() {
  const dbPath = process.env.DATABASE_PATH || '/opt/meridian/data/meridian.db';
  return path.join(path.dirname(dbPath), '.session_secret');
}

export function getSessionSecret() {
  const env = (process.env.SESSION_SECRET || '').trim();
  if (env && env !== 'fallback') return env;
  if (env === 'fallback') throw new Error('SESSION_SECRET is set to the old placeholder "fallback"; remove it or set a real secret.');
  if (cached) return cached;
  const file = sessionSecretPath();
  try {
    if (existsSync(file)) {
      const s = readFileSync(file, 'utf8').trim();
      if (s.length >= 32) { cached = s; return s; }
    }
    mkdirSync(path.dirname(file), { recursive: true });
    const s = randomBytes(32).toString('hex');
    writeFileSync(file, s + '\n', { mode: 0o600 });
    console.warn(`[secret] SESSION_SECRET is not set; generated one at ${file}`);
    cached = s;
    return s;
  } catch (e) {
    throw new Error(`SESSION_SECRET is not set and ${file} could not be written: ${e.message}`);
  }
}
