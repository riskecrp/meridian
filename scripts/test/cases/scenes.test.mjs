// Scene logging, inventory and faction feedback actions.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne } from '../../../shared/db.js';
const log = captureDiscord((e) => {
  if (/\/messages\?/.test(e.url)) return { json: [{ id: '1', content: 'hi', author: { username: 'u', bot: false }, timestamp: '2026-11-10T00:00:00Z' }] };
  if (/\/channels\/\d+$/.test(e.url) && e.method === 'GET') return { json: { id: '1', name: '[Pending Acknowledgement] x', parent_id: '99' } };
  if (e.method === 'POST') return { json: { id: '777' } };
  return { json: [] };
});
const Sc = await import('../../../dashboard/src/app/fm/scenes/actions.js');
const Inv = await import('../../../dashboard/src/app/fm/inventory/actions.js');
const Fb = await import('../../../dashboard/src/app/fm/feedback/actions.js');
const L1 = '100000000000000001', L2 = '100000000000000002';
const calls = () => log.splice(0).map(e => ({ ch: e.url.match(/channels\/(\d+)/)?.[1], method: e.method }));

// ── reads ──
as('tok-expired'); await rejects(() => Sc.getSceneLogs(), 'AUTH_REQUIRED', 'logs expired'); as('tok-lst'); eq((await Sc.getSceneLogs()).length, 3, 'LST reads scene logs');
as('tok-et'); eq((await Sc.getSceneLogs()).length, 3, 'ET reads logs');
as('tok-l1'); { const r = await Sc.getSceneLogs(); ok(r.length === 3 && r[0].dateLabel === '05/NOV/2026' && r[0].dateMs > r[1].dateMs, 'sorted by parsed date desc'); }
{ const r = await Sc.getAttentionFactions(); ok(r.every(([, n]) => n < 2) && r.some(([n]) => n === 'Harbor Syndicate') && !r.some(([n]) => n === 'The Vanguard'), 'attention: 30d window + threshold'); }
ok(!(await Sc.getStaffForScene()).some(s => s.discord_id.startsWith('placeholder')), 'staff picker excludes placeholder');
await rejects(() => Sc.getTreasuryStats(), 'AUTH_INSUFFICIENT', 'L1 treasury'); as('tok-et'); eq((await Sc.getTreasuryStats()).Risk?.cash, 5000, 'ET treasury stats'); pass('scene reads');

// ── submitScene ──
as('tok-l1');
const full = { faction: 'The Vanguard', cash: '1500', items: [{ name: 'Lockpick', qty: '3' }, { name: 'Unknown Item', qty: 2 }, { name: '', qty: 5 }], otherRewards: '1x Tulip', notes: 'Big scene', assistants: [{ staff_id: L2, staff_name: 'wrong' }, { staff_id: L1 }, { staff_id: '' }, { staff_id: L2 }] };
const s1 = await Sc.submitScene(full); ok(s1.ok, 'submit full scene');
{ const row = queryOne('SELECT * FROM scene_logs WHERE id=?', [s1.id]); const as_ = query('SELECT staff_id, staff_name FROM scene_assistants WHERE scene_id=?', [s1.id]);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.rewards === '$1500, 3x Lockpick, 2x Unknown Item, 1x Tulip', 'ISO date + rewards text'); ok(as_.length === 1 && as_[0].staff_name === 'Lead Two', 'one assistant, server name, self/blank dropped'); }
{ const tr = queryOne('SELECT * FROM treasury_logs ORDER BY id DESC LIMIT 1'); const inv = query('SELECT * FROM inventory_logs ORDER BY id DESC LIMIT 2'); ok(tr.faction_id === 1 && tr.amount === 1500 && /^\d{4}-/.test(tr.date) && inv.length === 2 && /^\d{4}-/.test(inv[0].date), 'treasury + inventory logs'); }
eq(queryOne("SELECT target_id FROM site_audit_log WHERE target_type='scene_log' ORDER BY id DESC LIMIT 1").target_id, String(s1.id), 'scene audit id');
await failsWith(() => Sc.submitScene({ faction: 'Nope', notes: 'x' }), /not found/i, 'unknown faction'); await failsWith(() => Sc.submitScene({ faction: 'Old Crew', notes: 'x' }), /archived/, 'archived faction');
await failsWith(() => Sc.submitScene({ faction: 'The Vanguard' }), /notes/i, 'no notes'); await failsWith(() => Sc.submitScene({ faction: 'The Vanguard', notes: 'x', cash: '12abc' }), /whole number/, 'cash text'); await failsWith(() => Sc.submitScene({ faction: 'The Vanguard', notes: 'x', cash: '-500' }), /whole number/, 'cash negative');
await failsWith(() => Sc.submitScene({ faction: 'The Vanguard', notes: 'x', items: [{ name: 'Burner', qty: 0 }] }), /Quantity/, 'item qty 0'); await failsWith(() => Sc.submitScene({ faction: 'The Vanguard', notes: 'x', assistants: [{ staff_id: '555' }] }), /roster/, 'bad assistant'); await failsWith(() => Sc.submitScene(undefined), /not found/i, 'undefined');
as('tok-expired'); await rejects(() => Sc.submitScene(full), 'AUTH_REQUIRED', 'submit expired'); as('tok-et'); ok((await Sc.submitScene({ faction: 'Los Santos Kings', notes: 'ET scene' })).ok, 'ET logs a scene'); pass('submitScene');

