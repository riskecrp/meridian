// Handover exports: the actions (listTables, getTableExport), the export lib
// (CSV formula guard, redaction of a database copy) and the /api/handover route.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { as, ok, eq, rejects, pass } from '../lib.mjs';
import { getDb, query, queryOne, run } from '../../../shared/db.js';
const H = await import('../../../dashboard/src/app/fm/handover/actions.js');
const X = await import('../../../dashboard/src/lib/handoverExport.js');
const C = await import('../../../dashboard/src/lib/handoverContent.js');
const R = await import('../../../dashboard/src/app/api/handover/route.js');
const TOKENS = ['tok-l3', 'tok-owner', 'tok-l2', 'tok-l1', 'tok-et', 'tok-lst', 'tok-expired'];
const auditCount = () => queryOne('SELECT COUNT(*) c FROM site_audit_log').c;

// ── actions ──
eq(Object.keys(H).sort().join(), 'getTableExport,listTables', 'only the two scoped exports (no full dump action)');
as('tok-l3'); { const t = await H.listTables(); const all = X.realTableNames();
  ok(t.length === all.length && t.filter(x => x.core).length > 0 && t.some(x => !x.core), 'every real table listed, core and transient'); eq(t.filter(x => x.redacted).map(x => x.name).sort().join(), 'mdb_sessions,sessions', 'token tables flagged redacted');
  ok(X.isCore('pending_executions') && X.isCore('managed_forum_posts'), 'pipeline + forum posts are core'); eq([...X.TRANSIENT].filter(n => !all.includes(n)).length, 0, 'TRANSIENT names exist');
  // have no TABLE_DOCS entry in dashboard/src/lib/handoverContent.js, so `all.filter(n => !C.TABLE_DOCS[n])` is not empty.
  ok(all.every(n => C.TABLE_DOCS[n]), `every table documented (missing: ${all.filter(n => !C.TABLE_DOCS[n]).join(', ') || 'none'})`);
  eq(Object.keys(C.TABLE_DOCS).filter(n => !all.includes(n)).length, 0, 'no stale docs'); }
for (const t of ['tok-l2', 'tok-et', 'tok-lst']) { as(t); await rejects(() => H.listTables(), 'AUTH_INSUFFICIENT', `listTables ${t}`); } as('tok-expired'); await rejects(() => H.listTables(), 'AUTH_REQUIRED', 'listTables expired');
as('tok-l3'); { const r = await H.getTableExport('factions', 'csv', 0); ok(r.returned === 4 && r.total === 4 && !r.truncated && r.downloadUrl === '/api/handover?what=table&name=factions' && r.text.startsWith('id,name,lead_discord_id'), 'factions csv'); }
{ const r = await H.getTableExport('factions', 'json', 2); ok(r.returned === 2 && r.total === 4 && r.truncated, 'json with limit'); }
ok((await H.getTableExport('sessions', 'csv', 0)).text.split('\n').slice(1).every(l => l.includes('«redacted»') && !/tok-/.test(l)), 'session tokens redacted in csv');
await rejects(() => H.getTableExport('nope', 'csv', 0), null, 'unknown table'); await rejects(() => H.getTableExport('factions"; DROP TABLE factions; --', 'csv', 0), null, 'injection in name');
eq((await H.getTableExport('factions', 'csv', 'abc')).returned, 4, 'bad limit → cap'); { const r = await H.getTableExport('site_audit_log', 'csv', 999999); eq(r.returned, r.total, 'huge limit capped, all rows fit'); }
ok((await H.getTableExport('factions', 'xml', 1)).text.startsWith('id,name'), 'bogus format → csv'); as('tok-l2'); await rejects(() => H.getTableExport('factions', 'csv', 0), 'AUTH_INSUFFICIENT', 'export L2'); pass('actions');

