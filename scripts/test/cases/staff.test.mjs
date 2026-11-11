// Staff administration (dashboard/src/app/fm/operations/staff/actions.js):
// roster add/update rules, teams, promote/retire/restore/takeover, dashboard
// access grants, bulk team moves, conflicts of interest.
import { as, ok, eq, rejects, failsWith, pass, captureDiscord } from '../lib.mjs';
import { queryOne, run } from '../../../shared/db.js';
captureDiscord();
const A = await import('../../../dashboard/src/app/fm/operations/staff/actions.js');
const OWNER = '738214924760907907';
const auditCount = () => queryOne('SELECT COUNT(*) c FROM site_audit_log').c;
const staff = (id) => queryOne('SELECT clearance, rank, team_name, active FROM staff WHERE id=?', [id]);

// ── addStaff ──
as('tok-l1'); eq((await A.getTeamList()).length, 3, 'teams from teams table'); as('tok-l2'); await rejects(() => A.getStaffList(), 'AUTH_INSUFFICIENT', 'L2 staff list');
as('tok-l3'); await failsWith(() => A.addStaff({}), null, 'addStaff empty'); await failsWith(() => A.addStaff({ discordId: 'abc', name: 'X' }), null, 'addStaff bad snowflake');
ok((await A.addStaff({ discordId: '100000000000000020', name: 'New Guide', teamId: 'team_cup', rank: 'Guide' })).ok && queryOne("SELECT clearance FROM staff WHERE discord_id='100000000000000020'").clearance === 1, 'guide → L1 by rank');
ok((await A.addStaff({ discordId: '100000000000000021', name: 'New Mgmt', teamId: '', rank: 'Management' })).ok && queryOne("SELECT clearance FROM staff WHERE discord_id='100000000000000021'").clearance === 3, 'management → L3 by rank');
ok((await A.addStaff({ discordId: '100000000000000022', name: 'Odd', rank: 'Guide', clearance: '2' })).ok && queryOne("SELECT clearance FROM staff WHERE discord_id='100000000000000022'").clearance === 2, 'explicit clearance wins');
{ const sess = queryOne('SELECT COUNT(*) c FROM sessions WHERE discord_id=?', [OWNER]).c; const r = await A.addStaff({ discordId: OWNER, name: 'Risk', teamId: 'team_cup', rank: 'Guide' }); const own = queryOne('SELECT id, clearance FROM staff WHERE discord_id=?', [OWNER]);
  ok(r.ok && r.updated && own.id === 1 && own.clearance === 3 && queryOne('SELECT COUNT(*) c FROM sessions WHERE discord_id=?', [OWNER]).c === sess, 're-adding existing staff updates in place, keeps clearance + sessions'); }
await failsWith(() => A.addStaff({ discordId: '100000000000000023', name: 'X', teamId: 'team_nope' }), null, 'unknown team'); pass('addStaff');

// ── updateStaff ──
ok((await A.updateStaff(4, 'team_id', 'team_pumpkin')).ok && staff(4).team_name === 'Team Pumpkin', 'team_name follows team_id'); await failsWith(() => A.updateStaff(4, 'team_id', 'nope'), null, 'unknown team');
ok((await A.updateStaff(4, 'rank', 'Senior Leadership')).ok && staff(4).clearance === 1, 'rank change leaves clearance'); ok((await A.updateStaff(4, 'clearance', 3)).ok && staff(4).clearance === 3, 'explicit clearance');
await failsWith(() => A.updateStaff(4, 'clearance', 9), null, 'clearance range'); await failsWith(() => A.updateStaff(2, 'clearance', 1), null, 'cannot lower own clearance');
await failsWith(() => A.updateStaff(4, 'rank', null), null, 'rank null'); await failsWith(() => A.updateStaff(4, 'clearance=3;--', 'x'), null, 'field whitelist'); await failsWith(() => A.updateStaff(9999, 'display_name', 'x'), null, 'unknown staff');
run("UPDATE staff SET clearance=1, rank='Guide', team_id='team_cup', team_name='Team Cup' WHERE id=4"); pass('updateStaff');

