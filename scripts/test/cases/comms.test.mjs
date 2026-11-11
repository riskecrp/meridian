// Communications (dashboard/src/app/fm/communications/actions.js): announcement
// targets per clearance/team, fan-out with per-delivery logging, the FM mirror,
// IC communications and the imgbb upload helper.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
// Faction channel configs: cfg1 Vanguard command only; cfg2 Kings nothing; cfg3 Harbor faction-wide only; cfg4 archived Old Crew both; cfg5 orphan.
run("UPDATE bot_server_configs SET comms_channel_id='520000000000000010', comms_channel_name='#command' WHERE id=1");
run("INSERT INTO bot_server_configs (id, guild_id, guild_name, faction_id) VALUES (2,'500000000000000002','Kings Discord',2)");
run("INSERT INTO bot_server_configs (id, guild_id, guild_name, faction_id, faction_channel_id, faction_channel_name) VALUES (3,'500000000000000004','Harbor Discord',4,'520000000000000040','#harbor-general')");
run("INSERT INTO bot_server_configs (id, guild_id, guild_name, faction_id, comms_channel_id, comms_channel_name, faction_channel_id, faction_channel_name) VALUES (4,'500000000000000003','Old Crew Discord',3,'520000000000000030','#oc-cmd','520000000000000031','#oc-all')");
run("INSERT INTO bot_server_configs (id, guild_id, guild_name, faction_id, comms_channel_id) VALUES (5,'500000000000000099','Orphan Discord',NULL,'520000000000000099')");
let plan = {};
const log = captureDiscord((e) => { const id = e.url.match(/channels\/(\d+)\/messages/)?.[1] || e.url; const p = plan[id] || plan['*']; if (p?.throw) return new Error(p.throw); return p || null; });
const A = await import('../../../dashboard/src/app/fm/communications/actions.js');
const CMD1 = '520000000000000010', FW3 = '520000000000000040', FM = '1503178123993157633', ICFM = '1460432301878935725';
const chans = () => log.splice(0).filter(e => e.method === 'POST').map(e => e.url.match(/channels\/(\d+)\/messages/)?.[1] || e.url);
const lastLog = () => queryOne('SELECT * FROM announcement_log ORDER BY id DESC LIMIT 1');
const dels = (id) => query('SELECT faction_name, channel_type, ok, error FROM announcement_deliveries WHERE log_id=?', [id]);
const lastAudit = () => queryOne('SELECT action, target_type, target_id, target_label FROM site_audit_log ORDER BY id DESC LIMIT 1');
const counts = () => ({ log: queryOne('SELECT COUNT(*) c FROM announcement_log').c, del: queryOne('SELECT COUNT(*) c FROM announcement_deliveries').c, audit: queryOne('SELECT COUNT(*) c FROM site_audit_log').c, pub: queryOne('SELECT COUNT(*) c FROM faction_public_messages').c });

// ── targets ──
as('tok-l3'); { const t = await A.getAnnouncementTargets(); eq(t.map(x => x.config_id).sort().join(), '1,2,3', 'L3 sees every active faction config (not archived/orphan)'); ok(t.every(x => 'comms_channel_id' in x && 'faction_channel_id' in x), 'both channel columns present'); }
as('tok-l2'); eq((await A.getAnnouncementTargets()).map(x => x.config_id).join(), '1', 'L2 scoped to own team'); as('tok-owner', '100000000000000002'); eq((await A.getAnnouncementTargets()).map(x => x.config_id).join(), '1', 'owner view-as L2 scoped');
for (const t of ['tok-l1', 'tok-lst', 'tok-et']) { as(t); await rejects(() => A.getAnnouncementTargets(), 'AUTH_INSUFFICIENT', `targets ${t}`); } as('tok-expired'); await rejects(() => A.getAnnouncementTargets(), 'AUTH_REQUIRED', 'targets expired'); pass('targets');

