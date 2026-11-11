// The RP-change pipeline, implemented once for the dashboard (fm/operations/
// actions.js wrappers, v2 Leadership › Approvals) and the bot (rpc:* buttons).
//
//   PENDING --approve--> APPROVED --done--> RP_DONE --execute--> EXECUTED
//      |                    |
//      +------deny----------+--> DENIED --resubmit--> PENDING
//
// Rules this module enforces, which the two old copies did not agree on:
//   - every move checks the current status with rpTransitionError(); an
//     out-of-order click (stale tab, old Discord button) is refused, never
//     silently repeated
//   - approve / deny / execute / delete are leadership (level 3); "done" is the
//     requester or leadership; resubmit is the requester only
//   - executing rewrites the world record (npcs / properties / turfs) INSIDE a
//     transaction with the status flip, and refuses when it cannot find exactly
//     one thing to rewrite — it never reports success for zero changes
//   - executing closes the IC contact the request was staged from
//   - the requester is told about every outcome through one route
//     ('rp.requester'): a direct message when possible, the route's channel
//     otherwise. The message carries the request id and the approvals URL.
//   - audit rows carry the record id and say which surface acted (actor.source)
//
// Actor shape (see shared/actor.js): { id, name, level, source? }.
import { query, queryOne, run, transaction } from './db.js';
import { sendPing, sendDiscord, getPingRoute, rpComponents, urls } from './pings.js';
import { rpTransitionError, getExec, findNpcTarget } from './rpState.js';
import { nowIso, todayIso } from './dates.js';
import { str, fail } from './validate.js';

export { getExec, findNpcTarget };

export const NA = 'N/A';

const isNA = (v) => { const s = str(v); return !s || s.toUpperCase() === NA || s.toUpperCase() === 'NONE'; };
const isRemoval = (v) => { const s = str(v).toUpperCase(); return isNA(s) || s === 'REMOVED' || s === 'REMOVE' || s === 'CONFISCATED'; };

function audit(actor, action, exec, details) {
  try {
    run("INSERT INTO site_audit_log (actor_id, actor_name, action, target_type, target_id, target_label, details, source) VALUES (?, ?, ?, 'rp_change', ?, ?, ?, ?)",
      [actor?.id || '', actor?.name || '', action, String(exec.id), exec.faction_name || '', details || '', actor?.source === 'bot' ? 'bot' : 'site']);
  } catch (e) { console.error('[AUDIT]', e.message); }
}

function history(exec, actionType, details, actor) {
  run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [exec.faction_id, exec.faction_name || '', actionType, details, actor?.name || 'System', nowIso()]);
}

/** "NPC: Dealer → Smuggler" — the one-line description every ping and log uses. */
export function rpLabel(exec) {
  return `${exec.execution_type}: ${exec.old_value} → ${exec.new_value}`;
}

const isL3 = (actor) => Number(actor?.level) >= 3;
const isRequester = (actor, exec) => !!actor?.id && exec.requester_id === actor.id;

// ── requester notices ────────────────────────────────────────────────────────

let requesterNotifier = null;

/**
 * The bot registers its own DM sender here (discord.js `client.users.send`):
 *   setRequesterNotifier(async (discordId, content, components, exec) => boolean)
 * When none is registered the REST DM endpoint is used. Either way a failed DM
 * falls back to the 'rp.requester' route's channel.
 */
export function setRequesterNotifier(fn) { requesterNotifier = typeof fn === 'function' ? fn : null; }

async function dmViaRest(userId, content, components) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !userId) return false;
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId }),
    });
    if (!res.ok) return false;
    const dm = await res.json().catch(() => null);
    if (!dm?.id) return false;
    return sendDiscord(dm.id, content, null, components, { allowedMentions: { parse: [] } });
  } catch (e) {
    console.error('[rp] DM failed:', e.message);
    return false;
  }
}

/**
 * Tell the requester something about their request. Returns 'dm', 'channel'
 * or false. Nothing is sent when the route is switched off.
 */
