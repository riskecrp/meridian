// Verify portal: signed revocable sessions (lib/verifySession.js), the verify
// actions, the OAuth callback / logout / impersonate routes and /api/notify.
import { createHmac } from 'node:crypto';
import { as, ok, eq, rejects, pass, captureDiscord, pings } from '../lib.mjs';
import { queryOne, run } from '../../../shared/db.js';
process.env.SESSION_SECRET = 'test-secret'; process.env.NOTIFY_SECRET = 'test-notify';
let discord = { roles: ['role-x'], memberOk: true };
const log = captureDiscord((e) => {
  const u = e.url;
  if (u.endsWith('/oauth2/token')) return { json: { access_token: 'at' } };
  if (u.endsWith('/users/@me')) return { json: { id: '424242424242424242', username: 'verifier', global_name: 'Verifier' } };
  const g = u.match(/\/users\/@me\/guilds\/(\d+)\/member$/);
  if (g) { discord.lastGuild = g[1]; return discord.memberOk ? { json: { roles: discord.roles, nick: 'Nick' } } : { status: 404, json: { message: 'Unknown Guild' } }; }
  return null;
});
const VS = await import('../../../dashboard/src/lib/verifySession.js');
const V = await import('../../../dashboard/src/app/verify/actions.js');
const CB = await import('../../../dashboard/src/app/api/auth/verify/callback/route.js');
const LO = await import('../../../dashboard/src/app/api/auth/verify-logout/route.js');
const IMP = await import('../../../dashboard/src/app/api/auth/verify-impersonate/route.js');
const N = await import('../../../dashboard/src/app/api/notify/route.js');
const L1 = '100000000000000001';
const jar = () => globalThis.__cookies;

// ── verifySession ──
const tok = VS.createVerifySession(L1, 'Guide One'); ok(typeof tok === 'string' && tok.includes('.'), 'token minted'); eq(queryOne('SELECT discord_id FROM verify_sessions').discord_id, L1, 'row stored');
{ const v = VS.validateVerifySession(tok); ok(v && v.discord_id === L1 && v.jti, 'validate'); }
eq(VS.validateVerifySession(tok.slice(0, -2) + 'zz'), null, 'tampered signature'); eq(VS.validateVerifySession('eyJ4IjoxfQ.' + tok.split('.')[1]), null, 'tampered payload'); eq(VS.validateVerifySession('garbage'), null, 'garbage');
{ process.env.SESSION_SECRET = 'fallback'; let err; try { VS.createVerifySession(L1, 'x'); } catch (e) { err = e; } process.env.SESSION_SECRET = 'test-secret'; ok(err && /SESSION_SECRET/.test(err.message), 'refuses the fallback secret'); }
{ delete process.env.SESSION_SECRET; let err; try { VS.createVerifySession(L1, 'x'); } catch (e) { err = e; } ok(err, 'refuses an unset secret'); eq(VS.validateVerifySession(tok), null, 'validate with unset secret → null'); process.env.SESSION_SECRET = 'test-secret'; }
{ const p = Buffer.from(JSON.stringify({ discord_id: L1, discord_name: 'x', exp: Date.now() - 1000, jti: 'abc' })).toString('base64url'); const sig = createHmac('sha256', 'test-secret').update(p).digest('base64url'); eq(VS.validateVerifySession(`${p}.${sig}`), null, 'expired token'); }
eq(VS.revokeVerifySession(tok), true, 'revoke'); eq(VS.validateVerifySession(tok), null, 'revoked token invalid'); eq(VS.revokeVerifySession('nope'), false, 'revoke bad token'); pass('verifySession');

