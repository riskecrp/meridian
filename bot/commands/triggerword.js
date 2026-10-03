import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { query, queryOne, run } from '../lib/db.js';
import { logAudit, actorOf } from '../lib/audit.js';
import { getRole } from '../lib/pings.js';

// Discord twin of the dashboard's keyword manager (Member Log page / api/keywords):
// same table, same normalisation (trimmed, lower-cased), same audience. The
// dashboard lets Level 3 in — FM Leadership, Game Affairs Management, Founder,
// Executive Admin — so this does too, by the same discord_roles keys, plus the
// bot owner. setDefaultMemberPermissions only hides the command from the
// menu; the role check below is the real gate.
const L3_ROLE_KEYS = ['fm_leadership', 'game_affairs', 'founder', 'executive_admin'];
const RISK_DISCORD_ID = process.env.RISK_DISCORD_ID || '738214924760907907';

function allowed(interaction) {
  if (interaction.user.id === RISK_DISCORD_ID) return true;
  const roles = interaction.member?.roles?.cache;
  if (!roles) return false;
  return L3_ROLE_KEYS.some(k => { const id = getRole(k); return id && roles.has(id); });
}

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
    if (!allowed(interaction)) {
      await interaction.reply({ content: '❌ Only FM Leadership, Game Affairs Management, Founders or Executive Admins can manage trigger words.', ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const phrase = norm(interaction.options.getString('phrase'));
      if (!phrase) { await interaction.reply({ content: '❌ Phrase required.', ephemeral: true }); return; }
      const existing = queryOne("SELECT id FROM server_log_keywords WHERE phrase = ? COLLATE NOCASE", [phrase]);
      if (existing) {
        await interaction.reply({ content: `ℹ️ **${phrase}** is already a trigger word.`, ephemeral: true });
        return;
      }
      run("INSERT OR IGNORE INTO server_log_keywords (phrase) VALUES (?)", [phrase]);
      logAudit(interaction.user.id, actorOf(interaction), 'CREATE', 'trigger_word', phrase, phrase, 'added via /triggerword');
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
      logAudit(interaction.user.id, actorOf(interaction), 'DELETE', 'trigger_word', phrase, phrase, 'removed via /triggerword');
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
