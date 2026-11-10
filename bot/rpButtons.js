// RP-change pipeline buttons (rpc:* custom ids) — Approve/Deny on the request
// ping, Confirm RP done on the approval notice, Execute on the ready notice.
//
// Every transition goes through shared/rpChanges.js with the actor resolved by
// requireStaff, so the bot and the dashboard enforce the same order
// (PENDING → APPROVED → RP_DONE → EXECUTED, policy 8), the same permissions,
// the same world-record rewrites, audit rows and pings. Requester notices are
// DMs with the rp.requester channel as fallback (lib/notify.js registers the
// client as the DM transport before the first transition).
import { approveRPChange, denyRPChange, markRPDone, executeRPChange, executionPreview } from '../shared/rpChanges.js';
import { getExec, rpTransitionError, RP_STATUS_LABEL } from '../shared/rpState.js';
import { requireStaff, replyEphemeral } from './lib/auth.js';
import { ensureRequesterNotifier } from './lib/notify.js';

// Keep only the Open link once a stage's action has been taken here.
function openOnly(message) {
  const link = (message?.components?.[0]?.components || []).find(c => c.style === 5);
  return link ? [{ type: 1, components: [{ type: 2, style: 5, label: link.label || 'Open', url: link.url }] }] : [];
}
async function settle(interaction, line) {
  try { await interaction.update({ content: (interaction.message?.content || '') + `\n${line}`, components: openOnly(interaction.message) }); }
  catch { await replyEphemeral(interaction, line); }
}
async function settleFromModal(interaction, line) {
  if (interaction.isFromMessage?.()) await settle(interaction, line);
  else await replyEphemeral(interaction, line);
}
async function stale(interaction, exec) {
  await replyEphemeral(interaction, exec
    ? `This request is ${RP_STATUS_LABEL[exec.status] || exec.status} — the buttons here are out of date. Use Leadership → Approvals for the current state.`
    : '❌ This RP change request no longer exists.');
}

