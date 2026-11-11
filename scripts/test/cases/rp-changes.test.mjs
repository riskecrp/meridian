// RP change requests (dashboard/src/app/fm/operations/actions.js + shared/rpChanges.js):
// state machine order (PENDING → APPROVED → RP_DONE → EXECUTED / DENIED),
// requester DMs with channel fallback, execution effects per type.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
const flags = { dmFail: false };
const log = captureDiscord((e) => {
  if (e.url.includes('/users/@me/channels') && !flags.dmFail) return { json: { id: '999' + String(e.body?.recipient_id || '').slice(-16).padStart(16, '0') } };
  if (e.url.includes('/users/@me/channels')) return { status: 403, json: {} };
  return null;
});
const A = await import('../../../dashboard/src/app/fm/operations/actions.js');
const RP = await import('../../../shared/rpChanges.js');
const ALT = '1494694133862760578', REQUESTER_CH = '1469503845095702692', today = new Date().toISOString().slice(0, 10);
const isDm = (p) => p.ch.startsWith('999');
const audit = () => queryOne('SELECT action, target_id, source FROM site_audit_log ORDER BY id DESC LIMIT 1');
const newExec = (sql, p = []) => { run(sql, p); return queryOne('SELECT id FROM pending_executions ORDER BY id DESC LIMIT 1').id; };

// ── reads ──
as('tok-l3'); eq((await A.getPendingExecutions()).length, 2, 'L3 pending list'); as('tok-l2'); await rejects(() => A.getPendingExecutions(), 'AUTH_INSUFFICIENT', 'L2 pending list');
eq((await A.getMyRPRequests()).length, 2, 'L2 own requests'); as('tok-et'); eq((await A.getMyRPRequests()).length, 0, 'ET own requests (none)'); pass('reads');

// ── approve ──
as('tok-l3'); await failsWith(() => A.approveRPChange(2), /approved/i, 'approve already-approved'); await failsWith(() => A.approveRPChange(999), null, 'approve unknown');
as('tok-l2'); await rejects(() => A.approveRPChange(1), 'AUTH_INSUFFICIENT', 'L2 approve');
as('tok-l3'); log.length = 0; { const r = await A.approveRPChange(1); const p = pings(log); const row = queryOne('SELECT status, approver_id FROM pending_executions WHERE id=1');
  ok(r.ok && r.status === 'APPROVED' && row.status === 'APPROVED' && row.approver_id === '100000000000000003', 'approved with approver');
  eq(queryOne("SELECT COUNT(*) c FROM faction_history WHERE action_type='RP_CHANGE_APPROVED'").c, 1, 'history row'); ok(audit().action === 'APPROVE' && audit().target_id === '1', 'audit APPROVE');
  ok(p.some(x => isDm(x) && x.comps.some(c => /^rpc:done:1$/.test(c))), 'requester DM with Confirm button'); } pass('approve');

// ── deny / resubmit ──
const e3 = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,1,'Other','N/A','N/A','Something','Lead Two','PENDING','100000000000000002')", [today]);
await failsWith(() => A.denyRPChange(e3, ''), null, 'deny needs reason'); ok((await A.denyRPChange(e3, 'Not enough context')).ok, 'deny');
{ const r = queryOne('SELECT status, deny_reason, resolved_at FROM pending_executions WHERE id=?', [e3]); ok(r.status === 'DENIED' && r.deny_reason === 'Not enough context' && !!r.resolved_at, 'DENIED + reason + resolved_at'); }
as('tok-l1'); await failsWith(() => A.resubmitRPChange(e3, 'x'), null, 'resubmit not requester');
as('tok-l2'); log.length = 0; ok((await A.resubmitRPChange(e3, 'More context')).ok, 'resubmit');
{ const r = queryOne('SELECT status, deny_reason, rp_note, resolved_at FROM pending_executions WHERE id=?', [e3]); ok(r.status === 'PENDING' && r.deny_reason === '' && r.rp_note === 'More context' && r.resolved_at === null, 'back to PENDING, reason cleared'); ok(pings(log).some(x => x.ch === ALT && x.comps.some(c => /^rpc:approve:/.test(c))), 'rp.resubmitted ping with Approve/Deny'); }
await failsWith(() => A.markRPDone(e3, 'played'), null, 'done while PENDING refused'); pass('deny / resubmit');