// ── teams ──
await failsWith(() => A.createTeam('team_cup', 'Team Cup 2', ''), null, 'createTeam existing'); eq(queryOne("SELECT channel_id FROM teams WHERE team_id='team_cup'").channel_id, '700000000000000001', 'channel kept');
await failsWith(() => A.createTeam('', 'X', ''), null, 'createTeam empty id'); ok((await A.createTeam('700000000000000009', 'Team New', '')).ok && queryOne("SELECT 1 FROM teams WHERE team_id='700000000000000009'"), 'createTeam');
as('tok-l1'); eq((await A.getTeamList()).length, 4, 'empty team listed'); as('tok-l3'); await failsWith(() => A.renameTeam('nope', 'X'), null, 'rename unknown'); await failsWith(() => A.updateTeamChannel('team_cup', 'abc'), null, 'channel snowflake');
ok((await A.deleteTeam('700000000000000009', 'Team New')).ok, 'deleteTeam'); pass('teams');

// ── promote / retire / restore / takeover ──
await failsWith(() => A.promoteToLead(2, 'Mgmt Three', 'team_pumpkin', ''), null, 'promote never lowers L3'); eq(staff(2).clearance, 3, 'L3 kept');
{ const a = auditCount(); await failsWith(() => A.promoteToLead(9999, 'Ghost', 'team_cup', ''), null, 'promote unknown'); eq(auditCount(), a, 'no audit'); }
ok((await A.promoteToLead(4, 'Guide One', 'team_cup', 'Team One')).ok && staff(4).clearance === 2 && queryOne("SELECT team_name FROM teams WHERE team_id='team_cup'").team_name === 'Team One', 'promote + rename team'); run("UPDATE staff SET clearance=1, rank='Guide' WHERE id=4");
await failsWith(() => A.retireStaff(2, 'Mgmt Three', '100000000000000003', []), null, 'retire self'); await failsWith(() => A.retireStaff(9999, 'Ghost', '', []), null, 'retire unknown');
{ const r = await A.retireStaff(1, 'Risk', OWNER, []); ok(r.ok === false && r.needsConfirm, 'retiring an L3 needs confirmation'); }
ok((await A.retireStaff(1, 'Risk', OWNER, [], { confirm: true })).ok && staff(1).active === 0 && queryOne('SELECT COUNT(*) c FROM sessions WHERE discord_id=?', [OWNER]).c === 0, 'soft retire: row kept, sessions ended');
ok((await A.retireStaff(3, 'Lead Two', '100000000000000002', [{ factionId: 1, newLeadId: '100000000000000001' }])).ok && queryOne('SELECT lead_discord_id FROM factions WHERE id=1').lead_discord_id === '100000000000000001' && staff(3).active === 0, 'retire with faction reassignment');
ok(!(await A.getStaffList()).some(s => s.id === 3), 'retired hidden from list'); eq((await A.getRetiredStaff()).length, 2, 'two retired');
ok((await A.restoreStaff(3)).ok && staff(3).clearance === 2, 'restore keeps clearance'); await failsWith(() => A.restoreStaff(3), null, 'restore active'); ok((await A.restoreStaff(1)).ok, 'restore owner');
eq(queryOne('SELECT COUNT(*) c FROM sessions WHERE discord_id=?', [OWNER]).c, 0, 'restore does not revive sessions');
eq(queryOne("SELECT COUNT(*) c FROM sessions WHERE token='tok-l2'").c, 0, 'retiring Lead Two ended her session too');
run("INSERT INTO sessions (staff_id, token, discord_id, discord_name, clearance, expires_at) VALUES (1, 'tok-owner', ?, 'Risk', 3, datetime('now','+3 days')), (3, 'tok-l2', '100000000000000002', 'Lead Two', 2, datetime('now','+3 days'))", [OWNER]);
run("UPDATE factions SET lead_discord_id='100000000000000002' WHERE id=1"); run("UPDATE staff SET team_id='team_cup', team_name='Team One' WHERE id IN (1,3)");
{ const r = await A.takeoverTeam(4, 'Guide One', 'team_cup', 3, '100000000000000002', 'Lead Two', 'guide', 'Team Cup'); ok(r.ok && r.factionsTransferred === 1 && staff(4).clearance === 2 && staff(3).clearance === 1, 'takeover: new lead L2, old lead back to guide, factions moved'); }
run("UPDATE staff SET team_id='team_cup', team_name='Team Cup' WHERE id=1");
ok((await A.takeoverTeam(3, 'Lead Two', 'team_cup', 1, OWNER, 'Risk', 'guide', 'Team Cup')).ok && staff(1).clearance === 3 && staff(3).clearance === 2, 'takeover from an L3 keeps their clearance');
await failsWith(() => A.takeoverTeam(4, 'Guide One', 'team_pumpkin', 2, '100000000000000003', 'Mgmt Three', 'retire', ''), null, 'takeover cannot retire yourself'); pass('promote / retire / takeover');

