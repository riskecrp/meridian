import { SlashCommandBuilder } from 'discord.js';
import { run } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';
import { requireStaff, replyEphemeral } from '../lib/auth.js';
import { assertFactionWrite, respondFactions } from '../lib/factions.js';
import { str } from '../../shared/validate.js';
import { todayIso } from '../../shared/dates.js';

export default {
  data: new SlashCommandBuilder().setName('logscene').setDescription('Quickly log a faction scene')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('notes').setDescription('Scene notes').setRequired(true).setMaxLength(4000))
    .addStringOption(o => o.setName('rewards').setDescription('Rewards given').setRequired(false).setMaxLength(500)),
  async autocomplete(interaction) { await respondFactions(interaction); },
  async execute(interaction) {
    const actor = await requireStaff(interaction, 1);
    if (!actor) return;
    const r = assertFactionWrite(actor, interaction.options.getString('faction'));
    if (r.error) return replyEphemeral(interaction, `❌ ${r.error}`);
    const f = r.faction;
    const notes = str(interaction.options.getString('notes'), { max: 4000 });
    if (!notes) return replyEphemeral(interaction, '❌ Scene notes are required.');
    const rewards = str(interaction.options.getString('rewards'), { max: 500 }) || 'None';
    const ins = run("INSERT INTO scene_logs (date, faction_id, rewards, logged_by, notes, author_id) VALUES (?, ?, ?, ?, ?, ?)",
      [todayIso(), f.id, rewards, actor.name, notes, actor.id]);
    logAudit(actor.id, actor.name, 'CREATE', 'scene', Number(ins.lastInsertRowid), f.name,
      `via /logscene${rewards !== 'None' ? ` · rewards: ${rewards}` : ''}`);
    await interaction.reply({ content: `✅ Scene logged for **${f.name}**\n> ${notes.substring(0, 200)}${rewards !== 'None' ? `\n**Rewards:** ${rewards}` : ''}` });
  }
};