// ── done ──
as('tok-l1'); await failsWith(() => A.markRPDone(1, ''), null, 'done by non-requester L1');
as('tok-l2'); log.length = 0; ok((await A.markRPDone(1, 'Scene played')).ok && queryOne('SELECT status FROM pending_executions WHERE id=1').status === 'RP_DONE', 'requester marks RP_DONE'); ok(pings(log).some(x => x.comps.some(c => /^rpc:exec:1$/.test(c))), 'rp.done ping with Execute'); pass('done');

// ── execute NPC ──
await rejects(() => A.executeRPChange(1, { npcName: 'X', npcPos: '1 2 3' }), 'AUTH_INSUFFICIENT', 'L2 execute');
as('tok-l3'); await failsWith(() => A.executeRPChange(1, { npcName: 'Big Smoke Jr', npcPos: '10 20 30' }), /No NPC/, 'seed old_value is a name → no match, nothing executed');
ok(queryOne('SELECT status FROM pending_executions WHERE id=1').status === 'RP_DONE' && queryOne('SELECT name FROM npcs WHERE id=1').name === 'Big Smoke', 'status + npc untouched');
await failsWith(() => A.getRPExecutionPreview(1), null, 'preview says no match'); run('UPDATE pending_executions SET npc_id = 1 WHERE id = 1');
{ const r = await A.getRPExecutionPreview(1); ok(r.ok && r.by === 'id' && r.target.name === 'Big Smoke', 'preview by npc_id'); }
await failsWith(() => A.executeRPChange(1, { npcName: 'Big Smoke Jr' }), /position/, 'name + position required');
run("UPDATE faction_ic_contacts SET rp_change_id = 1, status = 'pending_roleplay' WHERE id = 1"); log.length = 0;
{ const r = await A.executeRPChange(1, { npcName: 'Big Smoke Jr', npcPos: '10 20 30' }); const p = pings(log); const n = queryOne('SELECT name, position, npc_type FROM npcs WHERE id=1'); const row = queryOne('SELECT status, resolved_at FROM pending_executions WHERE id=1');
  ok(r.ok && r.status === 'EXECUTED' && n.name === 'Big Smoke Jr' && n.position === '10 20 30' && n.npc_type === 'Big Smoke (relocated)', 'NPC rewritten'); ok(row.status === 'EXECUTED' && !!row.resolved_at, 'EXECUTED + resolved_at');
  eq(queryOne('SELECT status FROM faction_ic_contacts WHERE id=1').status, 'completed', 'linked IC contact completed'); eq(audit().action, 'EXECUTE', 'audit EXECUTE');
  ok(p.some(x => x.ch === ALT && /Executed/.test(x.content)) && p.some(isDm), 'rp.executed ping + requester DM'); }
await failsWith(() => A.executeRPChange(1, { npcName: 'Y', npcPos: '1' }), null, 'execute twice'); pass('execute NPC');

// ── HQ ──
await failsWith(() => A.executeRPChange(2, {}), null, 'execute while APPROVED'); ok((await A.markRPDone(2, '')).ok, 'L3 may confirm RP done'); ok((await A.executeRPChange(2, {})).ok, 'execute HQ');
{ const p = queryOne('SELECT address, property_type, is_hq, date_given FROM properties WHERE faction_id=2 AND is_hq=1'); ok(p && p.address === 'New HQ at 9 Alta St' && p.property_type === 'HQ' && p.date_given === today, 'new HQ row'); }
const eHQ = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,1,'HQ','N/A','12 Grove St','44 vespucci blvd','Lead Two','RP_DONE','100000000000000002')", [today]);
ok((await A.executeRPChange(eHQ, {})).ok, 'HQ move (case-insensitive match)');
ok(queryOne('SELECT COUNT(*) c FROM properties WHERE faction_id=1 AND is_hq=1').c === 1 && queryOne("SELECT property_type FROM properties WHERE address='12 Grove St'").property_type === 'Property' && queryOne("SELECT property_type FROM properties WHERE address='44 Vespucci Blvd'").property_type === 'HQ', 'one HQ, types consistent'); pass('execute HQ');

