// Operations workspace (dashboard/src/app/fm/operations/actions.js): global
// properties, MDB roles, bot server configs, import items, deletion requests,
// leadership tasks/reminders through shared/tasks.js, fleet limits.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
const log = captureDiscord();
const A = await import('../../../dashboard/src/app/fm/operations/actions.js');
const ALT = '1494694133862760578';
const auditCount = () => queryOne('SELECT COUNT(*) c FROM site_audit_log').c;
const lastAudit = () => queryOne('SELECT action, details FROM site_audit_log ORDER BY id DESC LIMIT 1');

// ── properties ──
as('tok-l2'); { const r = await A.getGlobalProperties(); ok(r[0].status && 'faction_id' in r[0], 'rows carry faction_id/status'); }
as('tok-et'); await rejects(() => A.addGlobalProperty({ address: 'ET St', faction: 'The Vanguard' }), 'AUTH_INSUFFICIENT', 'ET read-only');
as('tok-l3'); await failsWith(() => A.addGlobalProperty({}), null, 'no address');
await failsWith(() => A.addGlobalProperty({ address: '1 X St', faction: 'Nope' }), null, 'unknown faction'); ok(!queryOne("SELECT 1 FROM properties WHERE address='1 X St'"), 'no row on error');
await failsWith(() => A.addGlobalProperty({ address: '1 X St', faction: 'Old Crew' }), /archived/, 'archived faction');
ok((await A.addGlobalProperty({ address: '1 X St', faction: 'the vanguard', type: 'Warehouse' })).ok && queryOne("SELECT faction_id FROM properties WHERE address='1 X St'").faction_id === 1, 'case-insensitive faction name');
ok(!!queryOne("SELECT 1 FROM faction_history WHERE action_type='PROPERTY_ADDED' AND details LIKE '%1 X St%'"), 'PROPERTY_ADDED history');
ok((await A.addGlobalProperty({ address: '2 HQ Rd', factionId: 1, isHQ: true })).ok && queryOne('SELECT COUNT(*) c FROM properties WHERE faction_id=1 AND is_hq=1').c === 1 && queryOne("SELECT property_type FROM properties WHERE address='12 Grove St'").property_type === 'Property', 'one HQ per faction');
const pid = queryOne("SELECT id FROM properties WHERE address='1 X St'").id;
{ const a = auditCount(); await failsWith(() => A.editPropertyDetail(9999, { address: 'x' }), null, 'edit unknown'); eq(auditCount(), a, 'no audit on unknown'); }
ok((await A.editPropertyDetail(pid, { notes: 'hello' })).ok, 'partial edit'); { const p = queryOne('SELECT * FROM properties WHERE id=?', [pid]); ok(p.address === '1 X St' && p.property_type === 'Warehouse' && p.notes === 'hello', 'other fields kept'); }
await failsWith(() => A.editPropertyDetail(pid, { address: '' }), null, 'empty address');
ok((await A.editPropertyDetail(pid, { isHQ: true })).ok && queryOne('SELECT COUNT(*) c FROM properties WHERE faction_id=1 AND is_hq=1').c === 1 && queryOne('SELECT property_type FROM properties WHERE id=?', [pid]).property_type === 'HQ', 'make HQ → sole HQ');
await failsWith(() => A.assignProperty(pid, 'Nonexistent'), null, 'assign unknown name'); eq(queryOne('SELECT faction_id FROM properties WHERE id=?', [pid]).faction_id, 1, 'still assigned');
ok((await A.assignProperty(pid, '2')).ok && queryOne('SELECT faction_id FROM properties WHERE id=?', [pid]).faction_id === 2, 'assign by id string'); await failsWith(() => A.assignProperty(9999, 'The Vanguard'), null, 'assign unknown property');
ok((await A.confiscateProperty(pid)).ok && queryOne('SELECT faction_id FROM properties WHERE id=?', [pid]).faction_id === null, 'confiscate'); await failsWith(() => A.confiscateProperty(pid), null, 'confiscate twice');
{ const a = auditCount(); await failsWith(() => A.deleteProperty(9999), null, 'delete unknown'); eq(auditCount(), a, 'no audit'); } ok((await A.deleteProperty(pid)).ok && !queryOne('SELECT 1 FROM properties WHERE id=?', [pid]), 'delete'); pass('properties');