export async function notifyRequester(exec, text, { stage } = {}) {
  if (!exec?.requester_id) return false;
  const route = getPingRoute('rp.requester');
  if (!route || !route.enabled) return false;
  const content = `${text}\n📋 Request #${exec.id} · ${urls.approvals()}`;
  const components = stage ? rpComponents(exec.id, stage) : undefined;
  let viaDm = false;
  try {
    viaDm = requesterNotifier
      ? !!(await requesterNotifier(exec.requester_id, content, components, exec))
      : await dmViaRest(exec.requester_id, content, components);
  } catch (e) { console.error('[rp] requester notifier:', e.message); }
  if (viaDm) return 'dm';
  const ok = await sendPing('rp.requester', `<@${exec.requester_id}> ${content}`, { components });
  return ok ? 'channel' : false;
}

// ── transitions ──────────────────────────────────────────────────────────────

function load(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return getExec(n);
}

export async function approveRPChange(actor, execId) {
  if (!isL3(actor)) return fail('Approving an RP change is FM Leadership only.');
  const exec = load(execId);
  const bad = rpTransitionError(exec, 'approve');
  if (bad) return fail(bad);
  if (exec.faction_archived) return fail(`${exec.faction_name} is archived; restore it before approving changes for it.`);
  transaction(() => {
    run("UPDATE pending_executions SET status = 'APPROVED', approver_id = ?, resolved_at = NULL WHERE id = ?", [actor.id, exec.id]);
    history(exec, 'RP_CHANGE_APPROVED', rpLabel(exec), actor);
    audit(actor, 'APPROVE', exec, `Approved ${rpLabel(exec)}${actor.source === 'bot' ? ' via Discord button' : ''}`);
  });
  await notifyRequester(exec,
    `✅ Your RP change request for **${exec.faction_name}** was approved by **${actor.name}** — **${exec.old_value} → ${exec.new_value}**.\nSchedule and run the scene, then press **Confirm RP done** here or under Leadership → Approvals.`,
    { stage: 'approved' });
  return { ok: true, status: 'APPROVED' };
}

export async function denyRPChange(actor, execId, reason) {
  if (!isL3(actor)) return fail('Denying an RP change is FM Leadership only.');
  const why = str(reason, { max: 500 });
  if (!why) return fail('A reason is required — the requester sees it.');
  const exec = load(execId);
  const bad = rpTransitionError(exec, 'deny');
  if (bad) return fail(bad);
  const now = nowIso();
  transaction(() => {
    run("UPDATE pending_executions SET status = 'DENIED', deny_reason = ?, approver_id = '', resolved_at = ? WHERE id = ?", [why, now, exec.id]);
    audit(actor, 'REJECT', exec, `Denied ${rpLabel(exec)} — ${why}${actor.source === 'bot' ? ' (via Discord button)' : ''}`);
  });
  await notifyRequester(exec,
    `❌ Your RP change request for **${exec.faction_name}** was denied by **${actor.name}** — **${exec.old_value} → ${exec.new_value}**.\n**Reason:** ${why}\nAdd context and resubmit it from your dashboard if it still applies.`);
  return { ok: true, status: 'DENIED' };
}

export async function resubmitRPChange(actor, execId, note) {
  const exec = load(execId);
  const bad = rpTransitionError(exec, 'resubmit');
  if (bad) return fail(bad);
  if (!isRequester(actor, exec)) return fail('Only the person who made this request can resubmit it.');
  const text = str(note, { max: 1000 });
  transaction(() => {
    run("UPDATE pending_executions SET status = 'PENDING', rp_note = ?, deny_reason = '', approver_id = '', resolved_at = NULL WHERE id = ?", [text, exec.id]);
    audit(actor, 'EDIT', exec, `Resubmitted ${rpLabel(exec)}${text ? ` — ${text.slice(0, 120)}` : ''}`);
  });
  await sendPing('rp.resubmitted',
    `🔄 **RP Change Resubmitted** — **${exec.faction_name}**\n**Type:** ${exec.execution_type}\n**Change:** ${exec.old_value} → ${exec.new_value}\n**Requested By:** ${exec.requested_by || actor.name}${text ? `\n**Additional Context:** ${text}` : ''}\n📋 Request #${exec.id} · ${urls.approvals()}`,
    { components: rpComponents(exec.id, 'pending') });
  return { ok: true, status: 'PENDING' };
}

