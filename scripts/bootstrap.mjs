#!/usr/bin/env node
// Build a brand-new Meridian database with no backup to start from.
//
//   DATABASE_PATH=./data/meridian.db node scripts/bootstrap.mjs
//
// 1. Creates every table, index and view from schema.sql (the reference dump,
//    with the dump-only sqlite_sequence line skipped).
// 2. Replays the DATA part of every migration — ping routes, sync jobs, the
//    peds catalogue, role rows — skipping the structural statements schema.sql
//    already carries, then marks every migration applied.
// 3. Seeds the configuration keys the code reads (discord_roles, discord_config)
//    with empty values so Admin → Discord & Access can fill them in.
// Refuses to touch a database that already has tables.
import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listMigrations } from './migrate.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data', 'meridian.db');

export async function bootstrap(db, { log = console.log } = {}) {
  const tables = db.prepare("SELECT count(*) n FROM sqlite_master WHERE type = 'table' AND name NOT IN ('_migrations', 'sqlite_sequence')").get().n;
  if (tables > 0) throw new Error('database already has tables; use scripts/migrate.mjs');
  const schema = readFileSync(path.join(root, 'schema.sql'), 'utf8').split('\n')
    .filter(l => !l.startsWith('CREATE TABLE sqlite_sequence')).join('\n');
  db.exec(schema);
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const mark = db.prepare('INSERT OR IGNORE INTO _migrations (name) VALUES (?)');
  for (const f of listMigrations()) {
    db.exec('BEGIN');
    try {
      if (f.endsWith('.sql')) {
        // Data only: schema.sql already has every table and column.
        const sql = readFileSync(path.join(root, 'migrations', f), 'utf8').split('\n')
          .filter(l => !/^\s*ALTER TABLE/i.test(l)).join('\n');
        db.exec(sql);
      } else {
        const mod = await import(pathToFileURL(path.join(root, 'migrations', f)).href);
        await mod.default(db);   // every .mjs migration is idempotent on an empty database
      }
      mark.run(f);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw new Error(`bootstrap: ${f}: ${e.message}`); }
  }
  // Configuration keys the code reads. Values are filled in from the dashboard.
  const roles = ['fm_leadership', 'fm_team_lead', 'fm_team_guide', 'game_affairs', 'founder', 'executive_admin', 'event_team', 'lead_storyteller', 'lfm'];
  const ins = db.prepare("INSERT OR IGNORE INTO discord_roles (key, role_id, description) VALUES (?, '', ?)");
  for (const k of roles) ins.run(k, `Discord role: ${k.replace(/_/g, ' ')}`);
  const chans = [['global_ping_channel', 'General FM announcements'], ['event_announce_channel', 'Scheduled event announcements'], ['leadership_channel', 'FM Leadership private channel'], ['team_lead_channel', 'Team Lead private channel']];
  const insC = db.prepare("INSERT OR IGNORE INTO discord_config (key, channel_id, description) VALUES (?, '', ?)");
  for (const [k, d] of chans) insC.run(k, d);
  log(`bootstrapped ${dbPath}: ${db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n} tables, ${db.prepare('SELECT count(*) n FROM ping_routes').get().n} ping routes, ${db.prepare('SELECT count(*) n FROM peds').get().n} peds`);
  log('Next: set RISK_DISCORD_ID in .env, log in once to create your staff row, then fill Admin → Discord & Access.');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!existsSync(path.dirname(dbPath))) mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  try { await bootstrap(db); } catch (e) { console.error(e.message); process.exit(1); }
}