// ── dashboard access / bulk moves / COI ──
as('tok-owner'); await failsWith(() => A.grantDashboardAccess('abc', 'x'), null, 'grant bad id'); await failsWith(() => A.grantDashboardAccess('100000000000000011', '', 5), null, 'grant level 5');
ok((await A.grantDashboardAccess('100000000000000011', '', 2)).ok, 'grant existing'); { const g = queryOne("SELECT display_name, level FROM dashboard_access WHERE discord_id='100000000000000011'"); ok(g.display_name === 'Granted Person' && g.level === 2, 'name kept, level updated'); }
await failsWith(() => A.revokeDashboardAccess('100000000000000099'), null, 'revoke none');
await failsWith(() => A.commitAllChanges(), null, 'commit nothing');
run("UPDATE staff SET team_id='team_cup', team_name='Team Cup' WHERE id=3"); run("UPDATE factions SET lead_discord_id='100000000000000002' WHERE id=1"); run("INSERT INTO teams (team_id, team_name, channel_id) VALUES ('700000000000000008','Team Empty','')");
{ const r = await A.commitAllChanges([], [{ factionId: 1, factionName: 'The Vanguard', newTeamId: '700000000000000008', newTeamName: 'Team Empty' }]); ok(r.ok && r.factionMoves === 0 && r.errors.length === 1 && queryOne('SELECT lead_discord_id FROM factions WHERE id=1').lead_discord_id === '100000000000000002', 'faction → team with no lead refused'); }
{ const r = await A.commitAllChanges([{ staffId: 4, staffName: 'Guide One', discordId: '100000000000000001', oldTeamId: 'team_cup', oldTeamName: 'Team Cup', newTeamId: 'team_pumpkin', newTeamName: 'Team Pumpkin' }], [{ factionId: 1, factionName: 'The Vanguard', newTeamId: 'team_pumpkin', newTeamName: 'Team Pumpkin' }]);
  ok(r.ok && r.factionMoves === 1 && queryOne('SELECT lead_discord_id FROM factions WHERE id=1').lead_discord_id === '100000000000000001' && staff(4).team_name === 'Team Pumpkin', 'moved L2 becomes lead over the team’s Management member'); }
run("UPDATE staff SET team_id='team_cup', team_name='Team Cup', clearance=1, rank='Guide' WHERE id=4"); run("UPDATE factions SET lead_discord_id='100000000000000002' WHERE id=1");
as('tok-l3'); { const r = await A.commitAllChanges([], [{ factionId: 1, factionName: 'The Vanguard', newTeamId: 'team_pumpkin', newTeamName: 'Team Pumpkin' }]); ok(r.ok && r.factionMoves === 1 && queryOne('SELECT lead_discord_id FROM factions WHERE id=1').lead_discord_id === '100000000000000003', 'L3 member is the fallback lead'); }
as('tok-l2'); await rejects(() => A.commitAllChanges([], []), 'AUTH_INSUFFICIENT', 'L2 commit');
as('tok-owner'); ok((await A.addStaffCOI('100000000000000001', 'Los Santos Kings', 'meridian')).ok && queryOne("SELECT faction_id FROM staff_coi WHERE faction_name='Los Santos Kings'").faction_id === 2, 'COI resolves faction_id'); pass('access / bulk moves / COI');