// ── TURF ──
const eT = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,1,'TURF','Docks','Docks','Harbor','Lead Two','RP_DONE','100000000000000002')", [today]);
ok((await A.executeRPChange(eT, {})).ok, 'turf rename'); ok(!!queryOne("SELECT 1 FROM turfs WHERE name='Harbor'") && !queryOne("SELECT 1 FROM turfs WHERE name='Docks'") && queryOne('SELECT turf FROM npcs WHERE id=2').turf === 'Harbor', 'turf renamed + npcs moved');
const eT2 = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id, npc_id) VALUES (?,1,'TURF','Harbor','Harbor','Grove Street','Lead Two','RP_DONE','100000000000000002', 2)", [today]);
ok((await A.executeRPChange(eT2, {})).ok, 'turf npc move'); { const n = queryOne('SELECT turf, shipment_power FROM npcs WHERE id=2'); ok(n.turf === 'Grove Street' && n.shipment_power === 'High', 'npc moved keeping power'); }
const eT3 = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,1,'TURF','Nowhere','Nowhere','Elsewhere','Lead Two','RP_DONE','100000000000000002')", [today]);
await failsWith(() => A.executeRPChange(eT3, {}), null, 'unknown turf refused'); eq(queryOne('SELECT status FROM pending_executions WHERE id=?', [eT3]).status, 'RP_DONE', 'status kept'); pass('execute TURF');

// ── PROPERTY ──
const eP = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,1,'PROPERTY','N/A','N/A','7 Alta St','Lead Two','RP_DONE','100000000000000002')", [today]);
ok((await A.executeRPChange(eP, {})).ok && queryOne("SELECT faction_id FROM properties WHERE address='7 Alta St'")?.faction_id === 1, 'property added');
const eP2 = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,1,'PROPERTY','N/A','7 Alta St','REMOVED','Lead Two','RP_DONE','100000000000000002')", [today]);
ok((await A.executeRPChange(eP2, {})).ok && queryOne("SELECT faction_id FROM properties WHERE address='7 Alta St'").faction_id === null, 'property removed (unassigned)');
const eP3 = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,1,'PROPERTY','N/A','Nope St','Whatever','Lead Two','RP_DONE','100000000000000002')", [today]);
await failsWith(() => A.executeRPChange(eP3, {}), null, 'unknown old address'); pass('execute PROPERTY');

// ── ambiguous NPC / archived / delete ──
run("INSERT INTO npcs (name, position, npc_type, turf) VALUES ('Twin A','1 1 1','Runner','Vespucci'),('Twin B','2 2 2','Runner','Vespucci')");
const eA = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,1,'NPC','Vespucci','Runner','Courier','Lead Two','RP_DONE','100000000000000002')", [today]);
await failsWith(() => A.executeRPChange(eA, { npcName: 'Z', npcPos: '0 0 0' }), /2 NPCs/, 'ambiguous NPC refused');
const twinB = queryOne("SELECT id FROM npcs WHERE name='Twin B'").id; ok((await A.executeRPChange(eA, { npcName: 'Twin B2', npcPos: '0 0 0', npcId: twinB })).ok && queryOne('SELECT npc_type FROM npcs WHERE id=?', [twinB]).npc_type === 'Courier' && queryOne("SELECT 1 FROM npcs WHERE name='Twin A'"), 'npcId disambiguates');
const eArc = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,3,'Other','N/A','N/A','x','Lead Two','PENDING','100000000000000002')", [today]);
await failsWith(() => A.approveRPChange(eArc), /archived/, 'approve on archived faction');
as('tok-l2'); await rejects(() => A.deleteRPChange(e3), 'AUTH_INSUFFICIENT', 'L2 delete');
as('tok-l3'); run("UPDATE faction_ic_contacts SET rp_change_id = ?, status = 'pending_roleplay' WHERE id = 1", [e3]); log.length = 0;
ok((await A.deleteRPChange(e3, 'duplicate')).ok && !queryOne('SELECT 1 FROM pending_executions WHERE id=?', [e3]) && pings(log).some(x => isDm(x) && /withdrawn/.test(x.content)), 'deleted + requester told');
eq(queryOne('SELECT status FROM faction_ic_contacts WHERE id=1').status, 'pending_discussion', 'contact detached back to discussion'); await failsWith(() => A.deleteRPChange(999), null, 'delete unknown'); pass('ambiguous / archived / delete');