export async function markRPDone(actor, execId, note) {
  const exec = load(execId);
  const bad = rpTransitionError(exec, 'done');
  if (bad) return fail(bad);
  if (!isRequester(actor, exec) && !isL3(actor)) return fail(`Only the requester (${exec.requested_by || 'the team lead'}) or Leadership can confirm this RP.`);
  const text = str(note, { max: 1000 });
  transaction(() => {
    run("UPDATE pending_executions SET status = 'RP_DONE', rp_note = ? WHERE id = ?", [text, exec.id]);
    audit(actor, 'EDIT', exec, `RP marked done${text ? ` — ${text.slice(0, 120)}` : ''}${actor.source === 'bot' ? ' (via Discord button)' : ''}`);
  });
  await sendPing('rp.done',
    `🎬 **RP Scene Complete** — **${exec.faction_name}**\n**Change:** ${rpLabel(exec)}\n**Confirmed By:** ${actor.name}${text ? `\n**Note:** ${text}` : ''}\n\nReady to execute the ${exec.execution_type} change — press **Execute…** here or use Leadership → Approvals.\n📋 Request #${exec.id} · ${urls.approvals()}`,
    { components: rpComponents(exec.id, 'done') });
  return { ok: true, status: 'RP_DONE' };
}

// ── execution ────────────────────────────────────────────────────────────────

const lower = (s) => str(s).toLowerCase();

function findTurf(name) {
  const n = str(name);
  if (!n) return null;
  const row = queryOne("SELECT * FROM turfs WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))", [n]);
  if (row) return { name: row.name, shipment_power: row.shipment_power, id: row.id };
  const npc = queryOne("SELECT turf, shipment_power FROM npcs WHERE LOWER(TRIM(turf)) = LOWER(TRIM(?)) LIMIT 1", [n]);
  return npc ? { name: npc.turf, shipment_power: npc.shipment_power, id: null } : null;
}

function findProperty(factionId, address) {
  const a = str(address);
  if (!a) return null;
  return queryOne("SELECT * FROM properties WHERE faction_id = ? AND LOWER(TRIM(address)) = LOWER(TRIM(?))", [factionId, a]) || null;
}

/**
 * What executing this request would rewrite, before anything is committed.
 * Used by the v2 Execute preview, the bot's modal label, and executeRPChange
 * itself. Returns { ok:false, error } when execution would be refused.
 */