const parseId = (s) => { const n = parseInt(s, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const label45 = (s) => String(s || '').slice(0, 45);

/** The Execute… modal for a request, built from the shared execution preview. */
function executeModal(exec) {
  const preview = executionPreview(exec);
  const type = String(exec.execution_type || '').toUpperCase();
  const rows = [];
  if (type === 'NPC') {
    const who = preview.ok ? `Rewrites: ${preview.target.name} (${preview.target.turf})` : `⚠ ${preview.error}`;
    rows.push({ type: 1, components: [{ type: 4, custom_id: 'npcName', label: label45(who), placeholder: 'Final NPC name', style: 1, required: true, max_length: 100 }] });
    rows.push({ type: 1, components: [{ type: 4, custom_id: 'npcPos', label: 'TP position (x y z)', style: 1, required: true, max_length: 100 }] });
    if (preview.candidates?.length > 1) {
      rows.push({ type: 1, components: [{ type: 4, custom_id: 'npcId', label: label45(`NPC id: ${preview.candidates.map(c => `${c.id}=${c.name}`).join(', ')}`), placeholder: 'Which NPC id to rewrite', style: 1, required: true, max_length: 12 }] });
    }
    return { title: 'Execute NPC swap', customId: `rpcexecm:${exec.id}`, components: rows };
  }
  if (type === 'TURF') {
    rows.push({ type: 1, components: [{ type: 4, custom_id: 'shipmentPower', label: label45(preview.ok ? preview.summary : `⚠ ${preview.error}`), placeholder: 'Shipment power (optional)', style: 1, required: false, max_length: 50 }] });
    return { title: 'Execute turf change', customId: `rpcexecm:${exec.id}`, components: rows };
  }
  const detail = preview.ok ? preview.summary : `⚠ ${preview.error}`;
  rows.push({ type: 1, components: [{ type: 4, custom_id: 'note', label: label45(detail), placeholder: 'Submit to execute', style: 1, required: false, max_length: 100 }] });
  return { title: 'Execute RP change', customId: `rpcexecm:${exec.id}`, components: rows };
}

export async function handleRPButton(interaction) {
  const { customId } = interaction;
  if (!customId?.startsWith('rpc:')) return false;
  const [, action, idStr] = customId.split(':');
  const execId = parseId(idStr);
  ensureRequesterNotifier(interaction.client);

  const needLevel = (action === 'approve' || action === 'deny' || action === 'exec') ? 3 : 1;
  const actor = await requireStaff(interaction, needLevel);
  if (!actor) return true;
  const exec = execId ? getExec(execId) : null;
  if (!exec) { await stale(interaction, null); return true; }

  if (action === 'approve') {
    const res = await approveRPChange(actor, execId);
    if (!res.ok) { await replyEphemeral(interaction, `❌ ${res.error}`); return true; }
    await settle(interaction, `✅ **Approved by ${actor.name}**`);
    return true;
  }

  if (action === 'deny') {
    const bad = rpTransitionError(exec, 'deny');
    if (bad) { await stale(interaction, exec); return true; }
    await interaction.showModal({
      title: 'Deny RP change', customId: `rpcdenym:${execId}`,
      components: [{ type: 1, components: [{ type: 4, custom_id: 'reason', label: 'Reason (required — the lead sees this)', style: 2, required: true, max_length: 500 }] }],
    });
    return true;
  }

  if (action === 'done') {
    const bad = rpTransitionError(exec, 'done');
    if (bad) { await stale(interaction, exec); return true; }
    if (exec.requester_id !== actor.id && actor.level < 3) {
      await replyEphemeral(interaction, `Only the requester (${exec.requested_by || 'the team lead'}) or Leadership can confirm this RP.`); return true;
    }
    await interaction.showModal({
      title: 'Confirm RP done', customId: `rpcdonem:${execId}`,
      components: [{ type: 1, components: [{ type: 4, custom_id: 'note', label: 'How the scene went (optional)', style: 2, required: false, max_length: 500 }] }],
    });
    return true;
  }

  if (action === 'exec') {
    const bad = rpTransitionError(exec, 'execute');
    if (bad) { await stale(interaction, exec); return true; }
    await interaction.showModal(executeModal(exec));
    return true;
  }

  await replyEphemeral(interaction, `Unknown RP action "${action}".`);
  return true;
}

export async function handleRPModal(interaction) {
  const { customId } = interaction;
  if (!customId?.startsWith('rpcdenym:') && !customId?.startsWith('rpcdonem:') && !customId?.startsWith('rpcexecm:')) return false;
  const execId = parseId(customId.split(':')[1]);
  ensureRequesterNotifier(interaction.client);
  const field = (k) => { try { return (interaction.fields.getTextInputValue(k) || '').trim(); } catch { return ''; } };

  const needLevel = customId.startsWith('rpcdonem:') ? 1 : 3;
  const actor = await requireStaff(interaction, needLevel);
  if (!actor) return true;
  const exec = execId ? getExec(execId) : null;
  if (!exec) { await stale(interaction, null); return true; }

  if (customId.startsWith('rpcdenym:')) {
    const reason = field('reason');
    const res = await denyRPChange(actor, execId, reason);
    if (!res.ok) { await replyEphemeral(interaction, `❌ ${res.error}`); return true; }
    await settleFromModal(interaction, `❌ **Denied by ${actor.name}** — ${reason.slice(0, 200)}`);
    return true;
  }

  if (customId.startsWith('rpcdonem:')) {
    const res = await markRPDone(actor, execId, field('note'));
    if (!res.ok) { await replyEphemeral(interaction, `❌ ${res.error}`); return true; }
    await settleFromModal(interaction, `🎬 **RP confirmed done by ${actor.name}**`);
    return true;
  }

  if (customId.startsWith('rpcexecm:')) {
    const data = {};
    const type = String(exec.execution_type || '').toUpperCase();
    if (type === 'NPC') {
      data.npcName = field('npcName');
      data.npcPos = field('npcPos');
      const npcId = field('npcId');
      if (npcId) data.npcId = npcId;
    } else if (type === 'TURF') {
      const power = field('shipmentPower');
      if (power) data.shipmentPower = power;
    }
    const res = await executeRPChange(actor, execId, data);
    if (!res.ok) { await replyEphemeral(interaction, `❌ ${res.error}`); return true; }
    await settleFromModal(interaction, `✅ **Executed by ${actor.name}** — ${res.detail || 'done'}`);
    return true;
  }
  return true;
}