// ── verify actions ──
const tok2 = VS.createVerifySession(L1, 'Guide One');
globalThis.__cookies = {}; eq(await V.getVerifySession(), null, 'no cookie'); await rejects(() => V.getVerifyActivity(2026, 11), 'AUTH_REQUIRED', 'activity without cookie');
globalThis.__cookies = { meridian_session: 'tok-owner' }; await rejects(() => V.getVerifyActivity(2026, 11), 'AUTH_REQUIRED', 'FM session alone grants nothing');
globalThis.__cookies = { meridian_verify_session: tok2 }; eq((await V.getVerifySession())?.discord_id, L1, 'verify session read');
{ const r = await V.getVerifyActivity(2026, 11); const g = r.find(m => m.discord_id === L1), l = r.find(m => m.discord_id === '100000000000000002');
  ok(g?.scenes === 2 && l?.scenes === 2 && l?.meetings === 1, 'activity counts'); ok(r.find(m => m.discord_id === '738214924760907907')?.category === 'moderator' && g.category === 'support', 'category from clearance'); ok(!r.some(m => m.discord_id.startsWith('placeholder')), 'placeholder excluded'); }
eq((await V.getVerifyActivity('2026', '11')).find(m => m.discord_id === L1)?.scenes, 2, 'string year/month'); eq((await V.getVerifyActivity(2026, 10)).find(m => m.discord_id === L1)?.hours, 12.5, 'hours for 2026-10');
eq((await V.getVerifyActivity(2026, 13)).length, 0, 'month 13'); eq((await V.getVerifyActivity(NaN, 1)).length, 0, 'NaN year');
{ const r = await V.getVerifyScenes(2026, 11); ok(r.length === 3 && r.find(s => s.id === 1)?.assistants?.[0] === 'Lead Two', 'scenes with assistants'); }
{ const r = await V.getVerifyMeetings(2026, 11); ok(r.length === 1 && !('text' in r[0]) && !('content' in r[0]) && r[0].label === 'The Vanguard', 'meetings without minutes'); }
eq(typeof V.getVerifyNotes, 'undefined', 'getVerifyNotes removed'); pass('verify actions');

// ── OAuth callback ──
const req = (code = 'abc') => ({ headers: new Headers({ host: 'localhost:3000' }), nextUrl: { searchParams: new URLSearchParams(code ? { code } : {}) } });
const loc = (r) => r.headers.get('location');
globalThis.__cookies = {}; delete process.env.VERIFY_ROLE_ID; delete process.env.VERIFY_GUILD_ID;
ok(/error=no_code/.test(loc(await CB.GET(req('')))), 'no code'); ok(/error=not_configured/.test(loc(await CB.GET(req()))), 'VERIFY_ROLE_ID unset → not_configured');
process.env.VERIFY_ROLE_ID = 'role-x';
{ const r = await CB.GET(req()); ok(discord.lastGuild === '1371212587705958562' && /\/verify$/.test(loc(r)), 'guild falls back to the literal'); ok(jar().meridian_verify_session && queryOne("SELECT 1 FROM verify_sessions WHERE discord_id='424242424242424242'"), 'cookie + row'); }
process.env.VERIFY_GUILD_ID = '555555555555555555'; globalThis.__cookies = {};
{ const r = await CB.GET(req()); ok(discord.lastGuild === '555555555555555555' && /\/verify$/.test(loc(r)), 'guild from env'); eq(VS.validateVerifySession(jar().meridian_verify_session)?.discord_name, 'Nick', 'nick as display name'); }
discord = { roles: ['other'], memberOk: true }; globalThis.__cookies = {}; { const r = await CB.GET(req()); ok(/error=no_role/.test(loc(r)) && !jar().meridian_verify_session, 'member without role'); }
discord = { roles: [], memberOk: false }; ok(/error=unauthorized/.test(loc(await CB.GET(req()))), 'non-member');
discord = { roles: ['role-x'], memberOk: true }; { delete process.env.SESSION_SECRET; const r = await CB.GET(req()); process.env.SESSION_SECRET = 'test-secret'; ok(/error=server_error/.test(loc(r)) && !jar().meridian_verify_session, 'unset secret → server_error, no cookie'); }
globalThis.__cookies = {}; await CB.GET(req()); const live = jar().meridian_verify_session; ok(!!VS.validateVerifySession(live), 'token valid before logout');
{ const r = await LO.GET({ headers: new Headers({ host: 'localhost:3000' }) }); ok(/\/verify\/login$/.test(loc(r)) && !jar().meridian_verify_session, 'logout clears cookie'); eq(VS.validateVerifySession(live), null, 'logout revokes server-side'); }
ok(/\/verify\/login$/.test(loc(await LO.GET({ headers: new Headers({ host: 'localhost:3000' }) }))), 'logout without cookie');
globalThis.__cookies = { meridian_session: 'tok-l3' }; { const r = await IMP.GET({ headers: new Headers({ host: 'localhost:3000' }) }); ok(/\/v2$/.test(loc(r)) && !jar().meridian_verify_session, 'impersonate: non-owner → /v2'); }
globalThis.__cookies = { meridian_session: 'tok-owner' }; { const r = await IMP.GET({ headers: new Headers({ host: 'localhost:3000' }) }); ok(/\/verify$/.test(loc(r)) && VS.validateVerifySession(jar().meridian_verify_session)?.discord_id === '738214924760907907', 'impersonate: owner gets a revocable verify session'); } pass('oauth / logout / impersonate');