// ── assistants / edit / deletion ──
as('tok-l1'); await failsWith(() => Sc.addMyselfToScene(s1.id), /creator/, 'creator cannot add self');
as('tok-l3'); log.length = 0; { const r = await Sc.addMyselfToScene(s1.id); const p = pings(log); ok(r.ok && p.length === 1 && p[0].ch === '1457201300583485491' && /added themselves/.test(p[0].content), 'assistant added via scene.assistant_added route'); }
await failsWith(() => Sc.addMyselfToScene(s1.id), /already/, 'add self twice'); await failsWith(() => Sc.addMyselfToScene(9999), /not found/i, 'add self unknown'); await failsWith(() => Sc.addMyselfToScene('abc'), /not found/i, 'add self bad id');
as('tok-l1'); await rejects(() => Sc.removeAssistantFromScene(1), 'AUTH_INSUFFICIENT', 'L1 remove assistant'); as('tok-l2'); await failsWith(() => Sc.removeAssistantFromScene(9999), /not found/i, 'remove unknown'); ok((await Sc.removeAssistantFromScene(1)).ok, 'remove assistant');
as('tok-l1'); await failsWith(() => Sc.editSceneNotes(2, 'x'), /author/, 'edit other’s notes'); await failsWith(() => Sc.editSceneNotes(1, undefined), /notes/i, 'edit undefined'); ok((await Sc.editSceneNotes(1, 'Edited notes')).ok, 'edit own'); await failsWith(() => Sc.editSceneNotes(9999, 'x'), /not found/i, 'edit unknown');
await failsWith(() => Sc.requestSceneDeletion(2, 'x'), /author/, 'request deletion other’s'); await failsWith(() => Sc.requestSceneDeletion(9999, 'x'), /not found/i, 'request unknown'); ok((await Sc.requestSceneDeletion(1, undefined)).ok, 'request own');
{ const r = queryOne("SELECT * FROM deletion_requests WHERE target_table='scene_logs' AND target_row_id=1"); ok(r && r.original_text === 'Edited notes' && r.status === 'PENDING', 'deletion row keeps notes'); }
await failsWith(() => Sc.requestSceneDeletion(1, 'again'), /already pending/, 'duplicate request');
as('tok-l2'); await rejects(() => Sc.deleteScene(1), 'AUTH_INSUFFICIENT', 'L2 delete'); as('tok-l3'); await failsWith(() => Sc.deleteScene(9999), /not found/i, 'delete unknown'); ok((await Sc.deleteScene(1)).ok, 'delete');
{ const dr = queryOne("SELECT status, resolved_by FROM deletion_requests WHERE target_row_id=1 AND target_table='scene_logs'"); ok(dr.status === 'APPROVED' && dr.resolved_by === 'Mgmt Three' && !queryOne('SELECT id FROM scene_logs WHERE id=1') && query('SELECT * FROM scene_assistants WHERE scene_id=1').length === 0, 'request resolved, scene + assistants gone'); }
as('tok-et'); ok((await Sc.deleteScene(2)).ok, 'ET deletes'); pass('assistants / edit / deletion');