// ── DM fallback + bot actor via shared ──
flags.dmFail = true; const eF = newExec("INSERT INTO pending_executions (date, faction_id, execution_type, turf, old_value, new_value, requested_by, status, requester_id) VALUES (?,1,'Other','N/A','N/A','fallback test','Lead Two','PENDING','100000000000000002')", [today]);
log.length = 0; ok((await A.approveRPChange(eF)).ok && pings(log).some(x => x.ch === REQUESTER_CH && /<@100000000000000002>/.test(x.content) && x.comps.some(c => /^rpc:done:/.test(c))), 'DM failure falls back to rp.requester channel'); flags.dmFail = false;
{ const r = await RP.markRPDone({ id: '100000000000000003', name: 'Mgmt Three', level: 3, source: 'bot' }, eF, 'via bot'); ok(r.ok && audit().source === 'bot', 'shared markRPDone audits source=bot'); }
ok(!(await RP.approveRPChange({ id: '100000000000000002', name: 'Lead Two', level: 2, source: 'bot' }, eF)).ok, 'shared refuses L2 approve'); pass('DM fallback + shared');

// ── verify in game (post-EXECUTED flag; the full matrix is in queue.test.mjs) ──
// Request #1 was executed above by L3 and requested by Lead Two (L2).
as('tok-l1'); await failsWith(() => A.verifyRPChange(1, ''), /requester|Leadership/i, 'verify by a non-requester L1 refused');
await failsWith(() => A.verifyRPChange(eF, ''), /executed/i, 'verify on a non-executed row refused');
ok(RP.unverifiedExecutions().some(r => r.id === 1 && r.awaiting_verification), 'executed #1 awaits verification');
run("UPDATE faction_ic_contacts SET rp_change_id = 1, thread_id = '620000000000000001' WHERE id = 1");   // the request came from this IC thread
as('tok-l2'); log.length = 0; { const r = await A.verifyRPChange(1, 'Checked the NPC in city');
  const row = queryOne('SELECT status, verified_at, verified_by FROM pending_executions WHERE id = 1');
  ok(r.ok && row.status === 'EXECUTED' && row.verified_by === 'Lead Two' && !!row.verified_at, 'requester verifies; status stays EXECUTED');
  ok(audit().action === 'VERIFY' && audit().target_id === '1', 'audit VERIFY');
  eq(queryOne("SELECT COUNT(*) c FROM faction_history WHERE action_type = 'RP_VERIFIED' AND faction_id = 1").c, 1, 'history RP_VERIFIED');
  ok(pings(log).some(x => x.ch === '620000000000000001' && /verified in game/.test(x.content)), 'note posted to the linked IC thread'); }
await failsWith(() => A.verifyRPChange(1, 'again'), /already verified/i, 'double verify refused');
ok(!RP.unverifiedExecutions().some(r => r.id === 1), 'verified rows leave the unverified list');
{ const r = await RP.verifyRPChange({ id: '100000000000000003', name: 'Mgmt Three', level: 3, source: 'bot' }, 2); ok(r.ok && audit().source === 'bot' && queryOne('SELECT verified_by FROM pending_executions WHERE id = 2').verified_by === 'Mgmt Three', 'L3 via bot verifies #2, audits source=bot'); }
pass('verify in game');