export function executionPreview(execOrId, data = {}) {
  const exec = typeof execOrId === 'object' ? execOrId : load(execOrId);
  if (!exec) return fail('This RP change request no longer exists.');
  const type = String(exec.execution_type || '').toUpperCase();
  if (type === 'NPC') {
    const t = findNpcTarget(exec);
    const picked = data.npcId ? t.candidates.find(c => c.id === Number(data.npcId)) : null;
    if (t.ambiguous && !picked) {
      return fail(`${t.candidates.length} NPCs are "${exec.old_value}" on ${exec.turf} (${t.candidates.map(c => c.name).join(', ')}); pick one by npcId.`, { type, candidates: t.candidates });
    }
    const npc = picked || t.npc;
    if (!npc) return fail(`No NPC of type "${exec.old_value}" on turf "${exec.turf}" — nothing to rewrite. Fix the NPC Ecosystem entry or deny this request.`, { type });
    return { ok: true, type, target: npc, by: picked ? 'id' : t.by, summary: `Rewrites NPC "${npc.name}" (${npc.npc_type}, ${npc.turf}) → type ${exec.new_value}` };
  }
  if (type === 'HQ') {
    if (isNA(exec.new_value)) return fail('The request has no new HQ address.', { type });
    const oldP = isNA(exec.old_value) ? null : findProperty(exec.faction_id, exec.old_value);
    const newP = findProperty(exec.faction_id, exec.new_value);
    const currentHq = queryOne("SELECT id, address FROM properties WHERE faction_id = ? AND is_hq = 1", [exec.faction_id]) || null;
    return { ok: true, type, oldFound: !!oldP, newExists: !!newP, currentHq,
      summary: `${currentHq ? `Un-flags HQ "${currentHq.address}"` : 'No current HQ'}; ${newP ? `makes existing "${newP.address}" the HQ` : `creates "${exec.new_value}" as the HQ`}` };
  }
  if (type === 'TURF') {
    const newName = str(exec.new_value);
    if (isNA(newName)) return fail('The request has no new turf name.', { type });
    if (exec.npc_id) {
      const npc = queryOne("SELECT * FROM npcs WHERE id = ?", [exec.npc_id]);
      if (!npc) return fail('The NPC this turf change was raised for no longer exists.', { type });
      return { ok: true, type, mode: 'npc', target: npc, summary: `Moves NPC "${npc.name}" from ${npc.turf} to ${newName}` };
    }
    const current = findTurf(isNA(exec.old_value) ? exec.turf : exec.old_value);
    if (!current) return fail(`No turf named "${isNA(exec.old_value) ? exec.turf : exec.old_value}" — nothing to change.`, { type });
    const clash = findTurf(newName);
    const sameName = lower(current.name) === lower(newName);
    const npcCount = queryOne("SELECT COUNT(*) c FROM npcs WHERE LOWER(TRIM(turf)) = LOWER(TRIM(?))", [current.name])?.c || 0;
    return { ok: true, type, mode: 'turf', current, merge: !!clash && !sameName, npcCount,
      summary: sameName ? `Updates turf "${current.name}"${data.shipmentPower ? ` (shipment power → ${data.shipmentPower})` : ''}`
        : `${clash ? 'Merges' : 'Renames'} turf "${current.name}" → "${clash ? clash.name : newName}" (${npcCount} NPC${npcCount === 1 ? '' : 's'})` };
  }
  if (type === 'PROPERTY') {
    const oldNA = isNA(exec.old_value), newRm = isRemoval(exec.new_value);
    if (oldNA && newRm) return fail('The request names neither a current nor a new address.', { type });
    if (oldNA) {
      const existing = findProperty(exec.faction_id, exec.new_value);
      if (existing) return fail(`"${existing.address}" is already on ${exec.faction_name}'s property list.`, { type });
      const elsewhere = queryOne("SELECT p.id, p.address, f.name faction FROM properties p LEFT JOIN factions f ON f.id = p.faction_id WHERE LOWER(TRIM(p.address)) = LOWER(TRIM(?))", [str(exec.new_value)]);
      return { ok: true, type, mode: elsewhere ? 'reassign' : 'add', existing: elsewhere || null,
        summary: elsewhere ? `Reassigns "${elsewhere.address}" (${elsewhere.faction || 'unassigned'}) to ${exec.faction_name}` : `Adds "${exec.new_value}" to ${exec.faction_name}` };
    }
    const prop = findProperty(exec.faction_id, exec.old_value);
    if (!prop) return fail(`${exec.faction_name} has no property at "${exec.old_value}" — nothing to change.`, { type });
    if (newRm) return { ok: true, type, mode: 'remove', target: prop, summary: `Removes "${prop.address}" from ${exec.faction_name}${prop.is_hq ? ' (it is the HQ)' : ''}` };
    return { ok: true, type, mode: 'readdress', target: prop, summary: `Re-addresses "${prop.address}" → "${exec.new_value}"` };
  }
  return { ok: true, type: type || 'Other', summary: 'Marks the request executed; no world records are rewritten.' };
}

function applyNpc(exec, data, preview) {
  const name = str(data.npcName, { max: 100 });
  const pos = str(data.npcPos, { max: 100 });
  if (!name || !pos) return fail('The final NPC name and its position are required to execute an NPC change.');
  const npc = preview.target;
  const r = run("UPDATE npcs SET name = ?, position = ?, npc_type = ?, updated_at = ? WHERE id = ?", [name, pos, exec.new_value, nowIso(), npc.id]);
  if (!r.changes) return fail('The NPC could not be updated.');
  return { ok: true, detail: `NPC "${npc.name}" (${npc.npc_type}, ${npc.turf}) → "${name}" (${exec.new_value}) at ${pos}`, npcId: npc.id, npcName: name };
}