// ── mdb / bot config / imports ──
await failsWith(() => A.addMdbAccessRole({ role_id: '', role_name: 'x' }), null, 'mdb empty id'); await failsWith(() => A.addMdbAccessRole({ role_name: 'x' }), null, 'mdb no id');
ok((await A.addMdbAccessRole({ role_id: '900000000000000005', role_name: 'Founder' })).ok, 'mdb add'); await failsWith(() => A.addMdbAccessRole({ role_id: '900000000000000005', role_name: 'Founder' }), null, 'mdb dup');
await failsWith(() => A.addBotServerConfig({}), null, 'config missing guild'); await failsWith(() => A.addBotServerConfig({ guild_id: '123456789012345678', faction: 'Nope' }), null, 'config bad faction');
const cfg = await A.addBotServerConfig({ guild_id: '123456789012345678', guild_name: 'G', faction: 'The Vanguard' }); ok(cfg.ok && queryOne("SELECT faction_id FROM bot_server_configs WHERE guild_id='123456789012345678'").faction_id === 1, 'config added');
await failsWith(() => A.addBotWatchRole({ config_id: 9999, role_id: '900000000000000001' }), null, 'watch role bad config'); ok((await A.addBotWatchRole({ config_id: cfg.id, role_id: '900000000000000001', role_name: 'L' })).ok, 'watch role added');
await failsWith(() => A.updateBotServerConfig(cfg.id, { guild_name: 'G', faction: 'Nope' }), null, 'update config bad faction');
await failsWith(() => A.addImportItem({}), null, 'import item empty'); as('tok-et'); await rejects(() => A.addImportItem({ name: 'x' }), 'AUTH_INSUFFICIENT', 'ET import item');
as('tok-l3'); const item = await A.addImportItem({ name: 'Widget', tier: '2' }); ok(item.ok, 'import item added');
ok((await A.editImportItem(item.id, { price: '$5' })).ok && queryOne("SELECT price FROM import_items WHERE name='Widget'").price === '$5', 'partial edit keeps name');
await failsWith(() => A.editImportItem(9999, { name: 'X' }), null, 'edit unknown item'); await failsWith(() => A.deleteImportItem(9999), null, 'delete unknown item'); pass('mdb / bot config / imports');

// ── deletion requests / restore ──
run("INSERT INTO deletion_requests (content_type, target_row_id, original_text, requested_by, status) VALUES ('faction', 1, 'x', 'Guide One', 'PENDING')");
const dr = queryOne('SELECT id FROM deletion_requests ORDER BY id DESC LIMIT 1').id;
await failsWith(() => A.resolveDeletion(dr, true), null, 'unmapped type cannot be approved'); eq(queryOne('SELECT status FROM deletion_requests WHERE id=?', [dr]).status, 'PENDING', 'still pending'); ok((await A.resolveDeletion(dr, false)).ok, 'reject');
{ const a = auditCount(); await failsWith(() => A.restoreFaction(999), null, 'restore unknown'); eq(auditCount(), a, 'no audit'); } await failsWith(() => A.restoreFaction(1), null, 'restore active');
ok((await A.restoreFaction(3)).ok && queryOne('SELECT archived FROM factions WHERE id=3').archived === 0, 'restore archived'); run('UPDATE factions SET archived=1 WHERE id=3'); pass('deletion / restore');

// ── leadership tasks / reminders ──
await failsWith(() => A.createLeadershipTask({ targetType: 'Role', targetId: '900000000000000001' }), null, 'task no desc');
log.length = 0; const lt = await A.createLeadershipTask({ desc: 'Review the docks', targetType: 'Role', targetId: '900000000000000001' }); ok(lt.ok && lt.uid && pings(log).some(p => p.ch === ALT), 'leadership task → ALT');
ok((await A.getLeadershipTasks()).some(x => x.task_uid === lt.uid && x.claimerName && x.targetLabel), 'listed decorated');
{ const a = auditCount(); await failsWith(() => A.claimLeadershipTask('nope'), null, 'claim unknown'); ok(auditCount() === a && !queryOne("SELECT 1 FROM task_log WHERE task_uid='nope'"), 'no log/audit'); }
ok((await A.claimLeadershipTask(lt.uid, true)).ok && queryOne('SELECT next_reminder FROM tasks WHERE task_uid=?', [lt.uid]).next_reminder, 'claim with reminder'); await failsWith(() => A.claimLeadershipTask(lt.uid), null, 'claim twice');
ok((await A.editLeadershipTask(lt.uid, 'Review the docks (updated)')).ok && queryOne('SELECT description FROM tasks WHERE task_uid=?', [lt.uid]).description.includes('updated'), 'edit');
await failsWith(() => A.completeLeadershipTask('nope'), null, 'complete unknown'); ok((await A.completeLeadershipTask(lt.uid)).ok && queryOne('SELECT status FROM tasks WHERE task_uid=?', [lt.uid]).status === 'completed', 'soft complete');
run("UPDATE factions SET pending_promo='4' WHERE id=4"); run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, status) VALUES ('promo1','Harbor Syndicate — promotion review','900000000000000001','Role','None','promotion-bot','Promotion Bot','open')");
log.length = 0; ok((await A.completeLeadershipTask('promo1')).ok && pings(log).some(p => /Tier 4/.test(p.content)), 'promotion-bot task completion reports the staged tier');
await failsWith(() => A.createLeadershipReminder({ epochMs: Date.now() + 3600000 }), null, 'reminder no message');
log.length = 0; const lr = await A.createLeadershipReminder({ message: 'Meet', epochMs: Date.now() + 3600000, targetType: 'Role', targetId: '900000000000000001', eventType: 'Meeting' }); ok(lr.ok && pings(log).some(p => p.embeds === 1), 'leadership reminder embed');
ok((await A.snoozeLeadershipReminder(lr.uuid)).ok && /Snoozed/.test(lastAudit().details), 'snooze audited'); await failsWith(() => A.snoozeLeadershipReminder('nope'), null, 'snooze unknown');
eq((await A.getRoleTargetsForWorkspace()).teams.length, 3, 'teams from teams table'); pass('leadership tasks / reminders');

