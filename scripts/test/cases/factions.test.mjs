// Faction actions (dashboard/src/app/fm/factions/actions.js): rename cascade,
// team scoping, archived/unknown guards, members, properties, notes, portal,
// deletion requests, links, promotions, archive/restore, RP change requests.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne } from '../../../shared/db.js';
const log = captureDiscord((e) => e.url.includes('/users/') ? { json: { username: 'fetched-' + e.url.split('/').pop() } } : null);
process.env.OPENAI_API_KEY = '';
const A = await import('../../../dashboard/src/app/fm/factions/actions.js');
const { sanitizeHtml } = await import('../../../dashboard/src/app/fm/leadership/_shared/sanitize.js');
const audit = () => queryOne('SELECT actor_name, action, target_type, target_id, target_label, details FROM site_audit_log ORDER BY id DESC LIMIT 1');
const auditCount = () => queryOne('SELECT COUNT(*) c FROM site_audit_log').c;
const hist = (fid) => queryOne('SELECT action_type, faction_name, details FROM faction_history WHERE faction_id=? ORDER BY id DESC LIMIT 1', [fid]);

// ── sanitizer ──
{ const clean = sanitizeHtml('<p onclick="x()">hi <script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://ok">ok</a><img src=x onerror=alert(1)><strong style="color:red">s</strong></p>');
  ok(!/script|onclick|onerror|javascript:|<img/.test(clean), 'sanitizer strips scripts/handlers/javascript: urls'); ok(/href="https:\/\/ok"/.test(clean), 'sanitizer keeps https links'); } pass('sanitizer');

// ── rename cascade ──
as('tok-l2'); await rejects(() => A.renameFaction(1, 'The Vanguard', 'X'), 'AUTH_INSUFFICIENT', 'rename L2');
as('tok-l3'); await failsWith(() => A.renameFaction(1, 'The Vanguard', 'harbor syndicate'), null, 'rename duplicate'); await failsWith(() => A.renameFaction(1, 'The Vanguard', '  '), null, 'rename empty');
await failsWith(() => A.renameFaction(3, 'Old Crew', 'New Crew'), /archived/, 'rename archived'); await failsWith(() => A.renameFaction(999, 'x', 'y'), null, 'rename unknown');
ok((await A.renameFaction(1, 'The Vanguard', 'Vanguard Reborn')).ok, 'rename ok');
{ ok(queryOne('SELECT aliases FROM factions WHERE id=1').aliases.includes('The Vanguard'), 'old name kept as alias');
  const stale = [
    "SELECT COUNT(*) c FROM faction_reviews WHERE faction_id=1 AND faction_name!='Vanguard Reborn'", "SELECT COUNT(*) c FROM leadership_personal_notes WHERE faction_id=1 AND faction_name!='Vanguard Reborn'",
    "SELECT COUNT(*) c FROM faction_public_messages WHERE faction_id=1 AND faction_name!='Vanguard Reborn'", "SELECT COUNT(*) c FROM faction_ic_contacts WHERE faction_id=1 AND faction_name!='Vanguard Reborn'",
    "SELECT COUNT(*) c FROM faction_ic_messages WHERE faction_id=1 AND faction_name!='Vanguard Reborn'", "SELECT COUNT(*) c FROM faction_history WHERE faction_id=1 AND action_type!='RENAME' AND faction_name!='Vanguard Reborn'",
    "SELECT COUNT(*) c FROM treasury_logs WHERE faction_name='The Vanguard'", "SELECT COUNT(*) c FROM staff_coi WHERE faction_name='The Vanguard'", "SELECT COUNT(*) c FROM ooc_notes WHERE faction_id=1 AND target_label!='Vanguard Reborn'",
  ].map(sql => queryOne(sql).c);
  ok(stale.every(v => v === 0), 'no stale name copies: ' + stale.join(','));
  ok(hist(1).action_type === 'RENAME' && hist(1).details === 'The Vanguard → Vanguard Reborn', 'RENAME history row'); }
ok((await A.renameFaction(1, 'x', 'The Vanguard')).ok, 'rename back'); pass('rename');