// ── inventory ──
as('tok-l2'); await rejects(() => Inv.addInventoryItem({ name: 'Crowbar' }), 'AUTH_INSUFFICIENT', 'L2 inventory add');
as('tok-l3'); const it = await Inv.addInventoryItem({ name: '  Crowbar ', category: 'Tools' }); ok(it.ok && it.id, 'add item');
await failsWith(() => Inv.addInventoryItem({ name: 'crowbar' }), /already/, 'duplicate case-insensitive'); await failsWith(() => Inv.addInventoryItem({ name: ' ' }), /name/, 'blank name');
eq(queryOne("SELECT target_id FROM site_audit_log WHERE target_type='inventory' ORDER BY id DESC LIMIT 1").target_id, String(it.id), 'inventory audit id');
await failsWith(() => Inv.deleteInventoryItem(9999), /not found/i, 'delete unknown item'); ok((await Inv.deleteInventoryItem(it.id)).ok, 'delete item');
as('tok-l1'); await rejects(() => Inv.getDistributionStats(), 'AUTH_INSUFFICIENT', 'L1 distribution stats'); as('tok-lst'); eq((await Inv.getInventory()).length, 2, 'LST reads inventory'); pass('inventory');

// ── feedback ──
as('tok-l1'); await rejects(() => Fb.getFeedbackList(), 'AUTH_INSUFFICIENT', 'L1 feedback list');
as('tok-l2'); { const r = await Fb.getFeedbackList(); ok(r.rows.length === 1 && r.rows[0].received === '2026-10-31 10:00:00' && r.counts.new === 1, 'feedback list'); }
{ const r = await Fb.getFeedbackItem('1'); ok(r && r.qa.length === 2 && r.received, 'feedback item'); } eq(await Fb.getFeedbackItem(999), null, 'item unknown'); eq(await Fb.getFeedbackItem('abc'), null, 'item NaN');
log.length = 0; ok(Array.isArray(await Fb.getFeedbackDiscussion(1)) && calls().some(x => x.ch === '610000000000000001'), 'discussion fetches thread');
as('tok-l1'); await rejects(() => Fb.acknowledgeFeedback(1), 'AUTH_INSUFFICIENT', 'L1 acknowledge');
as('tok-l2'); log.length = 0; { const r = await Fb.snoozeFeedback(1); ok(r.ok && r.dueAt && calls().some(x => x.ch === '610000000000000001' && x.method === 'POST'), 'snooze posts to thread'); }
await failsWith(() => Fb.reopenFeedback(1), /already open/, 'reopen open item');
log.length = 0; ok((await Fb.acknowledgeFeedback(1)).ok && calls().some(x => x.method === 'PATCH'), 'acknowledge retitles thread');
{ const r = queryOne('SELECT status, claimed_by_id, claimed_by_name FROM faction_feedback WHERE id=1'); ok(r.status === 'claimed' && r.claimed_by_id === L2 && r.claimed_by_name === 'Lead Two', 'claimed by actor'); }
await failsWith(() => Fb.acknowledgeFeedback(1), /Already acknowledged/, 'acknowledge twice');
log.length = 0; { const r = await Fb.completeFeedback(1); const c = calls(); ok(r.ok && c.some(x => x.method === 'PATCH') && c.some(x => x.method === 'DELETE' && x.ch === '99'), 'complete: retitle + delete card'); }
{ const r = queryOne('SELECT status, concluded_by_name FROM faction_feedback WHERE id=1'); ok(r.status === 'completed' && r.concluded_by_name === 'Lead Two', 'completed row'); }
await failsWith(() => Fb.completeFeedback(1), /already completed/, 'complete twice'); await failsWith(() => Fb.snoozeFeedback(1), /already completed/, 'snooze ended');
log.length = 0; { const r = await Fb.reopenFeedback(1); ok(r.ok && r.status === 'claimed' && calls().some(x => x.ch === '1532107776724172810' && x.method === 'POST'), 'reopen posts a new card'); }
{ const r = queryOne('SELECT status, due_at, reopen_card_id, concluded_at FROM faction_feedback WHERE id=1'); ok(r.status === 'claimed' && r.due_at && r.reopen_card_id === '777' && r.concluded_at === null, 'reopened row'); }
log.length = 0; ok((await Fb.cancelFeedback(1)).ok && calls().some(x => x.method === 'DELETE' && x.ch === '1532107776724172810'), 'cancel deletes card'); await failsWith(() => Fb.cancelFeedback(999), /not found/i, 'cancel unknown');
{ const r = query("SELECT action, target_id FROM site_audit_log WHERE target_type='feedback'"); ok(r.length === 5 && r.every(a => a.target_id === '1'), 'five feedback audit rows'); } pass('feedback');