// ── sendAnnouncement validation ──
as('tok-l3'); const before = counts(); process.env.DISCORD_BOT_TOKEN = '';
await failsWith(() => A.sendAnnouncement([1], 'Hello', false, 'command'), /token/i, 'no token'); process.env.DISCORD_BOT_TOKEN = 'test-token';
await failsWith(() => A.sendAnnouncement([1], '   ', false, 'command'), /empty/i, 'empty message'); await failsWith(() => A.sendAnnouncement([], 'Hello', false, 'command'), /recipients/i, 'no recipients'); await failsWith(() => A.sendAnnouncement({ length: 1, 0: 1 }, 'x', false, 'command'), /list/i, 'recipients must be an array');
as('tok-l2'); await failsWith(() => A.sendAnnouncement([1], 'x', true, 'command'), /L3/, 'L2 cannot post to FM');
for (const t of ['tok-l1', 'tok-lst', 'tok-et']) { as(t); await rejects(() => A.sendAnnouncement([1], 'Hello'), 'AUTH_INSUFFICIENT', `send ${t}`); } as('tok-expired'); await rejects(() => A.sendAnnouncement([1], 'Hello'), 'AUTH_REQUIRED', 'send expired');
as('tok-l3'); plan = {};
await failsWith(() => A.sendAnnouncement([1, 999], 'x', false, 'command'), /not a faction you can message/, 'unknown id'); await failsWith(() => A.sendAnnouncement([4], 'x', false, 'command'), /archived|not a faction/, 'archived config'); await failsWith(() => A.sendAnnouncement([5], 'x', false, 'command'), /not a faction/, 'orphan config');
log.length = 0; { const r = await A.sendAnnouncement(['1'], 'coerced', false, 'command'); ok(r.ok && r.sent === 1 && r.mirrored && r.channelType === 'command' && chans().join() === `${CMD1},${FM}`, 'string id coerced; faction + mirror posts'); }
as('tok-l2'); await failsWith(() => A.sendAnnouncement([1, 3], 'x', false, 'command'), /not a faction/, 'L2 foreign config');
as('tok-l3'); { const r = await failsWith(() => A.sendAnnouncement([3], 'x', false, 'command'), /Command channel configured/, 'no-op: cfg3 has no command channel'); ok(r.failed?.[0]?.faction_name === 'Harbor Syndicate', 'no-op reports the faction'); }
await failsWith(() => A.sendAnnouncement([2], 'x', false, 'both'), /channel configured/, 'no-op: cfg2 has nothing');
{ const after = counts(); ok(after.log === before.log + 1 && after.del === before.del + 1 && after.audit === before.audit + 1 && after.pub === before.pub + 1, 'only the real send logged (1 log / delivery / audit / portal message)'); } pass('sendAnnouncement validation');

// ── fan-out + mirror ──
plan = { [FW3]: { status: 403, json: { message: 'Missing Access' } } }; log.length = 0;
{ const r = await A.sendAnnouncement([1, 2, 3], 'Big news\n\nline2', true, 'both'); const posts = log.splice(0).filter(e => e.method === 'POST');
  ok(r.ok && r.sent === 1 && r.total === 3 && r.postedToFM && r.failed.length === 2, 'partial delivery result');
  const fm = posts.find(e => e.url.includes(FM)); ok(fm && fm.body.content === '<@&1457229857749729363>' && /partly delivered/.test(fm.body.embeds[0].title), 'FM mirror with role mention says partly delivered');
  const lg = lastLog(); ok(lg.posted_to_fm === 1 && lg.sent_count === 1 && lg.total_count === 3 && dels(lg.id).length === 3 && dels(lg.id).filter(d => d.ok).length === 1, 'log + 3 delivery rows');
  ok(lastAudit().target_type === 'announcement' && lastAudit().target_id === String(lg.id) && /1\/3/.test(lastAudit().target_label), 'audit summarises delivery'); eq(queryOne('SELECT message FROM faction_public_messages ORDER BY id DESC LIMIT 1').message, 'Big news\n\nline2', 'portal copy for the delivered faction'); }
plan = {}; as('tok-l2'); log.length = 0; { const r = await A.sendAnnouncement([1], 'From L2', false, 'command'); const fm = log.find(e => e.url.includes(FM)); ok(r.ok && fm && !fm.body.content && JSON.stringify(fm.body.allowed_mentions) === '{"parse":[]}' && lastLog().author_name === 'Lead Two' && lastLog().posted_to_fm === 0, 'L2 send mirrors quietly (no mention)'); }
as('tok-l3'); plan = { [CMD1]: { status: 403, json: { message: 'Missing Access' } } }; log.length = 0;
{ const r = await failsWith(() => A.sendAnnouncement([1], 'fail me', false, 'command'), /Nothing was delivered/, 'all deliveries fail'); const fm = log.find(e => e.url.includes(FM)); ok(r.mirrored && fm && /FAILED/.test(fm.body.embeds[0].title) && lastLog().sent_count === 0 && /FAILED 0\/1/.test(lastAudit().target_label), 'failure still logged + mirrored as FAILED'); }
plan = {}; log.length = 0; { const r = await A.sendAnnouncement([], 'To FM', true, 'command'); ok(r.ok && r.fmOnly && r.postedToFM && chans().join() === FM && dels(lastLog().id)[0].channel_type === 'FM Discord', 'FM-only send'); }
plan = { '*': { status: 500, json: { message: 'boom' } } }; await failsWith(() => A.sendAnnouncement([], 'To FM', true, 'command'), /FM Discord post failed/, 'FM-only failure'); eq(dels(lastLog().id)[0].ok, 0, 'FM failure recorded');
plan = { '*': { throw: 'ECONNRESET' } }; await failsWith(() => A.sendAnnouncement([1], 'x', false, 'command'), /Nothing was delivered/, 'network error'); eq(dels(lastLog().id)[0].error, 'ECONNRESET', 'network error recorded per delivery');
{ let n429 = 0; plan = {}; const real = globalThis.fetch; globalThis.fetch = async (url, opts) => { if (String(url).includes(CMD1) && n429++ === 0) return { ok: false, status: 429, clone() { return this; }, json: async () => ({ retry_after: 0.3 }), text: async () => '' }; return real(url, opts); };
  const r = await A.sendAnnouncement([1], 'retry', false, 'command'); globalThis.fetch = real; ok(r.ok && r.sent === 1 && n429 === 2, '429 retried once'); }
