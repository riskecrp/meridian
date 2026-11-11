import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { query, queryOne, run } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';
import { requireStaff } from '../lib/auth.js';

// Discord twin of the dashboard's keyword manager (Member Log page / api/keywords):
// same table, same normalisation (trimmed, lower-cased), same audience — L3 by
// the staff roster (owners are L3 by definition). setDefaultMemberPermissions
// only hides the command from the menu; requireStaff is the real gate.
const norm = s => String(s ?? '').trim().toLowerCase();

export default {
  data: new SlashCommandBuilder()
    .setName('triggerword')
    .setDescription('Manage the trigger words that alert on server messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a trigger word or phrase (matched case-insensitively, anywhere in a message)')
      .addStringOption(o => o.setName('phrase').setDescription('Word or phrase to watch for').setRequired(true).setMaxLength(200)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a trigger word')
      .addStringOption(o => o.setName('phrase').setDescription('Trigger word to remove').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Show the current trigger words')),

  async autocomplete(interaction) {
    const typed = norm(interaction.options.getFocused());
    const rows = query("SELECT phrase FROM server_log_keywords ORDER BY phrase");
    const choices = rows.map(r => r.phrase).filter(p => !typed || p.includes(typed)).slice(0, 25);
    await interaction.respond(choices.map(p => ({ name: p.slice(0, 100), value: p.slice(0, 100) })));
  },

  async execute(interaction) {
    const actor = await requireStaff(interaction, 3);
    if (!actor) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const phrase = norm(interaction.options.getString('phrase')).slice(0, 200);
      if (!phrase) { await interaction.reply({ content: '❌ Phrase required.', ephemeral: true }); return; }
      const existing = queryOne("SELECT id FROM server_log_keywords WHERE phrase = ? COLLATE NOCASE", [phrase]);
      if (existing) {
        await interaction.reply({ content: `ℹ️ **${phrase}** is already a trigger word.`, ephemeral: true });
        return;
      }
      const ins = run("INSERT OR IGNORE INTO server_log_keywords (phrase) VALUES (?)", [phrase]);
      logAudit(actor.id, actor.name, 'CREATE', 'trigger_word', Number(ins.lastInsertRowid), phrase, 'added via /triggerword');
      const total = queryOne("SELECT COUNT(*) AS n FROM server_log_keywords")?.n ?? 0;
      await interaction.reply({ content: `✅ Added trigger word **${phrase}**. Alerts fire on any message or edit containing it (${total} trigger word${total === 1 ? '' : 's'} active).`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      const phrase = norm(interaction.options.getString('phrase'));
      const existing = queryOne("SELECT id FROM server_log_keywords WHERE phrase = ? COLLATE NOCASE", [phrase]);
      if (!existing) {
        await interaction.reply({ content: `❌ **${phrase}** isn't a trigger word. Use \`/triggerword list\` to see them.`, ephemeral: true });
        return;
      }
      run("DELETE FROM server_log_keywords WHERE id = ?", [existing.id]);
      logAudit(actor.id, actor.name, 'DELETE', 'trigger_word', existing.id, phrase, 'removed via /triggerword');
      await interaction.reply({ content: `✅ Removed trigger word **${phrase}**.`, ephemeral: true });
      return;
    }

    if (sub === 'list') {
      const rows = query("SELECT phrase, created_at FROM server_log_keywords ORDER BY phrase");
      if (!rows.length) {
        await interaction.reply({ content: 'No trigger words are set. Add one with `/triggerword add`.', ephemeral: true });
        return;
      }
      const lines = rows.map(r => `• **${r.phrase}**`);
      await interaction.reply({ content: `**Trigger words (${rows.length}):**\n${lines.join('\n')}`.slice(0, 1900), ephemeral: true });
    }
  },
};
