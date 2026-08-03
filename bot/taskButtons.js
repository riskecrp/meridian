// Claim / Done buttons on task-assigned pings (tsk:* custom ids).
// Mirrors the dashboard's claimMyTask / completeMyTask semantics — same log
// rows, same audit entries, same creator notifications with the same
// confidentiality routing — so a task is equally "done" from either surface.
import { queryOne, run } from './lib/db.js';
import { sendPing, getRole } from './lib/pings.js';
import { logAudit } from './lib/audit.js';

const staffRow = (id) => queryOne("SELECT clearance, rank FROM staff WHERE discord_id = ? AND discord_id NOT LIKE 'placeholder%'", [id]);

// Mirror of dashboard _creatorRoutesAlt: the creator ping takes the
// confidentiality branch when the creator is Management and the task targets
// a leadership role.
function creatorRoutesAlt(createdById, targetType, targetId) {
  if (!createdById) return false;
  const s = queryOne("SELECT rank FROM staff WHERE discord_id = ?", [createdById]);
  if (!(s?.rank || '').toLowerCase().includes('management')) return false;
  return targetType === 'Role' && (targetId === getRole('fm_leadership') || targetId === getRole('game_affairs'));
}

// Strip the Claim button (after a claim) or all action buttons (after
// completion), keeping the Open link.
function remainingComponents(message, { keepDone }) {
  const row = (message.components?.[0]?.components || []).filter(c =>
    c.style === 5 || (keepDone && c.customId?.startsWith('tsk:done:')));
  if (!row.length) return [];
  return [{ type: 1, components: row.map(c => c.style === 5
    ? { type: 2, style: 5, label: c.label || 'Open', url: c.url }
    : { type: 2, style: 3, label: c.label || 'Done', custom_id: c.customId }) }];
}

export async function handleTaskButton(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('tsk:')) return false;
  const [, action, uid] = customId.split(':');
  const author = interaction.user.globalName || interaction.user.username;

  if (!staffRow(interaction.user.id)) {
    await interaction.reply({ content: 'These buttons are for FM staff only.', ephemeral: true });
    return true;
  }
  const task = queryOne("SELECT * FROM tasks WHERE task_uid = ?", [uid]);
  if (!task) {
    await interaction.update({ content: interaction.message.content + '\n\n☑️ *This task has been completed.*', components: remainingComponents(interaction.message, { keepDone: false }) }).catch(() => {});
    return true;
  }

  if (action === 'claim') {
    if (task.claimed_by && task.claimed_by !== 'None') {
      await interaction.reply({ content: `Already claimed by <@${task.claimed_by}>.`, ephemeral: true });
      return true;
    }
    run("UPDATE tasks SET claimed_by = ? WHERE task_uid = ?", [interaction.user.id, uid]);
    run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('CLAIMED', ?, ?, '', 'Claimed', ?)",
      [`${author} (${interaction.user.id})`, uid, new Date().toISOString()]);
    logAudit(interaction.user.id, author, 'EDIT', 'task', null, uid, 'Claimed via Discord button');
    if (task.created_by_id && task.created_by_id !== interaction.user.id) {
      const alt = creatorRoutesAlt(task.created_by_id, task.target_type, task.target_id);
      try { await sendPing('task.claimed.creator', `🤚 <@${task.created_by_id}> — **${author}** claimed a task you assigned.\n📋 https://ecrpfm.com/fm/tasks/${uid}`, { alt }); } catch {}
    }
    await interaction.update({
      content: interaction.message.content + `\n✋ **Claimed by ${author}**`,
      components: remainingComponents(interaction.message, { keepDone: true }),
    }).catch(() => {});
    return true;
  }

  if (action === 'done') {
    await interaction.showModal({
      title: 'Complete task',
      customId: `tskdonem:${uid}`,
      components: [{ type: 1, components: [{ type: 4, custom_id: 'note', label: 'Completion note (optional)', style: 2, required: false, max_length: 500 }] }],
    });
    return true;
  }
  return true;
}

export async function handleTaskModal(interaction) {
  if (!interaction.customId?.startsWith('tskdonem:')) return false;
  const uid = interaction.customId.split(':')[1];
  const author = interaction.user.globalName || interaction.user.username;
  if (!staffRow(interaction.user.id)) {
    await interaction.reply({ content: 'FM staff only.', ephemeral: true });
    return true;
  }
  const task = queryOne("SELECT * FROM tasks WHERE task_uid = ?", [uid]);
  if (!task) {
    await interaction.reply({ content: '☑️ This task was already completed.', ephemeral: true });
    return true;
  }
  const note = (interaction.fields.getTextInputValue('note') || '').trim();
  run("DELETE FROM tasks WHERE task_uid = ?", [uid]);
  run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('COMPLETED', ?, ?, ?, 'Done', ?)",
    [author, uid, task.description || '', new Date().toISOString()]);
  logAudit(interaction.user.id, author, 'DELETE', 'task', null, uid, `Completed via Discord button${note ? ` · ${note.slice(0, 80)}` : ''}`);
  if (task.created_by_id && task.created_by_id !== interaction.user.id) {
    const alt = creatorRoutesAlt(task.created_by_id, task.target_type, task.target_id);
    try { await sendPing('task.completed.creator', `✅ <@${task.created_by_id}> — **${author}** completed a task you created.${note ? `\n**Note:** ${note}` : ''}`, { alt }); } catch {}
  }
  if (interaction.isFromMessage()) {
    await interaction.update({
      content: interaction.message.content + `\n✅ **Completed by ${author}**${note ? ` — ${note.slice(0, 200)}` : ''}`,
      components: remainingComponents(interaction.message, { keepDone: false }),
    }).catch(() => {});
  } else {
    await interaction.reply({ content: `✅ Task completed.`, ephemeral: true }).catch(() => {});
  }
  return true;
}