// ── export lib ──
eq(JSON.stringify(['=SUM(A1)', '+1', '-1', '@x', '\tx', 'ok', '12', '-', null, 'a,b', 'say "hi"'].map(X.csvCell)), JSON.stringify(["'=SUM(A1)", "'+1", "'-1", "'@x", "'\tx", 'ok', '12', "'-", '', '"a,b"', '"say ""hi"""']), 'csv formula guard + quoting');
ok(/CREATE (UNIQUE )?INDEX/.test(X.schemaSql()) && /CREATE VIEW/.test(X.schemaSql()), 'schemaSql includes indexes and views'); ok(!('sqlLiteral' in X) && !('tableSql' in X), 'SQL-literal helpers gone');
run("INSERT INTO mdb_sessions (token, discord_id, discord_name, expires_at) VALUES ('mdb-secret-abc', '1', 'x', '2099-01-01')");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-handover-test-')); const copyPath = path.join(tmp, 'redact.db'); getDb().prepare('VACUUM INTO ?').run(copyPath);
{ const copy = new Database(copyPath); copy.exec("CREATE TABLE api_keys (id INTEGER PRIMARY KEY, service TEXT, api_key TEXT, secret_hash TEXT, note TEXT)"); copy.exec("INSERT INTO api_keys (service, api_key, secret_hash, note) VALUES ('imgbb', 'IMGBB-KEY-123', 'HASH-456', 'keep me')");
  const redacted = X.redactDatabaseCopy(copy); eq(JSON.stringify(redacted), JSON.stringify({ sessions: ['token'], mdb_sessions: ['token'], api_keys: ['api_key', 'secret_hash'] }), 'redaction map covers token/key/secret columns');
  ok(copy.prepare('SELECT token FROM sessions').all().every(r => /^redacted-\d+$/.test(r.token)) && copy.prepare('SELECT token FROM mdb_sessions').all().every(r => /^redacted-/.test(r.token)), 'tokens replaced'); eq(copy.prepare('SELECT note FROM api_keys').get().note, 'keep me', 'non-secret columns kept'); eq(copy.pragma('integrity_check')[0].integrity_check, 'ok', 'copy intact'); copy.close();
  const raw = fs.readFileSync(copyPath).toString('latin1'); eq(['tok-l3', 'tok-owner', 'tok-et', 'tok-lst', 'tok-expired', 'mdb-secret-abc', 'IMGBB-KEY-123', 'HASH-456'].filter(s => raw.includes(s)).length, 0, 'no secret bytes left in the copy');
  eq(queryOne("SELECT COUNT(*) c FROM sessions WHERE token LIKE 'tok-%'").c, 7, 'live db untouched'); } pass('export lib');

// ── /api/handover ──
const req = (qs) => new Request(`http://localhost:3000/api/handover${qs}`, { headers: { host: 'localhost:3000' } });
function zipEntries(buf) { const out = {}; let off = 0; while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) { const method = buf.readUInt16LE(off + 8), csize = buf.readUInt32LE(off + 18), nlen = buf.readUInt16LE(off + 26), xlen = buf.readUInt16LE(off + 28); const name = buf.toString('utf8', off + 30, off + 30 + nlen); const data = buf.subarray(off + 30 + nlen + xlen, off + 30 + nlen + xlen + csize); out[name] = method === 8 ? zlib.inflateRawSync(data).toString('utf8') : data.toString('utf8'); off += 30 + nlen + xlen + csize; } return out; }
as('tok-l3'); const a0 = auditCount();
{ const res = await R.GET(req('?what=sheets')); ok(res.status === 200 && res.headers.get('content-type') === 'application/zip' && /meridian-sheets-core-.*\.zip/.test(res.headers.get('content-disposition')), 'sheets zip headers');
  const z = zipEntries(Buffer.from(await res.arrayBuffer())); ok(!('sessions.csv' in z) && 'pending_executions.csv' in z && 'managed_forum_posts.csv' in z && 'README.txt' in z && 'TABLES.csv' in z, 'core bundle: transient tables excluded, core included');
  ok(/SAFETY/.test(z['README.txt']) && /blanked/.test(z['README.txt']), 'README explains quoting + redaction'); ok(/CREATE (UNIQUE )?INDEX/.test(z['schema.sql']) && /CREATE VIEW/.test(z['schema.sql']), 'schema.sql in bundle');
  const all = zipEntries(Buffer.from(await (await R.GET(req('?what=sheets&scope=all'))).arrayBuffer())); ok(Object.keys(all).length > Object.keys(z).length && 'sessions.csv' in all, 'scope=all adds transient tables'); }
