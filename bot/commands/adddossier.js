import { SlashCommandBuilder } from 'discord.js';
import { queryOne, run } from '../lib/db.js';
import { logAudit, actorOf } from '../lib/audit.js';
export default {
  data: new SlashCommandBuilder().setName('adddossier').setDescription('Add a member to a faction dossier')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('name').setDescription('Character name').setRequired(true))
    .addStringOption(o => o.setName('phone').setDescription('Phone number').setRequired(false))
    .addStringOption(o => o.setName('residence').setDescription('Residence').setRequired(false)),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const { query } = await import('../lib/db.js');
    const factions = query("SELECT name FROM factions ORDER BY name").map(r => r.name);
    await interaction.respond(factions.filter(f => f.toLowerCase().includes(focused)).slice(0, 25).map(f => ({ name: f, value: f })));
  },
  async execute(interaction) {
    const factionName = interaction.options.getString('faction');
    const charName = interaction.options.getString('name');
    const phone = interaction.options.getString('phone') || 'N/A';
    const residence = interaction.options.getString('residence') || 'N/A';
    const f = queryOne("SELECT id FROM factions WHERE name = ?", [factionName]);
    if (!f) return interaction.reply({ content: `Faction "${factionName}" not found.`, ephemeral: true });
    run("INSERT INTO faction_members (faction_id, character_name, phone, residence) VALUES (?, ?, ?, ?)", [f.id, charName, phone, residence]);
    logAudit(interaction.user.id, actorOf(interaction), 'CREATE', 'faction_member', f.id, `${charName} (${factionName})`, 'via /adddossier');
    await interaction.reply({ content: `✅ **${charName}** added to **${factionName}** dossier.\n📞 ${phone} | 🏠 ${residence}`, ephemeral: true });
  }
};
