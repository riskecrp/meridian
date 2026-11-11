// Storytelling (dashboard/src/app/fm/storytelling/actions.js + v2/story):
// the full auth matrix per action, then validation and data effects for KB,
// NPCs/turfs, spawn items, weapons, change log, scene library and peds.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
const log = captureDiscord();
const fm = await import('../../../dashboard/src/app/fm/storytelling/actions.js');
const v2 = await import('../../../dashboard/src/app/v2/story/actions.js');
// An L1 guide who also holds the Lead Storyteller flag.
run("INSERT INTO staff (id, discord_id, discord_name, display_name, team_id, team_name, rank, clearance, lead_storyteller) VALUES (8,'100000000000000012','l1lst','Guide Storyteller','team_cup','Team Cup','Guide',1,1)");
run("INSERT INTO sessions (staff_id, token, discord_id, discord_name, clearance, event_team, lead_storyteller, expires_at) VALUES (8,'tok-l1lst','100000000000000012','Guide Storyteller',1,0,1, datetime('now','+3 days'))");
const auditCount = () => queryOne('SELECT COUNT(*) c FROM site_audit_log').c;
const lastAudit = () => queryOne('SELECT action, target_id FROM site_audit_log ORDER BY id DESC LIMIT 1');
const call = async (tok, mod, fn, args) => { as(tok); try { return { ok: true, result: await mod[fn](...args) }; } catch (e) { return { ok: false, code: e.code }; } };