run("INSERT OR IGNORE INTO mdb_sessions (token, discord_id, discord_name, expires_at) VALUES ('mdb-secret-route', '1', 'x', '2099-01-01')");
{ const res = await R.GET(req('?what=db')); const buf = Buffer.from(await res.arrayBuffer()); ok(res.status === 200 && res.headers.get('content-type') === 'application/vnd.sqlite3' && String(buf.length) === res.headers.get('content-length'), 'db copy headers + length');
  const p = path.join(tmp, 'copy.db'); fs.writeFileSync(p, buf); const copy = new Database(p, { readonly: true });
  ok(copy.pragma('integrity_check')[0].integrity_check === 'ok' && copy.prepare('SELECT COUNT(*) c FROM factions').get().c === 4 && copy.prepare('SELECT COUNT(*) c FROM sessions').get().c === 7, 'copy is a valid db with data'); ok(copy.prepare('SELECT token FROM sessions').all().every(r => /^redacted-/.test(r.token)) && copy.prepare('SELECT token FROM mdb_sessions').all().every(r => /^redacted-/.test(r.token)), 'tokens blanked in the copy'); copy.close();
  eq(['tok-l3', 'tok-owner', 'tok-l2', 'tok-l1', 'tok-et', 'tok-lst', 'tok-expired', 'mdb-secret-route'].filter(s => buf.toString('latin1').includes(s)).length, 0, 'no live token bytes'); eq(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('meridian-handover-') && !f.startsWith('meridian-handover-test-')).length, 0, 'no temp files left behind'); }
{ const res = await R.GET(req('?what=table&name=factions')); ok(res.status === 200 && /text\/csv/.test(res.headers.get('content-type')) && (await res.text()).startsWith('id,name,lead_discord_id'), 'single table csv'); }
ok((await (await R.GET(req('?what=table&name=sessions'))).text()).split('\n')[1].includes('«redacted»'), 'single table redacted'); eq((await R.GET(req('?what=table&name=nope'))).status, 404, 'unknown table 404'); eq((await R.GET(req('?what=table'))).status, 404, 'no name 404');
{ const res = await R.GET(req('?what=code')); ok(res.status === 403 && /site owner only/.test(await res.text()), 'code download is owner-only'); }
as('tok-owner'); { const res = await R.GET(req('?what=code')); ok(res.status === 200 || (res.status >= 500 && /git/.test(await res.text())), 'owner code download: zip, or a clear "not a git checkout" error'); }
as('tok-l3'); eq((await R.GET(req('?what=bogus'))).status, 400, 'unknown export 400');
ok(query('SELECT details FROM site_audit_log WHERE id > ?', [a0]).some(r => /Downloaded database copy/.test(r.details)) && query('SELECT details FROM site_audit_log WHERE id > ?', [a0]).some(r => /CSV bundle/.test(r.details)), 'downloads audited');
as('tok-l2'); eq((await R.GET(req('?what=db'))).status, 403, 'L2 db'); as('tok-et'); eq((await R.GET(req('?what=db'))).status, 403, 'ET db'); as('tok-lst'); eq((await R.GET(req('?what=db'))).status, 403, 'LST db');
as('tok-expired'); { const res = await R.GET(req('?what=db')); ok(res.status === 307 && /\/login$/.test(res.headers.get('location')), 'expired → login redirect'); } as('tok-owner', '100000000000000001'); eq((await R.GET(req('?what=db'))).status, 403, 'owner view-as L1 is gated');
fs.rmSync(tmp, { recursive: true, force: true }); pass('/api/handover');