eq((await A.sendAnnouncement([1], 'x', false, 'bogus')).channelType, 'command', 'bad channelType falls back to command');
run("UPDATE ping_routes SET enabled=0 WHERE key='comms.announcement.fm'"); log.length = 0; { const r = await A.sendAnnouncement([1], 'muted', false, 'command'); ok(r.ok && r.mirrored === false && chans().join() === CMD1, 'muted FM route: faction send only'); }
await failsWith(() => A.sendAnnouncement([], 'muted fm', true, 'command'), /muted/, 'muted route + FM only'); run("UPDATE ping_routes SET enabled=1 WHERE key='comms.announcement.fm'");
run("UPDATE bot_server_configs SET comms_channel_id='520000000000000020', faction_channel_id='520000000000000021' WHERE id=2"); log.length = 0;
{ const r = await A.sendAnnouncement([1, 2, 3], 'par', false, 'both'); ok(r.ok && r.sent === 4 && r.total === 4 && chans().sort().join() === [CMD1, '520000000000000020', '520000000000000021', FW3, FM].sort().join(), 'parallel fan-out hits every channel'); }
run("UPDATE bot_server_configs SET comms_channel_id='', faction_channel_id='' WHERE id=2"); pass('fan-out + mirror');

// ── history ──
as('tok-l3'); { const h = await A.getAnnouncementHistory(); ok(h.length === 13 && h[0].deliveries.length === 4 && h.every(l => Array.isArray(l.deliveries)), 'history with deliveries'); }
eq((await A.getAnnouncementHistory('announcement', 2)).length, 2, 'history limit'); eq((await A.getAnnouncementHistory(null, 'abc')).length, 13, 'bad limit → default'); eq((await A.getAnnouncementHistory('bogus')).length, 13, 'bogus kind → all');
as('tok-l2'); { const h = await A.getAnnouncementHistory(); ok(h.length === 1 && h[0].author_name === 'Lead Two', 'L2 sees own only'); }
for (const t of ['tok-l1', 'tok-lst', 'tok-et']) { as(t); await rejects(() => A.getAnnouncementHistory(), 'AUTH_INSUFFICIENT', `history ${t}`); } pass('history');

// ── imgbb ──
delete process.env.IMGBB_API_KEY; as('tok-l2'); await failsWith(() => A.uploadToImgbb('AAAA', 'pic.png'), /IMGBB_API_KEY/, 'no key'); process.env.IMGBB_API_KEY = 'k';
plan = { 'https://api.imgbb.com/1/upload': { json: { success: true, data: { url: 'https://i.ibb.co/x.png' } } } }; eq((await A.uploadToImgbb('AAAA', 'pic.png')).url, 'https://i.ibb.co/x.png', 'upload ok');
await failsWith(() => A.uploadToImgbb('', 'pic.png'), /image data/i, 'empty data'); await failsWith(() => A.uploadToImgbb('<script>', 'pic.png'), /base64/, 'non-base64');
plan = { 'https://api.imgbb.com/1/upload': { status: 400, json: { success: false, error: { message: 'bad image' } } } }; await failsWith(() => A.uploadToImgbb('AAAA', 'pic.png'), /bad image/, 'upload failure surfaced');
as('tok-l1'); await rejects(() => A.uploadToImgbb('AAAA', 'pic.png'), 'AUTH_INSUFFICIENT', 'L1 upload'); as('tok-lst'); await rejects(() => A.uploadToImgbb('AAAA', 'pic.png'), 'AUTH_INSUFFICIENT', 'LST upload'); pass('imgbb');