// ── auth matrix: R = AUTH_REQUIRED, N = AUTH_INSUFFICIENT, Y = allowed (ok or a validation result) ──
const TOK = ['tok-expired', 'tok-l1', 'tok-l2', 'tok-l3', 'tok-et', 'tok-lst', 'tok-l1lst'];
const matrix = [
  ['fm', 'getLoreEntries', [], 'R Y Y Y Y Y Y'], ['fm', 'getCommandEntries', [], 'R N N Y Y N N'],
  ['fm', 'addKBEntry', [{ title: 'am', category: 'c' }, 'lore'], 'R N Y Y N N N'], ['fm', 'editKBEntry', [1, { title: 'The Docks', category: 'Lore', content: 'x' }], 'R N Y Y N N N'], ['fm', 'deleteKBEntry', [99999], 'R N Y Y N N N'],
  ['fm', 'getNPCs', [], 'R N Y Y Y Y Y'], ['fm', 'getTurfs', [], 'R N Y Y Y Y Y'],
  ['fm', 'addNPC', [{ name: 'x', position: '1 2 3', type: 'Dealer' }], 'R N N Y N N N'], ['fm', 'editNPC', [99999, { name: 'x', position: '1 2 3', type: 'Dealer' }], 'R N N Y N N N'], ['fm', 'deleteNPC', [99999], 'R N N Y N N N'],
  ['fm', 'updateTurf', ['', 'Matrix Turf', 'Low'], 'R N N Y N N N'], ['fm', 'disbandTurf', ['Nope'], 'R N N Y N N N'],
  ['fm', 'getSpawnItems', [], 'R N N Y Y N N'], ['fm', 'addSpawnItem', [{ name: 'm', itemType: 'item' }], 'R N N Y Y N N'], ['fm', 'editSpawnItem', [99999, { name: 'm' }], 'R N N Y Y N N'], ['fm', 'deleteSpawnItem', [99999], 'R N N Y Y N N'],
  ['fm', 'getLoadouts', [], 'R Y Y Y Y Y Y'], ['fm', 'addWeapon', [{ name: 'Matrix W', category: 'T' }], 'R N Y Y N N N'], ['fm', 'editWeapon', [99999, { name: 'x' }], 'R N Y Y N N N'], ['fm', 'deleteWeapon', [99999], 'R N Y Y N N N'],
  ['fm', 'addAmmoCompat', [99999, 'x'], 'R N Y Y N N N'], ['fm', 'removeAmmoCompat', [99999], 'R N Y Y N N N'], ['fm', 'addAttachmentCompat', [99999, 'x'], 'R N Y Y N N N'], ['fm', 'removeAttachmentCompat', [99999], 'R N Y Y N N N'],
  ['fm', 'getAmmoList', [], 'R Y Y Y Y Y Y'], ['fm', 'getAttachmentList', [], 'R Y Y Y Y Y Y'], ['fm', 'getWeaponCategories', [], 'R Y Y Y Y Y Y'],
  ['fm', 'getChangeLogs', [], 'R Y Y Y Y Y Y'], ['fm', 'addChangeLog', [{ changeType: 'drop_location', name: 'Matrix Drop', position: '1 1 1' }], 'R N N Y Y N N'], ['fm', 'editChangeLog', [99999, { name: 'x' }], 'R N N Y Y N N'], ['fm', 'deleteChangeLog', [99999], 'R N N Y Y N N'],
  ['fm', 'getSceneLibrary', [], 'R Y Y Y Y Y Y'], ['fm', 'addSceneLibraryEntry', [{ title: 'Matrix idea' }], 'R Y Y Y Y N Y'], ['fm', 'editSceneLibraryEntry', [99999, { title: 'x' }], 'R N Y Y Y N N'],
  ['fm', 'setSceneLibraryStatus', [99999, 'approved'], 'R N Y Y Y Y Y'], ['fm', 'deleteSceneLibraryEntry', [99999], 'R N Y Y Y N N'], ['fm', 'getSceneLibraryFeedback', [1], 'R Y Y Y Y Y Y'], ['fm', 'addSceneLibraryFeedback', [99999, 'x'], 'R N Y Y Y N N'],
  ['v2', 'getPedsPage', [{}], 'R Y Y Y Y Y Y'], ['v2', 'updatePedTags', [99999, [], ''], 'R N Y Y N N N'],
];
for (const [m, fn, args, exp] of matrix) {
  const got = [];
  for (const tok of TOK) { const r = await call(tok, m === 'fm' ? fm : v2, fn, args); got.push(r.ok ? 'Y' : r.code === 'AUTH_REQUIRED' ? 'R' : r.code === 'AUTH_INSUFFICIENT' ? 'N' : 'E'); }
  eq(got.join(' '), exp, `auth matrix ${m}.${fn}`);
}
as('tok-owner', '100000000000000009'); await rejects(() => fm.addNPC({ name: 'viewas', position: '1 1 1', type: 'Dealer' }), 'AUTH_INSUFFICIENT', 'owner view-as ET: NPC write refused'); ok(Array.isArray(await fm.getSpawnItems()), 'owner view-as ET: spawn items allowed');
as('tok-owner', '100000000000000010'); ok(Array.isArray(await fm.getLoreEntries()), 'owner view-as LST: lore allowed'); await rejects(() => fm.addSceneLibraryEntry({ title: 'lst viewas' }), 'AUTH_INSUFFICIENT', 'owner view-as LST: scene idea refused'); pass('auth matrix');

// ── knowledge base ──
as('tok-l2'); await failsWith(() => fm.addKBEntry({ category: 'X', content: 'no title' }, 'lore'), /title/i, 'KB no title'); await failsWith(() => fm.addKBEntry({ title: 't' }, 'bogus_type'), /type/i, 'KB bogus type'); await failsWith(() => fm.addKBEntry({ title: 'cmd by L2', content: '/x' }, 'command'), /L3/, 'command entries are L3');
let a0 = auditCount(); await failsWith(() => fm.editKBEntry(99999, { title: 'ghost', category: 'c' }), /not found/i, 'edit unknown KB'); await failsWith(() => fm.deleteKBEntry(99999), null, 'delete unknown KB'); eq(auditCount(), a0, 'no audit for unknown ids');
{ const r = await fm.addKBEntry({ title: 'L2 lore', category: 'Lore', content: 'c' }, 'lore'); ok(r.ok && String(lastAudit().target_id) === String(r.id), 'KB add audited with id'); }
as('tok-l3'); const cmdId = (await fm.addKBEntry({ title: 'Mgmt cmd', category: 'Cmd', content: '/cmd' }, 'command')).id; as('tok-l2'); await failsWith(() => fm.deleteKBEntry(cmdId), /L3/, 'L2 cannot delete a command entry');
as('tok-et'); ok((await fm.getCommandEntries()).some(x => x.id === cmdId), 'ET reads commands'); pass('knowledge base');