function applyHQ(exec) {
  const today = todayIso();
  const now = nowIso();
  // One HQ per faction: whatever was flagged loses the flag (and the HQ type).
  run("UPDATE properties SET is_hq = 0, property_type = CASE WHEN property_type = 'HQ' THEN 'Property' ELSE property_type END, updated_at = ? WHERE faction_id = ? AND is_hq = 1", [now, exec.faction_id]);
  if (!isNA(exec.old_value)) {
    run("UPDATE properties SET is_hq = 0, property_type = CASE WHEN property_type = 'HQ' THEN 'Property' ELSE property_type END, updated_at = ? WHERE faction_id = ? AND LOWER(TRIM(address)) = LOWER(TRIM(?))", [now, exec.faction_id, str(exec.old_value)]);
  }
  const existing = findProperty(exec.faction_id, exec.new_value);
  let id;
  if (existing) {
    run("UPDATE properties SET is_hq = 1, property_type = 'HQ', confiscated = 0, date_confiscated = NULL, confiscated_by = NULL, date_given = COALESCE(date_given, ?), updated_at = ? WHERE id = ?", [today, now, existing.id]);
    id = existing.id;
  } else {
    id = Number(run("INSERT INTO properties (address, faction_id, property_type, is_hq, date_given, created_at, updated_at) VALUES (?, ?, 'HQ', 1, ?, ?, ?)", [str(exec.new_value), exec.faction_id, today, now, now]).lastInsertRowid);
  }
  return { ok: true, detail: `HQ ${isNA(exec.old_value) ? 'set to' : `moved from "${exec.old_value}" to`} "${exec.new_value}"`, propertyId: id };
}

function ensureTurfRow(name, power) {
  const n = str(name);
  if (!n || ['neutral', 'unaffiliated'].includes(n.toLowerCase())) return null;
  const ex = queryOne("SELECT id FROM turfs WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))", [n]);
  if (ex) { if (power != null) run("UPDATE turfs SET shipment_power = ? WHERE id = ?", [power, ex.id]); return ex.id; }
  return Number(run("INSERT INTO turfs (name, shipment_power, created_at) VALUES (?, ?, ?)", [n, power || '', nowIso()]).lastInsertRowid);
}

function applyTurf(exec, data, preview) {
  const now = nowIso();
  const newName = str(exec.new_value);
  const power = data.shipmentPower != null ? str(data.shipmentPower, { max: 50 }) : null;
  if (preview.mode === 'npc') {
    const npc = preview.target;
    const target = findTurf(newName);
    const finalName = target ? target.name : newName;
    const finalPower = power ?? (target ? target.shipment_power : npc.shipment_power);
    const claimable = lower(finalName) === 'neutral' ? 0 : 1;
    ensureTurfRow(finalName, finalPower);
    run("UPDATE npcs SET turf = ?, shipment_power = ?, claimable = ?, updated_at = ? WHERE id = ?", [finalName, finalPower || '', claimable, now, npc.id]);
    return { ok: true, detail: `NPC "${npc.name}" moved from ${npc.turf} to ${finalName}`, npcId: npc.id };
  }
  const { current } = preview;
  const clash = findTurf(newName);
  const sameName = lower(current.name) === lower(newName);
  const finalName = clash ? clash.name : newName;
  const finalPower = power ?? (clash ? clash.shipment_power : current.shipment_power);
  if (sameName) {
    ensureTurfRow(current.name, finalPower);
    run("UPDATE npcs SET shipment_power = ?, updated_at = ? WHERE LOWER(TRIM(turf)) = LOWER(TRIM(?))", [finalPower || '', now, current.name]);
    return { ok: true, detail: `Turf "${current.name}" updated${power != null ? ` (shipment power → ${finalPower || 'none'})` : ''}` };
  }
  if (clash) {
    if (current.id) run("DELETE FROM turfs WHERE id = ?", [current.id]);
    ensureTurfRow(finalName, finalPower);
  } else if (current.id) {
    run("UPDATE turfs SET name = ?, shipment_power = ? WHERE id = ?", [finalName, finalPower || '', current.id]);
  } else {
    ensureTurfRow(finalName, finalPower);
  }
  const moved = run("UPDATE npcs SET turf = ?, shipment_power = ?, claimable = ?, updated_at = ? WHERE LOWER(TRIM(turf)) = LOWER(TRIM(?))",
    [finalName, finalPower || '', lower(finalName) === 'neutral' ? 0 : 1, now, current.name]).changes;
  return { ok: true, detail: `Turf "${current.name}" ${clash ? 'merged into' : 'renamed to'} "${finalName}" (${moved} NPC${moved === 1 ? '' : 's'} moved)` };
}

