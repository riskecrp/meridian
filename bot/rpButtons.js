// RP-change pipeline buttons (rpc:* custom ids) — Approve/Deny on the request
// ping, Confirm RP done on the approval notice, Execute on the ready notice.
// Each handler mirrors the dashboard action of the same name (operations/
// actions.js): same status writes, faction_history rows, audit entries and
// follow-on pings (which carry the next stage's buttons), so the pipeline is
// fully drivable from either surface.
import { queryOne, run } from './lib/db.js';
import { sendPing, rpComponents } from './lib/pings.js';
import { logAudit } from './lib/audit.js';

const staffRow = (id) => queryOne("SELECT clearance, rank FROM staff WHERE discord_id = ? AND discord_id NOT LIKE 'placeholder%'", [id]);
const getExec = (id) => queryOne("SELECT pe.*, f.name AS faction_name FROM pending_executions pe JOIN factions f ON pe.faction_id = f.id WHERE pe.id = ?", [id]);

// Keep only the Open link once a stage's action has been taken here.
function openOnly(message) {
  const link = (message.components?.[0]?.components || []).find(c => c.style === 5);
  return link ? [{ type: 1, components: [{ type: 2, style: 5, label: link.label || 'Open', url: link.url }] }] : [];
}
async function settle(interaction, line) {
  await interaction.update({ content: interaction.message.content + `\n${line}`, components: openOnly(interaction.message) }).catch(() => {});
}
async function settleFromModal(interaction, line) {
  if (interaction.isFromMessage()) await settle(interaction, line);
  else await interaction.reply({ content: line, ephemeral: true }).catch(() => {});
}
const STATUS_LABEL = { PENDING: 'pending approval', APPROVED: 'approved — awaiting the RP', RP_DONE: 'ready to execute', EXECUTED: 'already executed', DENIED: 'denied' };
async function stale(interaction, exec) {
  await interaction.reply({ content: exec ? `This request is ${STATUS_LABEL[exec.status] || exec.status} — the buttons here are out of date. Use Leadership → Approvals for the current state.` : '❌ This RP change request no longer exists.', ephemeral: true }).catch(() => {});
}

