import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { actorFromDiscord } from '../../shared/actor.js';
import { createTask, completeTask, visibleTasks, decorate, getTask } from '../../shared/tasks.js';

// /todo — the same task lifecycle as the dashboard (shared/tasks.js): same
// visibility, same claim/complete rules, same audit rows and creator pings.
const EPH = (content) => ({ content, ephemeral: true });

/** Resolve a typed id: exact uid, or an unambiguous prefix among the tasks this actor can see. */
function resolveUid(actor, input) {
  const id = String(input || '').trim();
  if (!id) return null;
  if (getTask(id)) return id;
  const hits = visibleTasks(actor).filter(t => t.task_uid.startsWith(id));
  return hits.length === 1 ? hits[0].task_uid : null;
}

export default {
  data: new SlashCommandBuilder().setName('todo').setDescription('Manage tasks')
    .addSubcommand(s => s.setName('list').setDescription('List the open tasks you can see'))
    .addSubcommand(s => s.setName('create').setDescription('Create a task')
      .addStringOption(o => o.setName('description').setDescription('Task description').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Assign to a user').setRequired(false))
      .addRoleOption(o => o.setName('role').setDescription('Assign to a role').setRequired(false)))
    .addSubcommand(s => s.setName('complete').setDescription('Complete a task')
      .addStringOption(o => o.setName('id').setDescription('Task ID (or its first characters)').setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const actor = actorFromDiscord(interaction.user.id, interaction.user.globalName || interaction.user.username);
    if (!actor) return interaction.reply(EPH('This command is for FM staff only.'));

    if (sub === 'list') {
      const tasks = visibleTasks(actor).map(decorate);
      if (tasks.length === 0) return interaction.reply(EPH('No open tasks for you.'));
      const mine = tasks.filter(t => (t.target_type === 'User' && t.target_id === actor.id) || t.claimed_by === actor.id);
      const rest = tasks.filter(t => !mine.includes(t));
      const line = (t) => `\`${t.task_uid}\` ${t.description.substring(0, 80)}\n${t.claimed_by === 'None' ? '⏳ Unclaimed' : `✅ Claimed · ${t.claimerName}`} · for ${t.targetLabel} · [open](${t.url})`;
      const parts = [];
      if (mine.length) parts.push(`**Assigned to you (${mine.length})**\n` + mine.map(line).join('\n\n'));
      if (rest.length) parts.push(`**Your team / roles (${rest.length})**\n` + rest.map(line).join('\n\n'));
      const embed = new EmbedBuilder().setTitle('Your Tasks').setColor(0xF59E0B).setDescription(parts.join('\n\n').substring(0, 4096));
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (actor.level < 1) return interaction.reply(EPH('Creating or completing tasks needs FM clearance (L1+); your access is read-only.'));

    if (sub === 'create') {
      const desc = interaction.options.getString('description');
      const assignUser = interaction.options.getUser('user');
      const assignRole = interaction.options.getRole('role');
      let targetId, targetType;
      if (assignRole) { targetId = assignRole.id; targetType = 'Role'; }
      else if (assignUser) { targetId = assignUser.id; targetType = 'User'; }
      else { targetId = actor.id; targetType = 'User'; }
      const mention = targetType === 'Role' ? `<@&${targetId}>` : `<@${targetId}>`;
      const r = await createTask(actor, { desc, targetType, targetId }, { via: '/todo' });
      if (!r.ok) return interaction.reply(EPH(`❌ ${r.error}`));
      const selfAssign = targetType === 'User' && targetId === actor.id;
      await interaction.reply(EPH(selfAssign
        ? `📋 Task \`${r.uid}\` created for you.`
        : `📋 Task \`${r.uid}\` assigned to ${mention} — posted to the ping channel.`));
      return;
    }

    if (sub === 'complete') {
      const uid = resolveUid(actor, interaction.options.getString('id'));
      if (!uid) return interaction.reply(EPH('Task not found. Use `/todo list` to see the ids you can complete.'));
      const r = await completeTask(actor, uid, '', { via: '/todo' });
      if (!r.ok) return interaction.reply(EPH(`❌ ${r.error}`));
      await interaction.reply(EPH(`✅ Task \`${uid}\` completed.`));
    }
  }
};