function applyProperty(exec, preview) {
  const today = todayIso();
  const now = nowIso();
  if (preview.mode === 'add') {
    const id = Number(run("INSERT INTO properties (address, faction_id, property_type, is_hq, date_given, created_at, updated_at) VALUES (?, ?, 'Property', 0, ?, ?, ?)",
      [str(exec.new_value), exec.faction_id, today, now, now]).lastInsertRowid);
    return { ok: true, detail: `Property "${exec.new_value}" added`, propertyId: id };
  }
  if (preview.mode === 'reassign') {
    run("UPDATE properties SET faction_id = ?, is_hq = 0, property_type = CASE WHEN property_type = 'HQ' THEN 'Property' ELSE property_type END, confiscated = 0, date_confiscated = NULL, confiscated_by = NULL, date_given = ?, updated_at = ? WHERE id = ?",
      [exec.faction_id, today, now, preview.existing.id]);
    return { ok: true, detail: `Property "${preview.existing.address}" reassigned from ${preview.existing.faction || 'unassigned'}`, propertyId: preview.existing.id };
  }
  if (preview.mode === 'remove') {
    run("UPDATE properties SET faction_id = NULL, is_hq = 0, property_type = CASE WHEN property_type = 'HQ' THEN 'Property' ELSE property_type END, updated_at = ? WHERE id = ?", [now, preview.target.id]);
    return { ok: true, detail: `Property "${preview.target.address}" removed from the faction`, propertyId: preview.target.id };
  }
  run("UPDATE properties SET address = ?, updated_at = ? WHERE id = ?", [str(exec.new_value), now, preview.target.id]);
  return { ok: true, detail: `Property "${preview.target.address}" re-addressed to "${exec.new_value}"`, propertyId: preview.target.id };
}

/**
 * Execute an RP_DONE request. `data`: { npcName, npcPos, npcId?, shipmentPower? }.
 * Refuses (with a clear error) whenever it cannot identify exactly one record
 * to change; the status only flips once the write has happened.
 */
