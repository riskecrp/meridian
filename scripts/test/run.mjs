#!/usr/bin/env node
// Functional tests. Builds a throwaway database (schema.sql + migrations +
// scripts/test/seed.mjs), then runs every scripts/test/cases/*.test.mjs in its
// own process with the harness loader. Never touches the live database.
//   node scripts/test/run.mjs            all cases
//   node scripts/test/run.mjs tasks      cases whose filename contains "tasks"
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { bootstrap } from '../bootstrap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(HERE));
const filter = process.argv[2] || '';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'meridian-test-'));
const base = path.join(tmp, 'base.db');

const db = new Database(base);
db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
const realLog = console.log; console.log = () => {};          // migrations narrate; tests do not need it
try { await bootstrap(db, { log: () => {} }); } finally { console.log = realLog; }
db.close();
let r = spawnSync(process.execPath, [path.join(HERE, 'seed.mjs'), base], { stdio: 'inherit' });
if (r.status !== 0) { console.error('seed failed'); process.exit(1); }

const cases = readdirSync(path.join(HERE, 'cases')).filter(f => f.endsWith('.test.mjs') && f.includes(filter)).sort();
let failed = 0;
for (const f of cases) {
  const dbPath = path.join(tmp, f.replace(/\W/g, '_') + '.db');
  copyFileSync(base, dbPath);                       // every case starts from the same seed
  console.log(`\n== ${f}`);
  r = spawnSync(process.execPath, ['--import', path.join(HERE, 'harness', 'register.mjs'), path.join(HERE, 'cases', f)], {
    stdio: 'inherit', cwd: path.join(ROOT, 'dashboard'),
    env: { ...process.env, DATABASE_PATH: dbPath, DISCORD_BOT_TOKEN: '' },
  });
  if (r.status !== 0) { failed++; console.error(`!! ${f} failed`); }
}
rmSync(tmp, { recursive: true, force: true });
console.log(`\n${cases.length - failed}/${cases.length} test files passed`);
process.exit(failed ? 1 : 0);
