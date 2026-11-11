// Operations admin: fleet vehicle catalog, Important Links forum post, the
// Server Logs /api routes (auth matrix + keywords CRUD), v2 admin analytics.
import { as, ok, eq, rejects, failsWith, pass } from '../lib.mjs';
import { queryOne, run } from '../../../shared/db.js';
const V = await import('../../../dashboard/src/app/fm/operations/vehicles/actions.js');
const L = await import('../../../dashboard/src/app/fm/operations/links/actions.js');
const FP = await import('../../../dashboard/src/lib/forumPosts.js');
const A = await import('../../../dashboard/src/app/v2/admin/actions.js');
const RM = await import('../../../dashboard/src/app/fm/operations/reminders/actions.js');
const auditCount = () => queryOne('SELECT COUNT(*) c FROM site_audit_log').c;
const lastAudit = () => queryOne('SELECT action, target_type, target_id, target_label, details FROM site_audit_log ORDER BY id DESC LIMIT 1');

// ── vehicle catalog ──
as('tok-l1'); { const r = await V.listCatalog(); ok('factions_using' in r[0] && 'in_circulation' in r[0], 'catalog rows carry usage'); } as('tok-lst'); ok(Array.isArray(await V.listCatalog()), 'LST reads catalog');
as('tok-l2'); await rejects(() => V.createCatalogEntry({ vehicle_name: 'Kamacho', spawn_name: 'kamacho' }), 'AUTH_INSUFFICIENT', 'L2 create'); as('tok-et'); await rejects(() => V.createCatalogEntry({ vehicle_name: 'Kamacho', spawn_name: 'kamacho' }), 'AUTH_INSUFFICIENT', 'ET create');
as('tok-l3'); let a0 = auditCount(); const kam = (await V.createCatalogEntry({ vehicle_name: ' Kamacho ', spawn_name: 'kamacho' })).id; ok(kam > 0 && auditCount() === a0 + 1 && lastAudit().target_id === String(kam), 'create audited with id');
await failsWith(() => V.createCatalogEntry({ vehicle_name: 'KAMACHO' }), null, 'case-insensitive dupe'); await failsWith(() => V.createCatalogEntry(null), null, 'null payload'); await failsWith(() => V.createCatalogEntry({}), null, 'empty payload');
as('tok-et'); await rejects(() => V.addCatalogVehicleToFaction(kam, 1, 1), 'AUTH_INSUFFICIENT', 'ET add to faction');
as('tok-l3'); { const r = await V.addCatalogVehicleToFaction(kam, 1, 1); ok(r.ok && r.newTotal === 3 && r.limits.max_total === 6, 'add to faction within override limits'); }
ok((await V.addCatalogVehicleToFaction(kam, 1, 3)).ok && queryOne("SELECT quantity FROM faction_fleet_vehicles WHERE faction_id=1 AND vehicle_name='Kamacho'").quantity === 4, 'merge into existing row'); eq(queryOne('SELECT use_count FROM fleet_vehicle_catalog WHERE id=?', [kam]).use_count, 4, 'use_count counts units added');
await failsWith(() => V.addCatalogVehicleToFaction(kam, 1, 1), /limit is 6/, 'total cap'); await failsWith(() => V.addCatalogVehicleToFaction(kam, 3, 1), /archived/, 'archived faction'); await failsWith(() => V.addCatalogVehicleToFaction(kam, 999, 1), null, 'unknown faction'); await failsWith(() => V.addCatalogVehicleToFaction(9999, 4, 1), null, 'unknown catalog id');
for (const bad of [0, -5, 'abc', 501]) await failsWith(() => V.addCatalogVehicleToFaction(kam, 4, bad), null, `qty ${JSON.stringify(bad)}`);
ok((await V.addCatalogVehicleToFaction(kam, 4, 2)).ok && queryOne("SELECT spawn_name FROM faction_fleet_vehicles WHERE faction_id=4 AND vehicle_name='Kamacho'").spawn_name === 'kamacho', 'spawn copied to faction row'); ok(/Added 2x Kamacho/.test(queryOne('SELECT details FROM faction_history ORDER BY id DESC LIMIT 1').details), 'FLEET history');
run("UPDATE faction_fleet_vehicles SET spawn_name='custom' WHERE faction_id=4 AND vehicle_name='Kamacho'");
{ const r = await V.updateCatalogEntry(kam, { vehicle_name: 'Kamacho XL', spawn_name: 'kamacho2' }); ok(r.ok && r.renamedRows === 2 && r.respawnedRows === 1, 'rename + respawn counts'); }
ok(queryOne("SELECT COUNT(*) c FROM faction_fleet_vehicles WHERE vehicle_name='Kamacho XL'").c === 2 && queryOne("SELECT spawn_name FROM faction_fleet_vehicles WHERE faction_id=1 AND vehicle_name='Kamacho XL'").spawn_name === 'kamacho2' && queryOne("SELECT spawn_name FROM faction_fleet_vehicles WHERE faction_id=4 AND vehicle_name='Kamacho XL'").spawn_name === 'custom', 'rows renamed, custom spawn kept');
await failsWith(() => V.updateCatalogEntry(kam, { vehicle_name: 'sultan' }), null, 'NOCASE collision'); await failsWith(() => V.updateCatalogEntry(kam, null), null, 'update null'); await failsWith(() => V.updateCatalogEntry('abc', { vehicle_name: 'x' }), null, 'update bad id');
await failsWith(() => V.deleteCatalogEntry(kam), /2 factions/, 'delete in use'); as('tok-et'); await rejects(() => V.deleteCatalogEntry(2), 'AUTH_INSUFFICIENT', 'ET delete'); as('tok-l3'); ok((await V.deleteCatalogEntry(2)).ok, 'delete unused'); await failsWith(() => V.deleteCatalogEntry(2), null, 'delete twice');
as('tok-et'); await rejects(() => V.listFactionsForAdd(), 'AUTH_INSUFFICIENT', 'ET factions for add'); pass('vehicle catalog');