// ── fleet ──
as('tok-l1'); eq((await A.getFleetTierDefaults())[2].total, 5, 'tier defaults');
as('tok-l3'); run('DELETE FROM faction_fleet_config WHERE faction_id=1'); run('DELETE FROM faction_fleet_vehicles WHERE faction_id=1');
ok((await A.addFleetVehicle(1, 'Kuruma', 2, '')).ok, 'add vehicle');
{ const r = await A.addFleetVehicle(1, 'kuruma', '2', 'more'); ok(r.ok && r.merged && queryOne('SELECT COUNT(*) c FROM faction_fleet_vehicles WHERE faction_id=1').c === 1 && queryOne('SELECT SUM(quantity) s FROM faction_fleet_vehicles WHERE faction_id=1').s === 4, 'same name merges (case + string qty)'); }
await failsWith(() => A.addFleetVehicle(1, 'Buffalo', 1, ''), /type/, 'type cap (tier 2 → 1 type)'); await failsWith(() => A.addFleetVehicle(1, 'Kuruma', 5, ''), null, 'total cap'); await failsWith(() => A.addFleetVehicle(1, 'Kuruma', 0, ''), null, 'qty 0');
await failsWith(() => A.addFleetVehicle(3, 'Kuruma', 1, ''), /archived/, 'archived faction'); { const a = auditCount(); await failsWith(() => A.addFleetVehicle(999, 'Kuruma', 1, ''), null, 'unknown faction'); eq(auditCount(), a, 'no audit'); }
const vid = queryOne('SELECT id FROM faction_fleet_vehicles WHERE faction_id=1').id;
await failsWith(() => A.editFleetVehicle(vid, -4, ''), null, 'edit qty negative'); await failsWith(() => A.editFleetVehicle(vid, 9), null, 'edit over total'); ok((await A.editFleetVehicle(vid, 5)).ok && queryOne('SELECT notes FROM faction_fleet_vehicles WHERE id=?', [vid]).notes === 'more', 'edit keeps notes');
run('DELETE FROM faction_fleet_garages WHERE faction_id=1'); await failsWith(() => A.addFleetGarage(1, 'G1', 'x', 'y', 'z', ''), null, 'garage text coords');
const g = await A.addFleetGarage(1, 'G1', '1.5', '2', '3', ''); ok(g.ok && queryOne("SELECT x FROM faction_fleet_garages WHERE name='G1'").x === 1.5, 'garage numeric coords'); await failsWith(() => A.editFleetGarage(g.id, 'G2', 'a', 1, 1, ''), null, 'edit garage bad coords');
await failsWith(() => A.setFleetOverride(1, -1, 'abc', null, 'bad'), null, 'override validation'); await failsWith(() => A.setFleetOverride(1, 5, 20, 2, ''), null, 'override needs reason'); await failsWith(() => A.setFleetOverride(3, 5, 20, 2, 'why'), null, 'override archived');
ok((await A.setFleetOverride(1, 5, 20, 2, 'why')).ok, 'override set'); { const f = (await A.getFleetOverview()).find(x => x.id === 1); ok(f.typeCount === 1 && f.limits.isOverridden, 'overview: distinct types + override flag'); }
await failsWith(() => A.clearFleetOverride(999), null, 'clear unknown'); await failsWith(() => A.clearFleetOverride(2), null, 'clear none'); ok((await A.clearFleetOverride(1)).ok, 'clear override'); pass('fleet');