// ── members / scoping ──
as('tok-l1'); await failsWith(() => A.addMember(4, 'Harbor Syndicate', { name: 'Intruder' }), /outside your team/, 'L1 cross-team member');
const m = await A.addMember(1, 'NOT VANGUARD', { name: 'New Guy', role: 2 }); ok(m.ok && m.id, 'L1 own-team member');
ok(hist(1).faction_name === 'The Vanguard' && audit().target_id === String(m.id), 'history uses server name, audit has id');
as('tok-l3'); await failsWith(() => A.addMember(3, 'Old Crew', { name: 'Ghost' }), /archived/, 'member on archived'); await failsWith(() => A.addMember(1, '', { name: 'X', role: 'abc' }), null, 'bad role');
await failsWith(() => A.addMember(999, '', { name: 'X' }), null, 'member unknown faction');
as('tok-et'); await rejects(() => A.addMember(1, '', { name: 'X' }), 'AUTH_INSUFFICIENT', 'ET read-only');
as('tok-l1'); ok((await A.updateMember(m.id, { phone: '555' })).ok && queryOne('SELECT character_name FROM faction_members WHERE id=?', [m.id]).character_name === 'New Guy', 'partial update keeps name');
as('tok-l3'); await failsWith(() => A.updateMember(9999, { name: 'x' }), null, 'update unknown member');
as('tok-l1'); { const ac = auditCount(); ok((await A.deleteMember(m.id)).ok, 'delete member'); await failsWith(() => A.deleteMember(m.id), null, 'second delete'); eq(auditCount(), ac + 1, 'one audit row'); } pass('members');

// ── properties / notes / portal / contacts ──
await rejects(() => A.addFactionProperty(1, '', { address: '1 St', type: 'Property' }), 'AUTH_INSUFFICIENT', 'L1 property');
as('tok-l2'); await failsWith(() => A.addFactionProperty(1, '', { address: '1 St', type: 'Castle' }), null, 'bad property type');
// Policy 16: below leadership a property change becomes an RP-change request; leadership writes directly.
{ const before = queryOne('SELECT COUNT(*) c FROM properties WHERE faction_id=1').c; const r = await A.addFactionProperty(1, '', { address: '7 Queue Rd', type: 'Property' });
  ok(r.ok && r.queued && r.requestId && /approval/.test(r.notice), 'L2 property add is queued'); eq(queryOne('SELECT COUNT(*) c FROM properties WHERE faction_id=1').c, before, 'nothing written yet');
  const pe = queryOne('SELECT * FROM pending_executions WHERE id=?', [r.requestId]); ok(pe && pe.execution_type === 'PROPERTY' && pe.old_value === 'N/A' && pe.new_value === '7 Queue Rd' && pe.status === 'PENDING', 'PROPERTY request recorded'); }