export async function handleRPButton(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('rpc:')) return false;
  const [, action, idStr] = customId.split(':');
  const execId = parseInt(idStr);
  const author = interaction.user.globalName || interaction.user.username;
  const staff = staffRow(interaction.user.id);
  if (!staff) { await interaction.reply({ content: 'FM staff only.', ephemeral: true }); return true; }
  const isL3 = (staff.clearance || 0) >= 3;
  const exec = getExec(execId);

  if (action === 'approve') {
    if (!isL3) { await interaction.reply({ content: 'Approving is FM Leadership only.', ephemeral: true }); return true; }
    if (!exec || exec.status !== 'PENDING') { await stale(interaction, exec); return true; }
    run("UPDATE pending_executions SET status='APPROVED', approver_id=? WHERE id=?", [interaction.user.id, execId]);
    run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?,?,'RP_CHANGE_APPROVED',?,?)",
      [exec.faction_id, exec.faction_name, `${exec.execution_type}: ${exec.old_value} → ${exec.new_value}`, author]);
    logAudit(interaction.user.id, author, 'APPROVE', 'rp_change', execId, exec.faction_name, `Approved ${exec.execution_type} via Discord button`);
    if (exec.requester_id) {
      try { await sendPing('rp.approved.requester',
        `<@${exec.requester_id}> ✅ Your RP change request for **${exec.faction_name}** has been approved — **${exec.old_value} → ${exec.new_value}**. Schedule and run the scene, then press **Confirm RP done** here or under Leadership → Approvals.`,
        { components: rpComponents(execId, 'approved') }); } catch {}
    }
    await settle(interaction, `✅ **Approved by ${author}**`);
    return true;
  }

  if (action === 'deny') {
    if (!isL3) { await interaction.reply({ content: 'Denying is FM Leadership only.', ephemeral: true }); return true; }
    if (!exec || exec.status !== 'PENDING') { await stale(interaction, exec); return true; }
    await interaction.showModal({
      title: 'Deny RP change', customId: `rpcdenym:${execId}`,
      components: [{ type: 1, components: [{ type: 4, custom_id: 'reason', label: 'Reason (required — the lead sees this)', style: 2, required: true, max_length: 500 }] }],
    });
    return true;
  }

  if (action === 'done') {
    if (!exec || exec.status !== 'APPROVED') { await stale(interaction, exec); return true; }
    if (exec.requester_id !== interaction.user.id && !isL3) {
      await interaction.reply({ content: `Only the requester (${exec.requested_by}) or Leadership can confirm this RP.`, ephemeral: true }); return true;
    }
    await interaction.showModal({
      title: 'Confirm RP done', customId: `rpcdonem:${execId}`,
      components: [{ type: 1, components: [{ type: 4, custom_id: 'note', label: 'How the scene went (optional)', style: 2, required: false, max_length: 500 }] }],
    });
    return true;
  }

  if (action === 'exec') {
    if (!isL3) { await interaction.reply({ content: 'Executing is FM Leadership only.', ephemeral: true }); return true; }
    if (!exec || exec.status !== 'RP_DONE') { await stale(interaction, exec); return true; }
    if (exec.execution_type === 'NPC') {
      // Hardening: name the live NPC this will rewrite, right in the field label.
      const npc = queryOne("SELECT name, turf FROM npcs WHERE turf=? AND npc_type=?", [exec.turf, exec.old_value]);
      const who = npc ? `Rewrites: ${npc.name} (${npc.turf})` : '⚠ NO MATCHING NPC — nothing will change';
      await interaction.showModal({
        title: 'Execute NPC swap', customId: `rpcexecm:${execId}`,
        components: [
          { type: 1, components: [{ type: 4, custom_id: 'npcName', label: who.slice(0, 45), placeholder: 'Final NPC name', style: 1, required: true, max_length: 100 }] },
          { type: 1, components: [{ type: 4, custom_id: 'npcPos', label: 'TP position (x y z)', style: 1, required: true, max_length: 100 }] },
        ],
      });
    } else {
      const detail = exec.execution_type === 'HQ'
        ? `HQ: un-flags "${exec.old_value}", makes "${exec.new_value}" the HQ`
        : 'Type "Other": marks executed, no world records rewritten';
      await interaction.showModal({
        title: 'Execute RP change', customId: `rpcexecm:${execId}`,
        components: [{ type: 1, components: [{ type: 4, custom_id: 'note', label: detail.slice(0, 45), placeholder: 'Submit to execute', style: 1, required: false, max_length: 100 }] }],
      });
    }
    return true;
  }
  return true;
}