// ── NPCs / turfs ──
as('tok-l3'); ok((await fm.addNPC({ name: 'No Turf Guy', position: '1 1 1', type: 'Vendor' })).ok && JSON.stringify(queryOne("SELECT turf, claimable FROM npcs WHERE name='No Turf Guy'")) === '{"turf":"Neutral","claimable":0}', 'no turf → Neutral, not claimable');
ok((await fm.addNPC({ name: 'Unaff', position: '1 1 1', type: 'Vendor', turf: 'Unaffiliated' })).ok && queryOne("SELECT turf FROM npcs WHERE name='Unaff'").turf === 'Neutral', 'Unaffiliated stored as Neutral');
ok((await fm.addNPC({ name: 'New Dealer', position: '10 20 30', type: 'Dealer', turf: 'Brand New Turf', shipmentPower: 'Low' })).ok && !!queryOne("SELECT id FROM turfs WHERE name='Brand New Turf'") && queryOne("SELECT claimable FROM npcs WHERE name='New Dealer'").claimable === 1, 'new turf created, claimable');
await failsWith(() => fm.addNPC({ position: '1 1 1', type: 'Vendor' }), /name/i, 'NPC no name'); await failsWith(() => fm.addNPC({ name: 'n', type: 'Vendor' }), /position/i, 'NPC no position');
a0 = auditCount(); await failsWith(() => fm.editNPC(99999, { name: 'g', position: '0 0 0', type: 'X' }), null, 'edit unknown NPC'); eq(auditCount(), a0, 'no audit');
await failsWith(() => fm.updateTurf('', 'grove street', 'Low'), /already exists/, 'turf create clash (case)'); eq(queryOne("SELECT shipment_power FROM turfs WHERE name='Grove Street'").shipment_power, 'High', 'power untouched');
a0 = auditCount(); await failsWith(() => fm.updateTurf('Ghost Turf', 'Ghost Turf 2', 'Low'), /not found/i, 'rename unknown turf'); ok(!queryOne("SELECT id FROM turfs WHERE name='Ghost Turf 2'") && auditCount() === a0, 'nothing created');
ok((await fm.updateTurf('Grove Street', 'Grove St', 'Mid')).ok && !!queryOne("SELECT id FROM turfs WHERE name='Grove St'") && queryOne("SELECT turf FROM npcs WHERE name='Big Smoke'").turf === 'Grove St', 'turf rename moves NPCs');
ok((await fm.updateTurf('Grove St', 'Docks', 'High')).ok && !queryOne("SELECT id FROM turfs WHERE name='Grove St'") && queryOne("SELECT turf FROM npcs WHERE name='Big Smoke'").turf === 'Docks', 'rename onto existing merges');
await failsWith(() => fm.updateTurf('', 'Neutral', ''), /reserved/, 'Neutral is reserved');
ok((await fm.disbandTurf('Docks')).ok && query("SELECT turf, claimable, shipment_power FROM npcs WHERE name IN ('Big Smoke','Dockmaster')").every(x => x.turf === 'Neutral' && x.claimable === 0 && x.shipment_power === ''), 'disband resets NPCs');
await failsWith(() => fm.disbandTurf('Nonexistent'), /not found/i, 'disband unknown'); eq(queryOne("SELECT COUNT(*) c FROM npcs WHERE turf IN ('', 'Unaffiliated')").c, 0, 'no stray turf spellings'); pass('NPCs / turfs');

