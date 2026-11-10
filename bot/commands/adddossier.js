import { SlashCommandBuilder } from 'discord.js';
import { run } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';
import { requireStaff, replyEphemeral } from '../lib/auth.js';
import { assertFactionWrite, respondFactions } from '../lib/factions.js';
import { str } from '../../shared/validate.js';

export default {
  data: new SlashCommandBuilder().setName('adddossier').setDescription('Add a member to a faction dossier')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('name').setDescription('Character name').setRequired(true).setMaxLength(100))
    .addStringOption(o => o.setName('phone').setDescription('Phone number').setRequired(false).setMaxLength(40))
    .addStringOption(o => o.setName('residence').setDescription('Residence').setRequired(false).setMaxLength(120)),
  async autocomplete(interaction) { await respondFactions(interaction); },
  async execute(interaction) {
    const actor = await requireStaff(interaction, 1);
    if (!actor) return;
    const r = assertFactionWrite(actor, interaction.options.getString('faction'));
    if (r.error) return replyEphemeral(interaction, `❌ ${r.error}`);
    const f = r.faction;
    const charName = str(interaction.options.getString('name'), { max: 100 });
    if (!charName) return replyEphemeral(interaction, '❌ A character name is required.');
    const phone = str(interaction.options.getString('phone'), { max: 40 }) || 'N/A';
    const residence = str(interaction.options.getString('residence'), { max: 120 }) || 'N/A';
    const ins = run("INSERT INTO faction_members (faction_id, character_name, phone, residence) VALUES (?, ?, ?, ?)", [f.id, charName, phone, residence]);
    logAudit(actor.id, actor.name, 'CREATE', 'faction_member', Number(ins.lastInsertRowid), `${charName} (${f.name})`, 'via /adddossier');
    await interaction.reply({ content: `✅ **${charName}** added to **${f.name}** dossier.\n📞 ${phone} | 🏠 ${residence}`, ephemeral: true });
  }
};
