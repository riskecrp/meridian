// Documents (dashboard/src/app/fm/documents/actions.js): level_required is a
// read gate, writes are L3-only, publish pings follow the document.published route.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord, pings } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
const log = captureDiscord();
const D = await import('../../../dashboard/src/app/fm/documents/actions.js');
run("INSERT INTO documents (id, title, category, content, level_required, created_by) VALUES (3, 'Leads Doc', 'Policy', '<p>l2</p>', 2, 'seed')");
const ids = (d) => d.map(x => x.id).sort().join();
const lastAudit = () => queryOne('SELECT action, target_type, target_id, target_label, details FROM site_audit_log ORDER BY id DESC LIMIT 1');

// ── read gate ──
as('tok-l1'); eq(ids(await D.getDocuments()), '1', 'L1 level-1 only'); as('tok-l2'); eq(ids(await D.getDocuments()), '1,3', 'L2 levels 1-2'); as('tok-l3'); eq(ids(await D.getDocuments()), '1,2,3', 'L3 all');
as('tok-et'); eq(ids(await D.getDocuments()), '1', 'ET level-1'); as('tok-lst'); eq(ids(await D.getDocuments()), '1', 'LST level-1'); as('tok-expired'); await rejects(() => D.getDocuments(), 'AUTH_REQUIRED', 'expired');
as('tok-owner', '100000000000000001'); eq(ids(await D.getDocuments()), '1', 'owner view-as L1 is gated');
as('tok-l1'); eq(await D.getDocument(2), null, 'L1 cannot read an L3 doc'); as('tok-l3'); eq((await D.getDocument(2))?.title, 'Leadership Only Doc', 'L3 reads it'); eq(await D.getDocument('abc'), null, 'bad id'); pass('read gate');

// ── create ──
as('tok-l3'); log.length = 0; { const r = await D.createDocument({ title: 'New SOP', category: 'SOP', content: '<p>hi</p>', level_required: 1 }); const p = pings(log);
  ok(r.ok && r.pinged && p.length === 1 && p[0].ch === '1457230769951998114' && /New SOP/.test(p[0].content) && /All FM staff/.test(p[0].content), 'level-1 doc pings the route channel');
  ok(lastAudit().action === 'CREATE' && lastAudit().target_id === String(r.id) && lastAudit().target_label === 'New SOP', 'create audited'); }
log.length = 0; { const r = await D.createDocument({ title: 'Secret Plan', category: 'Leadership', content: '<p>x</p>', level_required: 3 }); ok(r.ok && r.pinged === false && pings(log).length === 0, 'L3 doc without alt channel: no ping'); }
run("UPDATE ping_routes SET alt_channel_id='777000000000000001' WHERE key='document.published'"); log.length = 0;
{ const r = await D.createDocument({ title: 'Lead Memo', category: 'Leadership', content: '<p>x</p>', level_required: 2 }); const p = pings(log); ok(r.ok && r.pinged && p[0].ch === '777000000000000001' && /L2\+/.test(p[0].content), 'L2 doc pings the alt channel'); }
run("UPDATE ping_routes SET alt_channel_id='' WHERE key='document.published'");
{ const r = await D.createDocument({ title: 'Min' }); const row = queryOne('SELECT category, content, level_required FROM documents WHERE id=?', [r.id]); ok(r.ok && row.category === 'General' && row.content === '' && row.level_required === 1, 'minimal payload defaults'); }
await failsWith(() => D.createDocument({ title: '', content: 'x' }), /Title/, 'empty title'); await failsWith(() => D.createDocument({ content: 'x' }), /Title/, 'no title'); await failsWith(() => D.createDocument(null), /Title/, 'null data');
{ const r = await D.createDocument({ title: 'L9', level_required: 9 }); eq(queryOne('SELECT level_required FROM documents WHERE id=?', [r.id]).level_required, 1, 'level 9 clamped to 1'); }
{ const r = await D.createDocument({ title: 'Labc', level_required: 'abc' }); eq(queryOne('SELECT level_required FROM documents WHERE id=?', [r.id]).level_required, 1, 'level "abc" → 1'); }
as('tok-et'); await rejects(() => D.createDocument({ title: 'ET doc' }), 'AUTH_INSUFFICIENT', 'ET create'); as('tok-l2'); await rejects(() => D.createDocument({ title: 'L2 doc' }), 'AUTH_INSUFFICIENT', 'L2 create'); as('tok-lst'); await rejects(() => D.createDocument({ title: 'LST doc' }), 'AUTH_INSUFFICIENT', 'LST create'); as('tok-expired'); await rejects(() => D.createDocument({ title: 'x' }), 'AUTH_REQUIRED', 'expired create');
run("UPDATE ping_routes SET enabled=0 WHERE key='document.published'"); as('tok-l3'); eq((await D.createDocument({ title: 'Muted', content: 'x' })).pinged, false, 'muted route → pinged:false'); run("UPDATE ping_routes SET enabled=1 WHERE key='document.published'"); pass('create');

// ── update / delete ──
ok((await D.updateDocument(1, { title: 'Scene Logging SOP v2', category: 'SOP', content: '<p>v2</p>', level_required: 1 })).ok && /content edited/.test(lastAudit().details), 'full update audited with diff');
ok((await D.updateDocument(1, { title: 'Partial' })).ok, 'partial update'); { const row = queryOne('SELECT title, category, content, level_required FROM documents WHERE id=1'); ok(row.title === 'Partial' && row.category === 'SOP' && row.content === '<p>v2</p>' && row.level_required === 1, 'other fields kept'); }
ok((await D.updateDocument(1, { level_required: 7 })).ok && queryOne('SELECT level_required FROM documents WHERE id=1').level_required === 1, 'level 7 clamped');
{ const a = queryOne('SELECT COUNT(*) c FROM site_audit_log').c; await failsWith(() => D.updateDocument(999, { title: 'x' }), /not found/i, 'update unknown'); eq(queryOne('SELECT COUNT(*) c FROM site_audit_log').c, a, 'no audit'); }
ok((await D.updateDocument(1, null)).ok, 'null data → no change'); await failsWith(() => D.updateDocument(1, { title: '  ' }), /Title/, 'empty title'); await failsWith(() => D.updateDocument('abc', { title: 'x' }), /Invalid/, 'bad id');
as('tok-et'); await rejects(() => D.updateDocument(2, { title: 'hack' }), 'AUTH_INSUFFICIENT', 'ET update'); as('tok-l2'); await rejects(() => D.updateDocument(1, { title: 'x' }), 'AUTH_INSUFFICIENT', 'L2 update'); as('tok-l1'); await rejects(() => D.updateDocument(2, { level_required: 1 }), 'AUTH_INSUFFICIENT', 'L1 cannot lower a doc level');
for (const t of ['tok-l1', 'tok-l2', 'tok-et', 'tok-lst']) { as(t); await rejects(() => D.deleteDocument(1), 'AUTH_INSUFFICIENT', `delete ${t}`); }
as('tok-l3'); await failsWith(() => D.deleteDocument(999), /not found/i, 'delete unknown'); await failsWith(() => D.deleteDocument(undefined), /Invalid/, 'delete undefined');
ok((await D.deleteDocument(3)).ok && !queryOne('SELECT id FROM documents WHERE id=3') && lastAudit().action === 'DELETE' && lastAudit().target_label === 'Leads Doc', 'delete audited'); pass('update / delete');
