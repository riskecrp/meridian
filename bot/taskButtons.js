// Claim / Done buttons on task-assigned pings (tsk:* custom ids).
// Both delegate to shared/tasks.js, so a button press is exactly a dashboard
// claim / complete: same visibility rule, same "already claimed" guard, same
// soft completion, same audit rows and creator notifications.
import { actorFromDiscord } from '../shared/actor.js';
import { getTask, claimTask, completeTask } from '../shared/tasks.js';

const EPH = (content) => ({ content, ephemeral: true });

// Strip the Claim button (after a claim) or all action buttons (after
// completion), keeping the Open link.
function remainingComponents(message, { keepDone }) {
  const row = (message?.components?.[0]?.components || []).filter(c =>
    c.style === 5 || (keepDone && c.customId?.startsWith('tsk:done:')));
  if (!row.length) return [];
  return [{ type: 1, components: row.map(c => c.style === 5
    ? { type: 2, style: 5, label: c.label || 'Open', url: c.url }
    : { type: 2, style: 3, label: c.label || 'Done', custom_id: c.customId }) }];
}

/** Resolve the pressing user to an actor, or explain why they cannot act. Returns null after replying. */
async function actorFor(interaction) {
  const actor = actorFromDiscord(interaction.user.id, interaction.user.globalName || interaction.user.username);
  if (!actor) { await interaction.reply(EPH('These buttons are for FM staff only.')); return null; }
  if (actor.level < 1) { await interaction.reply(EPH('Task actions need FM clearance (L1+); your access is read-only.')); return null; }
  return actor;
}

async function closeMessage(interaction, note) {
  await interaction.update({ content: interaction.message.content + `\n\n${note}`, components: remainingComponents(interaction.message, { keepDone: false }) }).catch(() => {});
}

export async function handleTaskButton(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('tsk:')) return false;
  const [, action, uid] = customId.split(':');

  const actor = await actorFor(interaction);
  if (!actor) return true;
  const task = getTask(uid);
  if (!task) { await closeMessage(interaction, '☑️ *This task no longer exists.*'); return true; }
  if (task.status !== 'open') { await closeMessage(interaction, `☑️ *This task has been ${task.status}${task.completed_by_name ? ` by ${task.completed_by_name}` : ''}.*`); return true; }

  if (action === 'claim') {
    const r = await claimTask(actor, uid, { via: 'Discord button' });
    if (!r.ok) { await interaction.reply(EPH(`❌ ${r.error}`)); return true; }
    await interaction.update({
      content: interaction.message.content + `\n✋ **Claimed by ${actor.name}**`,
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
  await interaction.reply(EPH('Unknown task action.')).catch(() => {});
  return true;
}

export async function handleTaskModal(interaction) {
  if (!interaction.customId?.startsWith('tskdonem:')) return false;
  const uid = interaction.customId.split(':')[1];
  const actor = await actorFor(interaction);
  if (!actor) return true;
  const note = (interaction.fields.getTextInputValue('note') || '').trim();
  const r = await completeTask(actor, uid, note, { via: 'Discord button' });
  if (!r.ok) { await interaction.reply(EPH(`❌ ${r.error}`)); return true; }
  if (interaction.isFromMessage()) {
    await interaction.update({
      content: interaction.message.content + `\n✅ **Completed by ${actor.name}**${note ? ` — ${note.slice(0, 200)}` : ''}`,
      components: remainingComponents(interaction.message, { keepDone: false }),
    }).catch(() => {});
  } else {
    await interaction.reply(EPH('✅ Task completed.')).catch(() => {});
  }
  return true;
}
