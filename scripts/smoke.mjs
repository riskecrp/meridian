#!/usr/bin/env node
/**
 * Pre-restart smoke test. Exit code 0 means it is safe to restart the services.
 *
 *     cd /opt/meridian && node scripts/smoke.mjs
 *     cd /opt/meridian && node scripts/smoke.mjs --build   # also runs next build
 *     cd /opt/meridian && node scripts/smoke.mjs --no-build-check
 *
 * deploy.sh runs it with --no-build-check before it migrates, because at that
 * point the source is legitimately newer than the build — the build it is about
 * to run is what fixes that. Run it bare (no flags) when you are restarting
 * without deploying, which is when a stale build actually matters.
 *
 * Why this exists: bot/index.js loads every file in bot/commands/ with a bare
 * `await import()` and no try/catch, so one broken command file throws during
 * startup and the process exits. With Restart=always and RestartSec=5 that is a
 * crash loop, and nothing catches it before the restart. The dashboard has
 * `next build` as a gate; the bot had nothing.
 *
 * What it checks, without connecting to Discord and without touching the live
 * database:
 *
 *   1. Syntax   — every bot file parses.
 *   2. Imports  — every bot module resolves its imports and loads, and every
 *                 command exposes the shape index.js requires at boot.
 *   3. Migrations — all migrations apply cleanly to a throwaway copy of the
 *                 live database, so a broken one is found here rather than in
 *                 production.
 *   4. Dashboard — server-side lib modules load, and the compiled build is not
 *                 older than the source you are about to restart into.
 *
 * Safety: every phase runs in its own child process with DATABASE_PATH pointed
 * at a temp copy and DISCORD_BOT_TOKEN replaced with a dummy, so even an
 * accidental REST call cannot authenticate. Children run with the same working
 * directory their systemd unit uses. index.js itself is never imported — it
 * calls client.login() at module level — so it gets the syntax check only.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BOT = path.join(ROOT, 'bot');
const DASH = path.join(ROOT, 'dashboard');
const LIVE_DB = process.env.DATABASE_PATH || path.join(ROOT, 'data', 'meridian.db');
const PHASE_TIMEOUT = 120_000;
const WITH_BUILD = process.argv.includes('--build');
const SKIP_BUILD_CHECK = process.argv.includes('--no-build-check');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'meridian-smoke-'));
const TMP_DB = path.join(tmp, 'meridian.db');

// A dummy token, so nothing this test imports can talk to Discord as us even by
// accident. DATABASE_PATH is redirected before any child opens a connection.
const CHILD_ENV = { ...process.env, DATABASE_PATH: TMP_DB, DISCORD_BOT_TOKEN: 'smoke-test-dummy-token' };

let failures = 0;
const results = [];
const say = (s) => process.stdout.write(s + '\n');
const pass = (name, detail = '') => { results.push({ name, ok: true, detail }); say(`  ok    ${name}${detail ? ' — ' + detail : ''}`); };
const fail = (name, detail) => { failures++; results.push({ name, ok: false, detail }); say(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); };

const botFiles = () => {
  const out = [];
  for (const dir of [BOT, path.join(BOT, 'lib'), path.join(BOT, 'commands')]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      // .bak copies are kept around deliberately and are not loaded by anything.
      if (f.endsWith('.js') && !f.includes('.bak')) out.push(path.join(dir, f));
    }
  }
  return out.sort();
};

// ── 1. Syntax ────────────────────────────────────────────────────────────────
say('\n[1/4] Syntax — every bot file parses');
{
  const files = botFiles();
  const bad = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { cwd: BOT, encoding: 'utf8', timeout: 20_000 });
    if (r.status !== 0) bad.push(`${path.relative(ROOT, f)}: ${(r.stderr || '').split('\n').find(l => l.includes('Error')) || 'parse failed'}`);
  }
  if (bad.length) bad.forEach(b => fail('syntax', b));
  else pass('syntax', `${files.length} files`);
}

// ── 2. Imports + command shape ───────────────────────────────────────────────
say('\n[2/4] Imports — modules resolve and commands have the shape index.js needs');
{
  // Runs in a child: importing schedules cron timers and opens the database, and
  // this way none of that outlives the check.
  const probe = `
    import { readdirSync } from 'node:fs';
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    const BOT = ${JSON.stringify(BOT)};
    const skip = new Set(['index.js']);   // calls client.login() at module level
    const names = new Map();
    let bad = 0;
    const dirs = [['', BOT], ['lib', path.join(BOT, 'lib')], ['commands', path.join(BOT, 'commands')]];
    for (const [label, dir] of dirs) {
      for (const f of readdirSync(dir).filter(f => f.endsWith('.js') && !f.includes('.bak')).sort()) {
        if (!label && skip.has(f)) { console.log('SKIP ' + f + ' (logs in at import)'); continue; }
        const rel = label ? label + '/' + f : f;
        try {
          const mod = await import(pathToFileURL(path.join(dir, f)).href);
          if (label === 'commands') {
            const d = mod.default;
            if (!d?.data || typeof d?.execute !== 'function') throw new Error('missing default.data or default.execute');
            const json = d.data.toJSON();          // index.js does this at boot
            if (!json?.name) throw new Error('command has no name');
            if (names.has(json.name)) throw new Error('duplicate command name "' + json.name + '" (also in ' + names.get(json.name) + ')');
            names.set(json.name, f);
          }
          console.log('OK ' + rel);
        } catch (e) { bad++; console.log('BAD ' + rel + ' :: ' + (e.message || e)); }
      }
    }
    console.log('DONE commands=' + names.size + ' bad=' + bad);
    process.exit(bad ? 1 : 0);   // explicit: cron timers would otherwise hold the loop open
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe],
    { cwd: BOT, env: CHILD_ENV, encoding: 'utf8', timeout: PHASE_TIMEOUT });
  const lines = (r.stdout || '').trim().split('\n').filter(Boolean);
  const bad = lines.filter(l => l.startsWith('BAD '));
  const done = lines.find(l => l.startsWith('DONE '));
  bad.forEach(b => fail('import', b.slice(4)));
  if (!done) {
    // Died mid-run: the last line names whatever it was loading.
    fail('import', `probe exited ${r.status} before finishing. last: ${lines[lines.length - 1] || '(no output)'} ${(r.stderr || '').trim().split('\n')[0] || ''}`);
  } else if (!bad.length) {
    pass('imports', `${lines.filter(l => l.startsWith('OK ')).length} modules, ${done.match(/commands=(\d+)/)?.[1]} commands registered cleanly`);
  }
}

// ── 3. Migrations against a throwaway copy of the live database ──────────────
say('\n[3/4] Migrations — apply cleanly to a copy of the live database');
{
  if (!existsSync(LIVE_DB)) {
    fail('migrations', `live database not found at ${LIVE_DB}`);
  } else {
    try {
      // .backup rather than a file copy: consistent even with WAL mid-write.
      const src = new Database(LIVE_DB, { readonly: true });
      await src.backup(TMP_DB);
      src.close();
      pass('snapshot', `copied ${(statSync(TMP_DB).size / 1048576).toFixed(1)} MB to a temp file`);

      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate.mjs')],
        { cwd: ROOT, env: CHILD_ENV, encoding: 'utf8', timeout: PHASE_TIMEOUT });
      if (r.status !== 0) {
        fail('migrations', ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-3).join(' | '));
      } else {
        pass('migrations', (r.stdout || '').trim().split('\n').pop());
      }

      // Drift is a warning, not a failure: schema.sql is a generated artefact and
      // lagging behind is untidy rather than dangerous.
      const live = new Database(TMP_DB, { readonly: true });
      const tables = live.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n;
      live.close();
      const committed = existsSync(path.join(ROOT, 'schema.sql'))
        ? (execFileSync('grep', ['-c', '^CREATE TABLE', path.join(ROOT, 'schema.sql')], { encoding: 'utf8' }).trim())
        : '0';
      if (Number(committed) !== tables) {
        say(`  warn  schema.sql lists ${committed} tables, the migrated database has ${tables} — regenerate it: sqlite3 data/meridian.db .schema`);
      } else {
        pass('schema.sql', `in step with the database (${tables} tables)`);
      }
    } catch (e) {
      fail('migrations', e.message);
    }
  }
}

// ── 4. Dashboard ─────────────────────────────────────────────────────────────
say('\n[4/4] Dashboard — server libs load, compiled build is current');
{
  const libDir = path.join(DASH, 'src', 'lib');
  // Only the modules that CAN load outside Next. A browser component or anything
  // reaching for next/* needs the framework's compiler and request context, and
  // importing one here fails for a reason that is not a bug.
  //
  // Decided by reading each file rather than by a list of names: a list is one
  // more thing to remember when a file is added, and forgetting shows up as a
  // false alarm that trains people to ignore this test.
  const frameworkOnly = (file) => {
    const src = readFileSync(path.join(libDir, file), 'utf8');
    return /^\s*["']use client["']/m.test(src)     // browser component
      || /from\s+["']next\//.test(src)             // next/headers, next/navigation…
      || /^\s*return\s*\(?\s*</m.test(src);        // returns JSX
  };
  const libs = existsSync(libDir)
    ? readdirSync(libDir).filter(f => f.endsWith('.js') && !frameworkOnly(f)).sort()
    : [];
  const probe = `
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    let bad = 0;
    for (const f of ${JSON.stringify(libs)}) {
      try { await import(pathToFileURL(path.join(${JSON.stringify(libDir)}, f)).href); console.log('OK ' + f); }
      catch (e) { bad++; console.log('BAD ' + f + ' :: ' + (e.message || e)); }
    }
    process.exit(bad ? 1 : 0);
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe],
    { cwd: DASH, env: CHILD_ENV, encoding: 'utf8', timeout: PHASE_TIMEOUT });
  const bad = (r.stdout || '').split('\n').filter(l => l.startsWith('BAD '));
  if (bad.length) bad.forEach(b => fail('dashboard lib', b.slice(4)));
  else pass('dashboard libs', `${libs.length} modules`);

  // Staleness, not correctness: `next build` is the only real JSX gate, and the
  // hazard in this deploy flow is restarting into a build that predates the
  // source. That is invisible at restart time and looks like "my change did
  // nothing".
  const buildId = path.join(DASH, '.next', 'BUILD_ID');
  if (SKIP_BUILD_CHECK) {
    say('  skip  dashboard build freshness (--no-build-check)');
  } else if (!existsSync(buildId)) {
    fail('dashboard build', 'no .next/BUILD_ID — the dashboard has never been built (start.sh guards on this)');
  } else {
    const built = statSync(buildId).mtimeMs;
    let newest = 0, newestFile = '';
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p); }
        else if (/\.(js|jsx|css|json)$/.test(e.name)) {
          const m = statSync(p).mtimeMs;
          if (m > newest) { newest = m; newestFile = path.relative(DASH, p); }
        }
      }
    };
    walk(path.join(DASH, 'src'));
    if (newest > built) {
      fail('dashboard build', `stale — ${newestFile} is newer than the build. Run: cd dashboard && npm run build`);
    } else {
      pass('dashboard build', `current (built ${new Date(built).toISOString().slice(0, 16).replace('T', ' ')})`);
    }
  }

  if (WITH_BUILD) {
    say('  ...running next build (this rewrites dashboard/.next)');
    const r2 = spawnSync('npm', ['run', 'build'], { cwd: DASH, encoding: 'utf8', timeout: 600_000 });
    if (r2.status !== 0) fail('next build', ((r2.stdout || '') + (r2.stderr || '')).trim().split('\n').slice(-5).join(' | '));
    else pass('next build', 'compiled');
  }
}

rmSync(tmp, { recursive: true, force: true });

say('\n' + '─'.repeat(64));
if (failures) {
  say(`FAILED — ${failures} problem${failures === 1 ? '' : 's'}. Do not restart until these are fixed.`);
  process.exit(1);
}
say(`PASSED — ${results.length} checks. Safe to restart.`);
if (!WITH_BUILD) say('Note: JSX/page code is only verified by `next build`. Pass --build to include it.');
process.exit(0);