as('tok-l3'); { const r = await A.addFactionProperty(1, '', { address: '99 New HQ', type: 'HQ', isHQ: true }); ok(r.ok && !r.queued && queryOne('SELECT COUNT(*) c FROM properties WHERE faction_id=1 AND is_hq=1').c === 1, 'L3 writes directly, one HQ only'); ok(/^\d{4}-\d{2}-\d{2}$/.test(queryOne('SELECT date_given FROM properties WHERE id=?', [r.id]).date_given), 'ISO date_given'); } as('tok-l2');
await failsWith(() => A.deleteFactionProperty(3), null, 'cross-team property delete');
await failsWith(() => A.editNote(1, 'overwritten'), null, 'edit note not author'); eq(queryOne('SELECT text FROM intel_notes WHERE id=1').text, 'Rumoured to be moving weapons via the docks', 'note untouched');
as('tok-l1'); ok((await A.editNote(1, 'edited by author')).ok, 'author edits note'); ok((await A.editSceneLog(1, 'edited scene')).ok, 'author edits scene');
as('tok-l2'); await failsWith(() => A.editSceneLog(1, 'hijack'), null, 'non-author scene edit');
as('tok-l3'); await failsWith(() => A.addNote(1, '', null), null, 'null note');
as('tok-l1'); { const r = await A.addOOCNote(1, '', '<p>meet</p><script>x</script>', ['100000000000000001', 'bad']); const row = queryOne('SELECT text, target_label FROM ooc_notes WHERE id=?', [r.id]); ok(r.ok && !/script/.test(row.text) && row.target_label === 'The Vanguard', 'OOC note sanitised with label'); }
await failsWith(() => A.postPortalMessage(1, '', '   ', false), null, 'blank portal message'); await failsWith(() => A.postPortalMessage(4, '', 'hi', false), null, 'portal cross-team');
ok((await A.togglePortalMessagePin(1)).ok && audit().target_type === 'portal_message', 'pin audited'); ok((await A.markContactRead(1)).ok && audit().target_type === 'ic_contact', 'contact read audited');
await failsWith(() => A.requestDeletion('faction', 'x', 1), null, 'bad deletion type');
ok((await A.requestDeletion('intel_note', 'x', 1)).ok, 'request deletion'); await failsWith(() => A.requestDeletion('intel_note', 'x', 1), null, 'deletion dedupe');
as('tok-l3'); ok((await A.directDelete('intel_note', 1)).ok && queryOne("SELECT status FROM deletion_requests WHERE content_type='intel_note' AND target_row_id=1").status === 'APPROVED', 'direct delete resolves request');
await failsWith(() => A.directDelete('intel_note', 1), null, 'direct delete unknown');
as('tok-l2'); await failsWith(() => A.updateFactionLinks(4, 'forum', 'https://f'), null, 'links cross-team'); await failsWith(() => A.updateFactionLinks(1, 'forum', 'ftp://f'), null, 'bad url');
ok((await A.updateFactionLinks(1, 'forum', 'https://forum.example')).ok && hist(1).action_type === 'LINK_UPDATED', 'links ok + history');
as('tok-l3'); await failsWith(() => A.updateFactionLinks(999, 'forum', 'https://f'), null, 'links unknown');
await failsWith(() => A.toggleFactionImport(1, 999, true), null, 'unknown import item'); await failsWith(() => A.toggleFactionImport(3, 1, true), null, 'import on archived');
as('tok-l2'); await failsWith(() => A.aiSummarize('The Vanguard'), /API key/, 'AI reaches key check'); await failsWith(() => A.aiSummarize('Harbor Syndicate'), /outside/, 'AI cross-team');
as('tok-et'); ok((await A.getStaffForTeam('The Vanguard')).length > 0, 'ET reads team staff');
as('tok-lst'); { const d = await A.getFactionDetail('The Vanguard'); ok(d.writable === false && d.leadName === 'Lead Two' && /Guide One/.test(d.guidesText), 'LST read-only detail'); }
as('tok-l2'); { const fs = await A.getFactions(); ok(fs.find(f => f.name === 'The Vanguard').writable === true && fs.find(f => f.name === 'Harbor Syndicate').writable === false, 'writable flags'); } pass('properties / notes / portal / links');

// ── promotions ──
as('tok-l3'); ok((await A.completePromotion(4)).ok && queryOne('SELECT tier FROM factions WHERE id=4').tier === 4, 'legacy pending_promo "4" completes');
await failsWith(() => A.completePromotion(4), null, 'nothing staged'); as('tok-l2'); await failsWith(() => A.cancelPromotion(1), null, 'cancel with nothing staged');
as('tok-l3'); await failsWith(() => A.stagePromotion(1, '', 2, []), null, 'stage tier <= current'); await failsWith(() => A.stagePromotion(1, '', 3, ['Bogus']), null, 'stage unknown item');
await failsWith(() => A.stagePromotion(3, '', 3, []), null, 'stage archived'); as('tok-l2'); await rejects(() => A.stagePromotion(1, '', 3, []), 'AUTH_INSUFFICIENT', 'stage L2');
as('tok-l3'); log.length = 0; ok((await A.stagePromotion(1, 'ignored', '3', ['Armor Pack'])).ok && pings(log).length === 1, 'stage ok + ping');
as('tok-lst'); await rejects(() => A.completePromotion(1), 'AUTH_INSUFFICIENT', 'LST cannot complete');
as('tok-l2'); ok((await A.completePromotion(1)).ok, 'lead completes');
eq(query('SELECT i.name FROM faction_imports fi JOIN import_items i ON i.id=fi.item_id WHERE fi.faction_id=1 AND fi.permitted=1 ORDER BY i.name').map(x => x.name).join(), 'Armor Pack,Pistol Crate,SMG Crate', 'promotion unions imports');
as('tok-l3'); await failsWith(() => A.demoteFaction(1, '', 'abc'), null, 'demote bad tier');
{ const r = await A.demoteFaction(1, '', 1); ok(r.ok && r.revoked.includes('SMG Crate') && queryOne('SELECT tier FROM factions WHERE id=1').tier === 1, 'demote revokes T2 items'); } pass('promotions');

