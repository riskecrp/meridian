import { SlashCommandBuilder } from 'discord.js';
import { run } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';
import { requireStaff, replyEphemeral } from '../lib/auth.js';
import { assertFactionWrite, respondFactions } from '../lib/factions.js';
import { str } from '../../shared/validate.js';
import { todayIso } from '../../shared/dates.js';

export default {
  data: new SlashCommandBuilder().setName('addnote').setDescription('Add an intelligence note to a faction')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('note').setDescription('Note text').setRequired(true).setMaxLength(2000)),
  async autocomplete(interaction) { await respondFactions(interaction); },
  async execute(interaction) {
    const actor = await requireStaff(interaction, 1);
    if (!actor) return;
    const r = assertFactionWrite(actor, interaction.options.getString('faction'));
    if (r.error) return replyEphemeral(interaction, `❌ ${r.error}`);
    const f = r.faction;
    const note = str(interaction.options.getString('note'), { max: 2000 });
    if (!note) return replyEphemeral(interaction, '❌ The note is empty.');
    const ins = run("INSERT INTO intel_notes (faction_id, text, author, author_id, date) VALUES (?, ?, ?, ?, ?)",
      [f.id, note, actor.name, actor.id, todayIso()]);
    logAudit(actor.id, actor.name, 'CREATE', 'intel_note', Number(ins.lastInsertRowid), f.name, note.slice(0, 120));
    await interaction.reply({ content: `📝 Note added to **${f.name}**`, ephemeral: true });
  }
};