// ── spawn items / pick-lists ──
{ const before = queryOne('SELECT created_at FROM spawn_items WHERE id=1').created_at; as('tok-et'); ok((await fm.editSpawnItem(1, { category: 'Weapons', name: 'Pistol', gameId: 'WEAPON_PISTOL', itemType: 'weapon' })).ok && queryOne('SELECT created_at FROM spawn_items WHERE id=1').created_at === before, 'edit keeps created_at'); }
as('tok-l3'); await failsWith(() => fm.addSpawnItem({ name: 'x', itemType: 'vehicle_spawn_whatever' }), /type/i, 'spawn bogus type'); await failsWith(() => fm.addSpawnItem({ itemType: 'item' }), /name/i, 'spawn no name');
as('tok-et'); ok((await fm.addSpawnItem({ name: '9mm HP', category: 'Ammo', gameId: 'AMMO_9HP', itemType: 'ammo' })).ok, 'ET adds ammo'); ok((await fm.addSpawnItem({ name: 'Flashlight', category: 'Attachment', gameId: 'COMPONENT_FLASH', itemType: 'component' })).ok, 'ET adds component');
run("INSERT INTO import_items (name, tier, category) VALUES ('9mm FMJ Rounds (100x)','1','Ammo (Non-HP)'),('Grip','1','Attachment'),('Ammonia','1','Chemicals'),('Attachable Thing','1','Misc')");
as('tok-l1'); eq(JSON.stringify(await fm.getAmmoList()), JSON.stringify(['9mm FMJ Rounds (100x)', '9mm HP']), 'ammo list = spawn ammo ∪ import Ammo categories'); as('tok-lst'); eq(JSON.stringify(await fm.getAttachmentList()), JSON.stringify(['Flashlight', 'Grip']), 'attachment list = spawn components ∪ import Attachment'); pass('spawn items');

// ── weapons / compat ──
as('tok-l2'); const wid = (await fm.addWeapon({ name: 'L2 Weapon', category: 'SMG', caliber: '9mm' })).id; ok(wid > 0, 'L2 adds weapon'); await failsWith(() => fm.addWeapon({ category: 'SMG' }), /name/i, 'weapon no name');
eq((await fm.addAmmoCompat(wid, '9mm AP Rounds')).ammoType, 'AP', 'AP typed by token'); eq((await fm.addAmmoCompat(wid, 'SHAPED charge')).ammoType, 'Standard', 'no substring match → Standard'); eq((await fm.addAmmoCompat(wid, '12-Gauge Slug', 'Tracer')).ammoType, 'Tracer', 'explicit type honoured');
a0 = auditCount(); await failsWith(() => fm.addAmmoCompat(wid, '9mm AP Rounds'), /already/, 'duplicate compat'); await failsWith(() => fm.addAmmoCompat(99999, 'x'), /not found/i, 'compat unknown weapon'); await failsWith(() => fm.addAmmoCompat(wid, null), /name/i, 'compat null name'); await failsWith(() => fm.addAttachmentCompat(wid, null), null, 'attachment null'); eq(auditCount(), a0, 'no audit on refusals');
await failsWith(() => fm.removeAmmoCompat(99999), null, 'remove unknown compat'); ok((await fm.deleteWeapon(wid)).ok && queryOne('SELECT COUNT(*) c FROM weapon_ammo_compat WHERE weapon_id=?', [wid]).c === 0, 'delete weapon cascades compat'); pass('weapons');