// ── IC communications ──
as('tok-l3'); process.env.DISCORD_BOT_TOKEN = ''; await failsWith(() => A.sendICCommunication([1], 'https://x/y.png', 'msg', 'command'), /token/i, 'IC no token'); process.env.DISCORD_BOT_TOKEN = 'test-token';
await failsWith(() => A.sendICCommunication([1], '', 'msg', 'command'), /link/i, 'IC no link'); await failsWith(() => A.sendICCommunication([1], 'not a url', 'msg', 'command'), /https/, 'IC non-https'); await failsWith(() => A.sendICCommunication([], 'https://x/y.png', 'msg', 'command'), /recipients/i, 'IC no recipients');
await failsWith(() => A.sendICCommunication([999, 5, 4], 'https://x/y.png', 'msg', 'command'), /3 selected recipients/, 'IC unknown/archived ids'); await failsWith(() => A.sendICCommunication([3], 'https://x/y.png', 'msg', 'command'), /Command channel configured/, 'IC no-op');
const icBefore = queryOne('SELECT COUNT(*) c FROM faction_ic_messages').c; plan = { [FW3]: { status: 404, json: { message: 'Unknown Channel' } } }; log.length = 0;
{ const r = await A.sendICCommunication([1, 3], ' https://i.ibb.co/a.png ', '  caption ', 'both'); const posts = log.splice(0).filter(e => e.method === 'POST'); const lg = lastLog();
  ok(r.ok && r.sent === 1 && r.total === 2 && r.failed.length === 1, 'IC partial delivery'); ok(posts.some(e => e.url.includes(ICFM) && /partly delivered/.test(e.body.embeds[0].title)), 'IC mirror to comms.ic.fm');
  ok(lg.kind === 'ic' && lg.link === 'https://i.ibb.co/a.png' && lg.sent_count === 1 && lg.total_count === 2 && dels(lg.id).length === 2, 'IC log + deliveries');
  const ic = query('SELECT faction_id, link, message FROM faction_ic_messages WHERE id > ?', [icBefore]); ok(ic.length === 1 && ic[0].faction_id === 1 && ic[0].message === 'caption', 'IC thread row only for the delivered faction'); ok(lastAudit().target_type === 'ic_communication' && lastAudit().target_id === String(lg.id), 'IC audited'); }
plan = { [CMD1]: { status: 403, json: { message: 'Missing Access' } } }; log.length = 0; { const r = await failsWith(() => A.sendICCommunication([1], 'https://x/y.png', '', 'command'), /Nothing was delivered/, 'IC all fail'); ok(r.mirrored && log.some(e => e.url.includes(ICFM) && /FAILED/.test(e.body.embeds[0].title)), 'IC failure mirrored as FAILED'); }
plan = {}; run("UPDATE ping_routes SET enabled=0 WHERE key='comms.ic.fm'"); log.length = 0; { const r = await A.sendICCommunication([1], 'https://x/y.png', '', 'command'); ok(r.ok && r.mirrored === false && chans().join() === CMD1, 'IC route muted'); } run("UPDATE ping_routes SET enabled=1 WHERE key='comms.ic.fm'");
as('tok-l2'); ok((await A.sendICCommunication([1], 'https://x/y.png', 'l2 memo', 'command')).ok, 'L2 IC to own faction'); await failsWith(() => A.sendICCommunication([3], 'https://x/y.png', '', 'faction'), /not a faction/, 'L2 IC foreign');
as('tok-lst'); await rejects(() => A.sendICCommunication([1], 'https://x/y.png', '', 'command'), 'AUTH_INSUFFICIENT', 'LST IC'); as('tok-l1'); await rejects(() => A.sendICCommunication([1], 'https://x/y.png', '', 'command'), 'AUTH_INSUFFICIENT', 'L1 IC'); pass('IC communications');

// ── IC thread ──
as('tok-l3'); { const t = await A.getFactionICThread(1); ok(t.length === 4 && t[0].author_name === 'Lead Two' && t[0].message === 'l2 memo' && t[3].author_name === 'Risk', 'thread newest first'); }
as('tok-l2'); eq((await A.getFactionICThread(1)).length, 4, 'L2 own team thread'); eq((await A.getFactionICThread(4)).length, 0, 'L2 foreign thread → []'); eq((await A.getFactionICThread('abc')).length, 0, 'bad id → []');
as('tok-l1'); await rejects(() => A.getFactionICThread(1), 'AUTH_INSUFFICIENT', 'L1 thread'); pass('IC thread');
