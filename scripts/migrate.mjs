#!/usr/bin/env node
// Applies migrations/NNN_*.sql exactly once each, in filename order.
// Applied filenames are tracked in the _migrations table.
// Migrations must NOT contain BEGIN/COMMIT — each file runs in its own transaction.
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data', 'meridian.db');
const dir = path.join(root, 'migrations');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');
db.pragma('foreign_keys = ON');
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
const files = readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();

let ran = 0;
for (const f of files) {
  if (applied.has(f)) continue;
  const sql = readFileSync(path.join(dir, f), 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
    db.exec('COMMIT');
    console.log(`applied ${f}`);
    ran++;
  } catch (e) {
    db.exec('ROLLBACK');
    console.error(`FAILED ${f}: ${e.message}`);
    process.exit(1);
  }
}
console.log(ran ? `${ran} migration(s) applied.` : 'Nothing to apply.');
