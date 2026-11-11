import { requireActor, requireEventTeam, requireLeadStoryteller, requireOwner, getActor } from '../../../dashboard/src/lib/requireActor.js';
import { logAudit } from '../../../dashboard/src/lib/audit.js';
import { queryOne } from '../../../shared/db.js';
import { as, ok, eq, rejects, pass } from '../lib.mjs';

as('tok-l1'); eq((await requireActor(1)).level, 1, 'L1 passes L1'); await rejects(() => requireActor(2), 'AUTH_INSUFFICIENT', 'L1 refused L2'); pass('clearance gates');
as('tok-et'); await rejects(() => requireActor(3), 'AUTH_INSUFFICIENT', 'ET refused plain L3');
eq((await requireActor(3, { allowEventTeam: true })).level, 3, 'ET boosted where allowed'); ok((await requireEventTeam()).isEventTeam, 'requireEventTeam'); pass('event team');
as('tok-lst'); await rejects(() => requireActor(1), 'AUTH_INSUFFICIENT', 'LST refused plain L1');
const lst = await requireActor(1, { allowLeadStoryteller: true }); eq(lst.level, 0, 'LST level not inflated'); ok(lst.isLeadStoryteller, 'flag'); pass('lead storyteller');
as('tok-expired'); await rejects(() => requireActor(1), 'AUTH_REQUIRED', 'expired'); eq(await getActor(), null, 'getActor null'); pass('expired session');
as('tok-owner', '100000000000000001'); const a = await requireActor(1); eq(a.id, '100000000000000001', 'view-as target'); ok(a._impersonating, 'flag'); eq(a._realName, 'Risk (owner)', 'real name');
logAudit(a.id, a.name, 'TEST', 'x', 1, 'lbl', 'd');
eq(queryOne("SELECT actor_name FROM site_audit_log WHERE action = 'TEST'").actor_name, 'Guide One (as Risk (owner))', 'impersonation audited');
ok(await requireOwner(), 'owner behind view-as keeps owner powers'); pass('owner view-as');
as('tok-l1'); await rejects(() => requireOwner(), 'AUTH_INSUFFICIENT', 'L1 not owner'); pass('requireOwner');