// ── archive / restore ──
await failsWith(() => A.restoreFaction(999), null, 'restore unknown'); ok(audit().action !== 'RESTORE', 'no audit for unknown restore');
await failsWith(() => A.restoreFaction(1), null, 'restore active');
ok((await A.deleteFaction(2)).ok && queryOne('SELECT archived FROM factions WHERE id=2').archived === 1, 'archive');
eq(queryOne('SELECT status FROM pending_executions WHERE id=2').status, 'DENIED', 'open RP denied on archive'); eq(hist(2).action_type, 'ARCHIVED', 'ARCHIVED history');
await failsWith(() => A.deleteFaction(2), null, 'archive twice');
as('tok-l1'); { const names = await A.getFactionNames(); ok(!names.includes('Los Santos Kings') && !names.includes('Old Crew'), 'picker hides archived'); }
as('tok-l3'); ok((await A.restoreFaction(2)).ok && queryOne('SELECT archived FROM factions WHERE id=2').archived === 0 && hist(2).action_type === 'RESTORED', 'restore'); pass('archive / restore');

// ── RP change requests ──
as('tok-l1'); await rejects(() => A.requestRPChange({ factionId: 1, type: 'HQ', oldValue: '12 Grove St', newValue: 'New place' }), 'AUTH_INSUFFICIENT', 'RP L1');
as('tok-lst'); await rejects(() => A.requestRPChange({ factionId: 1, type: 'HQ', oldValue: '12 Grove St', newValue: 'New place' }), 'AUTH_INSUFFICIENT', 'RP LST');
as('tok-l2'); await failsWith(() => A.requestRPChange({ faction: 'Harbor Syndicate', type: 'HQ', oldValue: 'x', newValue: 'y' }), null, 'RP cross-team by name');
await failsWith(() => A.requestRPChange({ factionId: 1, type: 'Weird', newValue: 'y' }), null, 'RP bad type'); await failsWith(() => A.requestRPChange({ factionId: 1, type: 'HQ', oldValue: 'x' }), null, 'RP no newValue');
as('tok-l3'); await failsWith(() => A.requestRPChange({ factionId: 3, type: 'HQ', oldValue: 'x', newValue: 'y' }), null, 'RP archived');
as('tok-l2'); log.length = 0; const rp = await A.requestRPChange({ factionId: 1, type: 'NPC', npcId: 1, oldValue: 'Dealer', newValue: 'Fence', turf: 'Grove Street', contactId: 1 });
{ const p = pings(log); const e = queryOne('SELECT * FROM pending_executions WHERE id=?', [rp.id]);
  ok(rp.ok && p.some(x => x.comps.length), 'RP request pinged with buttons'); ok(e.npc_id === 1 && e.contact_id === 1 && e.status === 'PENDING', 'npc_id/contact_id recorded');
  eq(queryOne('SELECT status FROM faction_ic_contacts WHERE id=1').status, 'pending_roleplay', 'contact advanced'); eq(audit().target_id, String(rp.id), 'audit has request id'); }
await failsWith(() => A.requestRPChange({ factionId: 1, type: 'NPC', npcId: 1, newValue: 'Fence' }), /already/, 'RP dedupe');
as('tok-l3'); await failsWith(() => A.requestRPChange({ factionId: 4, type: 'Other', newValue: 'thing', contactId: 1 }), null, 'contact of another faction');
ok((await A.requestRPChange({ factionId: 4, type: 'TURF', oldValue: 'Docks', newValue: 'Vespucci' })).ok, 'TURF request'); pass('RP change requests');

// ── addFaction ──
await failsWith(() => A.addFaction({ name: '' }), null, 'addFaction empty'); await failsWith(() => A.addFaction({ name: 'the vanguard', tier: 1 }), null, 'addFaction dup (case)');
await failsWith(() => A.addFaction({ name: 'Newbies', tier: 'abc' }), null, 'addFaction bad tier'); as('tok-et'); await rejects(() => A.addFaction({ name: 'ETF', tier: 1 }), 'AUTH_INSUFFICIENT', 'ET addFaction');
as('tok-l3'); { const r = await A.addFaction({ name: 'Newbies', tier: '1', teamId: 'team_cup', hqAddress: '5 New St' });
  ok(r.ok && query('SELECT action_type FROM faction_history WHERE faction_id=?', [r.id]).some(h => h.action_type === 'CREATED') && queryOne('SELECT last_promoted FROM factions WHERE id=?', [r.id]).last_promoted === null, 'created with history, last_promoted null'); } pass('addFaction');