// ── links / forum posts ──
await rejects(() => L.getLinks(), 'AUTH_INSUFFICIENT', 'ET links'); as('tok-l3'); { const r = await L.getLinks(); ok(r.channelLabel === 'important_links' && r.channelId === '800000000000000003', 'channel from discord_config'); }
a0 = auditCount(); ok((await L.saveLinks('My Title', [{ type: 'links', heading: 'H', links: [{ label: 'A', url: 'javascript:alert(1)' }, { label: 'B', url: 'https://x.y' }] }])).ok && auditCount() === a0 + 1 && lastAudit().action === 'EDIT' && lastAudit().target_type === 'managed_forum_post', 'save audited');
ok(!/javascript/.test(queryOne("SELECT content_json FROM managed_forum_posts WHERE key='important_links'").content_json), 'javascript: url blanked');
as('tok-l2'); await rejects(() => L.saveLinks('x', []), 'AUTH_INSUFFICIENT', 'L2 save'); as('tok-l3'); a0 = auditCount();
await failsWith(() => L.publishLinks('T', [{ type: 'text', heading: 'H', text: 'b' }]), /DISCORD_BOT_TOKEN/, 'publish without token'); ok(auditCount() === a0 + 2 && lastAudit().action === 'PUBLISH' && /FAILED/.test(lastAudit().details), 'failed publish audited');
ok(FP.threadUrl('42') === `https://discord.com/channels/${process.env.GUILD_ID}/42` && FP.threadUrl(null) === null, 'threadUrl uses GUILD_ID'); pass('links');

// ── server log routes ──
const want = { 'tok-l3': 200, 'tok-owner': 200, 'tok-et': 403, 'tok-l2': 403, 'tok-lst': 403, 'tok-expired': 401 };
for (const rt of ['memberlog', 'deletedmessages', 'editedmessages', 'keywordalerts', 'keywords']) {
  const m = await import(`../../../dashboard/src/app/api/${rt}/route.js`);
  for (const [actor, status] of Object.entries(want)) { as(actor); eq((await m.GET()).status, status, `GET ${rt} as ${actor}`); }
}
as('tok-l3'); { const rows = await (await (await import('../../../dashboard/src/app/api/deletedmessages/route.js')).GET()).json(); ok(rows.length === 0 || ['author_display_name', 'deleter_id', 'deleter_name'].every(c => c in rows[0]), 'deleted messages carry deleter columns'); }
const K = await import('../../../dashboard/src/app/api/keywords/route.js'); const req = (b) => ({ json: async () => b }); const st = async (p) => (await p).status;
as('tok-l2'); eq(await st(K.POST(req({ phrase: 'raid' }))), 403, 'POST keyword L2'); as('tok-et'); eq(await st(K.POST(req({ phrase: 'raid' }))), 403, 'POST keyword ET');
as('tok-l3'); eq(await st(K.POST(req({ phrase: ' ' }))), 400, 'blank phrase'); eq(await st(K.POST({ json: async () => { throw new Error('x'); } })), 400, 'bad json'); eq(await st(K.POST(req({ phrase: 'a' }))), 400, 'one-char phrase');
const added = await (await K.POST(req({ phrase: '  RaId ' }))).json(); ok(added.ok && added.phrase === 'raid' && lastAudit().action === 'CREATE' && lastAudit().target_type === 'keyword' && lastAudit().target_id === String(added.id), 'keyword lower-cased + audited');
eq(await st(K.POST(req({ phrase: 'RAID' }))), 409, 'duplicate keyword'); eq(await st(K.DELETE(req({}))), 400, 'DELETE {}'); eq(await st(K.DELETE(req({ id: 'abc' }))), 400, 'DELETE abc'); eq(await st(K.DELETE(req({ id: 9999 }))), 404, 'DELETE unknown');
ok(await st(K.DELETE(req({ id: String(added.id) }))) === 200 && lastAudit().action === 'DELETE' && lastAudit().target_label === 'raid', 'DELETE audited'); pass('server log routes');

// ── admin analytics + reminders mirrors ──
as('tok-l2'); await rejects(() => A.getAdminAnalytics(), 'AUTH_INSUFFICIENT', 'analytics L2'); as('tok-et'); await rejects(() => A.getAdminAnalytics(), 'AUTH_INSUFFICIENT', 'analytics ET');
as('tok-l3'); { const r = await A.getAdminAnalytics(); ok(r.factions.active === 3 && r.factions.archived === 1, 'active = not archived'); ok(r.tasks.open === 3 && r.tasks.unclaimed === 2, 'open tasks by status'); ok(typeof r.queues.rpPending === 'number' && Array.isArray(r.activity), 'queues + activity'); }
as('tok-l2'); ok(Array.isArray(await RM.listReminders()), 'L2 lists reminders'); { const o = await RM.getTargetOptions(); ok(o.roles.length === 0 && o.teams.every(t => t.team_id === 'team_cup'), 'L2 target options scoped'); }
as('tok-et'); await rejects(() => RM.listReminders(), 'AUTH_INSUFFICIENT', 'ET reminders'); pass('analytics + reminders gating');