// ── /api/notify ──
const nreq = (body, secret = 'test-notify') => ({ headers: new Headers(secret ? { 'x-notify-secret': secret } : {}), json: async () => { if (body === 'bad') throw new Error('x'); return body; } });
const call = async (body, secret) => { const res = await N.POST(nreq(body, secret)); return { status: res.status, body: await res.json() }; };
eq((await call({ formType: 'faction_feedback' }, null)).status, 401, 'no secret'); eq((await call({ formType: 'faction_feedback' }, 'nope')).status, 401, 'wrong secret');
{ delete process.env.NOTIFY_SECRET; const r = await call({ formType: 'x' }, ''); process.env.NOTIFY_SECRET = 'test-notify'; eq(r.status, 401, 'env secret unset → 401'); }
eq((await call('bad')).status, 400, 'bad json'); eq((await call({ formType: 'zzz' })).status, 400, 'unknown formType');
{ const r = await call({ formType: 'rcf_application' }); ok(r.status === 200 && r.body.handled_by, 'polled form acknowledged'); }
eq((await call({ formType: 'faction_feedback', department: 'X', entryName: 'Y' })).status, 400, 'unknown department'); eq((await call({ formType: 'faction_feedback', department: 'Criminal Faction Management (FM)' })).status, 400, 'no entryName');
log.length = 0; { const r = await call({ formType: 'faction_feedback', department: 'Criminal Faction Management (FM)', entryName: 'The Vanguard' }); ok(r.status === 200 && r.body.ok, 'FM route (muted in seed) still 200'); }
log.length = 0; { const r = await call({ formType: 'faction_feedback', department: 'Legal Faction Management (LFM)', entryName: 'Some Faction' }); ok(r.status === 200 && pings(log).length === 1 && !r.body.task, 'LFM route pings, no task'); }
run(`UPDATE ping_routes SET enabled=1, mention_roles='["900000000000000001"]' WHERE key='form.faction_feedback.fm'`); log.length = 0;
const r3 = await call({ formType: 'faction_feedback', department: 'Criminal Faction Management (FM)', entryName: '<@&123> Hacker' });
{ const p = pings(log); ok(r3.status === 200 && r3.body.task && p.length === 2 && p[1].comps[0] === `tsk:claim:${r3.body.task}`, 'FM route with leadership mention → ping + leadership task'); }
{ const t = queryOne('SELECT * FROM tasks WHERE task_uid=?', [r3.body.task]); ok(t && t.created_by_name === 'System' && /^\d{4}-\d{2}-\d{2}T/.test(t.created_at) && t.target_id === '900000000000000001' && t.status === 'open', 'task row by System'); }
{ const a = queryOne("SELECT actor_name, target_id FROM site_audit_log WHERE target_type='task' ORDER BY id DESC LIMIT 1"); ok(a.actor_name === 'System' && a.target_id === r3.body.task, 'task audited'); } pass('/api/notify');