// ── change log ──
as('tok-l3'); log.length = 0; const drop = await fm.addChangeLog({ changeType: 'drop_location', name: 'Drop Z', position: '5 5 5' });
{ const p = pings(log); ok(drop.ok && p.length === 1 && p[0].ch === '1464415763577176208' && /Drop Location Added/.test(p[0].content), 'drop → story.changelog route'); }
as('tok-et'); log.length = 0; const doc = await fm.addChangeLog({ changeType: 'black_market_doctor', name: 'Doc X', position: '1 2 3', action: 'Added', notes: 'open' }); { const p = pings(log); ok(doc.ok && p.length === 1 && /Black Market Doctor Added/.test(p[0].content), 'doctor post (ET)'); }
as('tok-l3'); await failsWith(() => fm.addChangeLog({ changeType: 'black_market_doctor', name: 'Doc NoAction', position: '1 2 3' }), /action/i, 'doctor needs action'); await failsWith(() => fm.addChangeLog({ changeType: 'something_else', name: 'x' }), /type/i, 'bogus change type'); await failsWith(() => fm.addChangeLog({ changeType: 'drop_location' }), /name/i, 'change log no name');
log.length = 0; { const r = await fm.editChangeLog(doc.id, { name: 'Doc X', position: '1 2 3', action: 'Removed', blockedOff: true }); const p = pings(log); ok(r.ok && queryOne('SELECT change_type FROM change_log WHERE id=?', [doc.id]).change_type === 'black_market_doctor' && p.length === 1 && /\(edited\)/.test(p[0].content) && /blocked off/.test(p[0].content), 'edit keeps type, posts (edited)'); }
a0 = auditCount(); await failsWith(() => fm.editChangeLog(99999, { name: 'x' }), null, 'edit unknown change'); ok(auditCount() === a0 && pings(log).length === 0, 'no audit, no post');
{ const r = await fm.deleteChangeLog(drop.id); const p = pings(log); ok(r.ok && p.length === 1 && /entry deleted/.test(p[0].content) && !/Doctor Removed/.test(p[0].content), 'delete posts an "entry deleted" notice'); }
await failsWith(() => fm.deleteChangeLog(99999), null, 'delete unknown change'); pass('change log');

// ── scene library ──
as('tok-l1'); log.length = 0; const sc = await fm.addSceneLibraryEntry({ title: 'Guide idea', description: 'd', staff_required: 'abc', spawning_required: true, spawning_details: '2x car', ped_required: 1, tags: 'a, b, , a' });
{ const p = log.splice(0).filter(e => /\/channels\/\d+\/messages/.test(e.url)); const row = queryOne('SELECT status, staff_required, tags FROM scene_library WHERE id=?', [sc.id]);
  ok(sc.ok && row.status === 'idea' && p.length === 1 && /1469503845095702692/.test(p[0].url) && /\/v2\/story\?tab=scenes/.test(p[0].body.embeds[0].url), 'idea → story.scene_idea embed with v2 url'); ok(row.tags === 'a, b' && row.staff_required === 1, 'tags normalised, staff defaulted'); }
