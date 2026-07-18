import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query, queryOne, run } from '../lib/db.js';
export default {
  data: new SlashCommandBuilder().setName('todo').setDescription('Manage tasks')
    .addSubcommand(s => s.setName('list').setDescription('List your tasks'))
    .addSubcommand(s => s.setName('create').setDescription('Create a task')
      .addStringOption(o => o.setName('description').setDescription('Task description').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('Assign to a user').setRequired(false))
      .addRoleOption(o => o.setName('role').setDescription('Assign to a role').setRequired(false)))
    .addSubcommand(s => s.setName('complete').setDescription('Complete a task')
      .addStringOption(o => o.setName('id').setDescription('Task ID').setRequired(true))),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const author = interaction.user.globalName || interaction.user.username;
    // FM-staff only — this command reads/creates/deletes tasks in the shared DB.
    const staffRow = queryOne("SELECT clearance FROM staff WHERE discord_id = ? AND discord_id NOT LIKE 'placeholder%'", [interaction.user.id]);
    if (!staffRow) return interaction.reply({ content: 'This command is for FM staff only.', ephemeral: true });
    if (sub === 'list') {
      const tasks = query("SELECT * FROM tasks WHERE target_id = ? OR claimed_by = ? ORDER BY created_at DESC", [interaction.user.id, interaction.user.id]);
      if (tasks.length === 0) return interaction.reply({ content: 'No tasks assigned to you.', ephemeral: true });
      const embed = new EmbedBuilder().setTitle('Your Tasks').setColor(0xF59E0B)
        .setDescription(tasks.map(t => `\`${t.task_uid}\` ${t.description.substring(0, 80)}\n${t.claimed_by === 'None' ? '⏳ Unclaimed' : '✅ Claimed'}`).join('\n\n').substring(0, 4096));
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else if (sub === 'create') {
      const desc = interaction.options.getString('description');
      const assignUser = interaction.options.getUser('user');
      const assignRole = interaction.options.getRole('role');
      const uid = Date.now().toString();
      let targetId, targetType, mention;
      if (assignRole) {
        targetId = assignRole.id; targetType = 'Role'; mention = `<@&${assignRole.id}>`;
      } else if (assignUser) {
        targetId = assignUser.id; targetType = 'User'; mention = `<@${assignUser.id}>`;
      } else {
        targetId = interaction.user.id; targetType = 'User'; mention = `<@${interaction.user.id}>`;
      }
      const now = new Date().toISOString();
      run("INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, created_at) VALUES (?, ?, ?, ?, 'None', ?, ?, ?)",
        [uid, desc, targetId, targetType, interaction.user.id, author, now]);
      run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('CREATED', ?, ?, ?, ?, ?)",
        [author, uid, desc, `${targetType}: ${targetId}`, now]);
      // Route the notification through the configured ping channel (mirrors the
      // dashboard) so the assignee is notified where everyone watches and role
      // mentions actually resolve. Personal self-assignments just confirm quietly.
      const selfAssign = !assignRole && !assignUser;
      let posted = false;
      if (!selfAssign) {
        try {
          const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
          const gameAffairsId = '1457189093594239147';
          const routeLeadership = targetType === 'Role' && (targetId === leadershipRoleId || targetId === gameAffairsId);
          const chKey = routeLeadership ? 'leadership_channel' : 'global_ping_channel';
          const pingChannelId = queryOne("SELECT channel_id FROM discord_config WHERE key = ?", [chKey])?.channel_id;
          if (pingChannelId) {
            const ch = await interaction.client.channels.fetch(pingChannelId).catch(() => null);
            if (ch) {
              await ch.send({ content: `📋 **NEW TASK ASSIGNED** | ${mention}\n**Assigned By:** ${author}`, allowedMentions: { parse: ['roles', 'users'] } });
              posted = true;
            }
          }
        } catch (e) { console.error('Task ping failed:', e.message); }
      }
      await interaction.reply({ content: posted ? `📋 Task assigned to ${mention} — posted to the ping channel.` : `📋 Task \`${uid}\` created for ${mention}.`, ephemeral: true });
    } else if (sub === 'complete') {
      const uid = interaction.options.getString('id');
      const task = queryOne("SELECT * FROM tasks WHERE task_uid = ?", [uid]);
      if (!task) return interaction.reply({ content: 'Task not found.', ephemeral: true });
      run("DELETE FROM tasks WHERE task_uid = ?", [uid]);
      run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('COMPLETED', ?, ?, ?, 'Done', ?)",
        [author, uid, task.description, new Date().toISOString()]);
      await interaction.reply({ content: `✅ Task \`${uid}\` completed.`, ephemeral: true });
      try {
        const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
        const gameAffairsId = '1457189093594239147';
        const wasLeadershipTarget = task.target_type === 'Role' && (task.target_id === leadershipRoleId || task.target_id === gameAffairsId);
        if (wasLeadershipTarget && task.created_by_id && task.created_by_id !== interaction.user.id) {
          const globalPingId = queryOne("SELECT channel_id FROM discord_config WHERE key = 'global_ping_channel'")?.channel_id;
          if (globalPingId) {
            const ch = await interaction.client.channels.fetch(globalPingId).catch(() => null);
            if (ch) await ch.send(`✅ <@${task.created_by_id}> — your task "${task.description}" has been completed by **${author}**.`);
          }
        }
      } catch (e) { console.error('Creator ping failed:', e.message); }
    }
  }
};
