#!/usr/bin/env node
// Applies migrations/NNN_*.sql and migrations/NNN_*.mjs exactly once each, in
// filename order. Applied filenames are tracked in the _migrations table.
//   .sql  — plain SQL, executed as one script (no BEGIN/COMMIT inside it)
//   .mjs  — `export default function (db) {…}` for changes that need code
//           (date conversions, backfills); runs inside the same transaction
// Each file runs in its own transaction; the first failure stops the run with
// the database as it was before that file.
//
// A database with no tables is not migrated: run scripts/bootstrap.mjs first,
// which builds it from schema.sql and seeds what the migrations would have.
import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data', 'meridian.db');
const dir = path.join(root, 'migrations');

export function listMigrations() {
  return readdirSync(dir).filter(f => /^\d+_.+\.(sql|mjs)$/.test(f)).sort();
}

export async function applyMigrations(db, { log = console.log } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
  let ran = 0;
  for (const f of listMigrations()) {
    if (applied.has(f)) continue;
    db.exec('BEGIN');
    try {
      if (f.endsWith('.sql')) {
        db.exec(readFileSync(path.join(dir, f), 'utf8'));
      } else {
        const mod = await import(pathToFileURL(path.join(dir, f)).href);
        await mod.default(db);
      }
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
      db.exec('COMMIT');
      log(`applied ${f}`);
      ran++;
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`FAILED ${f}: ${e.message}`);
    }
  }
  return ran;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');
  const tables = db.prepare("SELECT count(*) n FROM sqlite_master WHERE type = 'table' AND name NOT IN ('_migrations', 'sqlite_sequence')").get().n;
  if (tables === 0) {
    console.error(`${dbPath} has no tables. For a fresh copy run: node scripts/bootstrap.mjs`);
    process.exit(1);
  }
  try {
    const ran = await applyMigrations(db);
    console.log(ran ? `${ran} migration(s) applied.` : 'Nothing to apply.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