await failsWith(() => fm.addSceneLibraryEntry({ description: 'no title' }), /title/i, 'idea no title'); await rejects(() => fm.setSceneLibraryStatus(sc.id, 'approved'), 'AUTH_INSUFFICIENT', 'L1 cannot approve');
as('tok-l2'); log.length = 0; { const r = await fm.addSceneLibraryFeedback(sc.id, 'Needs work'); const p = pings(log); ok(r.ok && p.length === 1 && p[0].ch === '1457201300583485491' && /<@100000000000000001>/.test(p[0].content) && /v2\/story\?tab=scenes/.test(p[0].content), 'feedback pings the author'); }
await failsWith(() => fm.addSceneLibraryFeedback(sc.id, '   '), /required/i, 'blank feedback'); await failsWith(() => fm.addSceneLibraryFeedback(99999, 'x'), /not found/i, 'feedback unknown scene');
as('tok-lst'); log.length = 0; { const r = await fm.setSceneLibraryStatus(sc.id, 'approved'); const p = pings(log); ok(r.ok && queryOne('SELECT status FROM scene_library WHERE id=?', [sc.id]).status === 'approved' && p.length === 1 && /approved/.test(p[0].content) && /<@100000000000000001>/.test(p[0].content), 'LST approves + decision ping'); ok(lastAudit().action === 'APPROVE' && String(lastAudit().target_id) === String(sc.id), 'approve audited'); }
await failsWith(() => fm.setSceneLibraryStatus(sc.id, 'bogus'), /status/i, 'bogus status'); eq((await fm.setSceneLibraryStatus(sc.id, 'approved')).changed, false, 'unchanged status is a no-op');
await rejects(() => fm.editSceneLibraryEntry(sc.id, { title: 'LST edit' }), 'AUTH_INSUFFICIENT', 'LST cannot edit'); await rejects(() => fm.deleteSceneLibraryEntry(sc.id), 'AUTH_INSUFFICIENT', 'LST cannot delete'); await rejects(() => fm.addSceneLibraryFeedback(sc.id, 'x'), 'AUTH_INSUFFICIENT', 'LST cannot leave feedback');
as('tok-et'); ok((await fm.editSceneLibraryEntry(sc.id, { title: 'ET edit', status: 'idea', staff_required: 3 })).ok && queryOne('SELECT status, staff_required FROM scene_library WHERE id=?', [sc.id]).status === 'idea' && queryOne('SELECT staff_required FROM scene_library WHERE id=?', [sc.id]).staff_required === 3, 'ET edits incl. status');
as('tok-l2'); await failsWith(() => fm.editSceneLibraryEntry(sc.id, { title: 'x', status: 'bogus_status' }), /status/i, 'edit bogus status'); a0 = auditCount(); await failsWith(() => fm.editSceneLibraryEntry(99999, { title: 'x' }), null, 'edit unknown scene'); eq(auditCount(), a0, 'no audit');
{ const fb = queryOne('SELECT COUNT(*) c FROM scene_library_feedback WHERE scene_id=?', [sc.id]).c; log.length = 0; const r = await fm.deleteSceneLibraryEntry(sc.id); const p = pings(log); ok(r.ok && fb > 0 && queryOne('SELECT COUNT(*) c FROM scene_library_feedback WHERE scene_id=?', [sc.id]).c === 0 && p.length === 1 && /removed/.test(p[0].content), 'delete removes feedback + notifies author'); }
await failsWith(() => fm.deleteSceneLibraryEntry(99999), null, 'delete unknown scene'); as('tok-l1'); eq((await fm.getSceneLibraryFeedback('abc')).length, 0, 'feedback bad id → []'); pass('scene library');

// ── peds ──
as('tok-lst'); const p1 = await v2.getPedsPage({ page: 1 }); ok(p1.rows.length === 48 && p1.per === 48 && p1.total > 1000 && p1.pages === Math.ceil(p1.total / 48) && p1.categories.length > 0 && p1.tagCounts.length > 0, 'page 1 with facets');
as('tok-l1'); { const r = await v2.getPedsPage({ page: 999 }); ok(r.page === r.pages && r.rows.length > 0, 'page beyond end clamps'); }
{ const r = await v2.getPedsPage({ q: 'a_m_m_' }); ok(r.matched > 0 && r.matched < p1.total && r.rows.every(x => x.model_name.includes('a_m_m_')), 'search by model prefix'); }
{ const tag = queryOne('SELECT value FROM peds, json_each(peds.tags) GROUP BY value ORDER BY COUNT(*) DESC LIMIT 1').value; const r = await v2.getPedsPage({ tags: [tag], per: 10 }); ok(r.rows.length === 10 && r.rows.every(x => x.tags.includes(tag)) && r.matched === queryOne('SELECT COUNT(*) c FROM peds WHERE EXISTS (SELECT 1 FROM json_each(peds.tags) WHERE value=?)', [tag]).c, 'tag filter'); }
{ const r = await v2.getPedsPage({ q: "x' OR 1=1 --", imageOnly: true, per: 5000, page: -3 }); ok(r.per === 48 && r.page === 1 && r.matched === 0, 'hostile input is safe'); }
as('tok-l2'); await failsWith(() => v2.updatePedTags(1, 'not-an-array', ''), /list/i, 'tags must be a list'); eq(JSON.stringify((await v2.updatePedTags(1, [{ a: 1 }, 42, null, ' Biker ', 'biker'], ' note ')).tags), JSON.stringify(['42', 'biker']), 'tags cleaned + deduped'); await failsWith(() => v2.updatePedTags(99999, [], ''), null, 'unknown ped'); pass('peds');