export async function executeRPChange(actor, execId, data = {}) {
  if (!isL3(actor)) return fail('Executing an RP change is FM Leadership only.');
  data = data && typeof data === 'object' ? data : {};
  const exec = load(execId);
  const bad = rpTransitionError(exec, 'execute');
  if (bad) return fail(bad);
  if (exec.faction_archived) return fail(`${exec.faction_name} is archived; restore it before executing changes for it.`);
  const preview = executionPreview(exec, data);
  if (!preview.ok) return preview;

  let applied;
  try {
    applied = transaction(() => {
      let r;
      switch (preview.type) {
        case 'NPC': r = applyNpc(exec, data, preview); break;
        case 'HQ': r = applyHQ(exec); break;
        case 'TURF': r = applyTurf(exec, data, preview); break;
        case 'PROPERTY': r = applyProperty(exec, preview); break;
        default: r = { ok: true, detail: 'Logged only — no world records rewritten' };
      }
      if (!r.ok) throw Object.assign(new Error(r.error), { soft: true });
      const now = nowIso();
      run("UPDATE pending_executions SET status = 'EXECUTED', resolved_at = ? WHERE id = ?", [now, exec.id]);
      // Close the IC contact this request was staged from (linked either way).
      const closed = run("UPDATE faction_ic_contacts SET status = 'completed', rp_change_id = COALESCE(rp_change_id, ?) WHERE (id = ? OR rp_change_id = ?) AND status != 'completed'",
        [exec.id, exec.contact_id || -1, exec.id]).changes;
      history(exec, 'RP_CHANGE_EXECUTED', `${rpLabel(exec)} — ${r.detail}`, actor);
      audit(actor, 'EXECUTE', exec, `${r.detail}${closed ? ` · IC contact closed` : ''}${actor.source === 'bot' ? ' (via Discord button)' : ''}`);
      return { ...r, contactsClosed: closed };
    });
  } catch (e) {
    if (e.soft) return fail(e.message);
    console.error('[rp] execute failed:', e.message);
    return fail(`Could not execute: ${e.message}`);
  }

  await sendPing('rp.executed',
    `✅ **RP Change Executed** — **${exec.faction_name}**\n**Type:** ${exec.execution_type}\n**Change:** ${exec.old_value} → ${exec.new_value}\n**Result:** ${applied.detail}\n**Executed By:** ${actor.name}\n📋 Request #${exec.id} · ${urls.approvals()}`);
  await notifyRequester(exec,
    `✅ Your RP change for **${exec.faction_name}** has been executed by **${actor.name}** — **${exec.old_value} → ${exec.new_value}**.\n**Result:** ${applied.detail}`);
  return { ok: true, status: 'EXECUTED', detail: applied.detail, npcId: applied.npcId, propertyId: applied.propertyId, contactsClosed: applied.contactsClosed };
}

/** Leadership withdraws a request outright. The requester is told. */
export async function deleteRPChange(actor, execId, reason = '') {
  if (!isL3(actor)) return fail('Deleting an RP change is FM Leadership only.');
  const exec = load(execId);
  if (!exec) return fail('This RP change request no longer exists.');
  const why = str(reason, { max: 300 });
  transaction(() => {
    // The IC contact goes back to discussion so it is not stuck "awaiting roleplay" for nothing.
    run("UPDATE faction_ic_contacts SET rp_change_id = NULL, status = CASE WHEN status = 'pending_roleplay' THEN 'pending_discussion' ELSE status END WHERE id = ? OR rp_change_id = ?",
      [exec.contact_id || -1, exec.id]);
    run("DELETE FROM pending_executions WHERE id = ?", [exec.id]);
    audit(actor, 'DELETE', exec, `Deleted ${rpLabel(exec)} (was ${exec.status})${why ? ` — ${why}` : ''}`);
  });
  await notifyRequester(exec,
    `🗑️ Your RP change request for **${exec.faction_name}** — **${exec.old_value} → ${exec.new_value}** — was withdrawn by **${actor.name}**${why ? `.\n**Reason:** ${why}` : '.'}\nRaise it again from your dashboard if it still applies.`);
  return { ok: true };
}

/** Queue for Leadership › Approvals (PENDING / APPROVED / RP_DONE), active factions first. */
export function pendingExecutions() {
  return query(`SELECT pe.*, f.name AS faction, f.name AS faction_name, f.archived AS faction_archived, pe.execution_type AS type,
                 (SELECT GROUP_CONCAT(n.name || ' (' || n.npc_type || ')', ', ') FROM npcs n WHERE n.turf = pe.turf AND n.npc_type = pe.old_value) AS npcDetails
                 FROM pending_executions pe JOIN factions f ON f.id = pe.faction_id
                 WHERE pe.status IN ('PENDING', 'APPROVED', 'RP_DONE')
                 ORDER BY f.archived, pe.created_at DESC`);
}

/** A requester's own open requests (everything not yet executed). */
export function myRequests(discordId) {
  if (!discordId) return [];
  return query("SELECT pe.*, f.name AS faction_name FROM pending_executions pe JOIN factions f ON f.id = pe.faction_id WHERE pe.requester_id = ? AND pe.status != 'EXECUTED' ORDER BY pe.created_at DESC", [discordId]);
}