export async function handleRPModal(interaction) {
  const { customId } = interaction;
  if (!customId?.startsWith('rpcdenym:') && !customId?.startsWith('rpcdonem:') && !customId?.startsWith('rpcexecm:')) return false;
  const execId = parseInt(customId.split(':')[1]);
  const author = interaction.user.globalName || interaction.user.username;
  const staff = staffRow(interaction.user.id);
  if (!staff) { await interaction.reply({ content: 'FM staff only.', ephemeral: true }); return true; }
  const isL3 = (staff.clearance || 0) >= 3;
  const exec = getExec(execId);

  if (customId.startsWith('rpcdenym:')) {
    if (!isL3 || !exec || exec.status !== 'PENDING') { await stale(interaction, exec); return true; }
    const reason = interaction.fields.getTextInputValue('reason').trim();
    run("UPDATE pending_executions SET status='DENIED', deny_reason=? WHERE id=?", [reason, execId]);
    logAudit(interaction.user.id, author, 'REJECT', 'rp_change', execId, exec.faction_name, reason);
    if (exec.requester_id) {
      try { await sendPing('rp.denied.requester',
        `<@${exec.requester_id}> ❌ Your RP change request for **${exec.faction_name}** was denied.\n**Reason:** ${reason}\nPlease respond with additional context and resubmit via your dashboard.`); } catch {}
    }
    await settleFromModal(interaction, `❌ **Denied by ${author}** — ${reason.slice(0, 200)}`);
    return true;
  }

  if (customId.startsWith('rpcdonem:')) {
    if (!exec || exec.status !== 'APPROVED' || (exec.requester_id !== interaction.user.id && !isL3)) { await stale(interaction, exec); return true; }
    const note = (interaction.fields.getTextInputValue('note') || '').trim();
    run("UPDATE pending_executions SET status='RP_DONE', rp_note=? WHERE id=?", [note, execId]);
    logAudit(interaction.user.id, author, 'EDIT', 'rp_change', execId, exec.faction_name, 'RP marked done via Discord button');
    try { await sendPing('rp.done',
      `🎬 **RP Scene Complete** — **${exec.faction_name}**\n**Change:** ${exec.old_value} → ${exec.new_value}\n**Confirmed By:** ${author}${note ? `\n**Note:** ${note}` : ''}\n\nReady to execute the ${exec.execution_type} change — press **Execute…** here or use Leadership → Approvals.`,
      { components: rpComponents(execId, 'done') }); } catch {}
    await settleFromModal(interaction, `🎬 **RP confirmed done by ${author}**`);
    return true;
  }

  if (customId.startsWith('rpcexecm:')) {
    if (!isL3 || !exec || exec.status !== 'RP_DONE') { await stale(interaction, exec); return true; }
    let newNpcName = '';
    if (exec.execution_type === 'NPC') {
      newNpcName = interaction.fields.getTextInputValue('npcName').trim();
      const npcPos = interaction.fields.getTextInputValue('npcPos').trim();
      const npc = queryOne("SELECT id FROM npcs WHERE turf=? AND npc_type=?", [exec.turf, exec.old_value]);
      if (npc) run("UPDATE npcs SET name=?, position=?, npc_type=?, updated_at=datetime('now') WHERE id=?", [newNpcName, npcPos, exec.new_value, npc.id]);
    } else if (exec.execution_type === 'HQ') {
      run("UPDATE properties SET is_hq=0, updated_at=datetime('now') WHERE faction_id=? AND address=?", [exec.faction_id, exec.old_value]);
      const existing = queryOne("SELECT id FROM properties WHERE faction_id=? AND address=?", [exec.faction_id, exec.new_value]);
      if (existing) run("UPDATE properties SET is_hq=1, updated_at=datetime('now') WHERE id=?", [existing.id]);
      else run("INSERT INTO properties (address, faction_id, property_type, is_hq) VALUES (?, ?, 'Property', 1)", [exec.new_value, exec.faction_id]);
    }
    run("UPDATE pending_executions SET status='EXECUTED' WHERE id=?", [execId]);
    run("INSERT INTO faction_history (faction_id, faction_name, action_type, details, authorized_by) VALUES (?,?,'RP_CHANGE_EXECUTED',?,?)",
      [exec.faction_id, exec.faction_name, `${exec.execution_type}: ${exec.old_value} → ${exec.new_value}`, author]);
    logAudit(interaction.user.id, author, 'APPROVE', 'rp_change', execId, exec.faction_name, `${exec.execution_type} executed via Discord button`);
    try { await sendPing('rp.executed',
      `✅ **RP Change Executed** — **${exec.faction_name}**\n**Type:** ${exec.execution_type}\n**Change:** ${exec.old_value} → ${exec.new_value}\n**Executed By:** ${author}${exec.execution_type === 'NPC' && newNpcName ? `\n**New NPC:** ${newNpcName}` : ''}`); } catch {}
    if (exec.requester_id) {
      try { await sendPing('rp.executed.requester',
        `<@${exec.requester_id}> ✅ Your RP change for **${exec.faction_name}** has been executed — **${exec.old_value} → ${exec.new_value}**.`); } catch {}
    }
    await settleFromModal(interaction, `✅ **Executed by ${author}**`);
    return true;
  }
  return true;
}
