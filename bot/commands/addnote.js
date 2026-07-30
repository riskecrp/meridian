import { SlashCommandBuilder } from 'discord.js';
import { queryOne, run } from '../lib/db.js';
import { logAudit } from '../lib/audit.js';
export default {
  data: new SlashCommandBuilder().setName('addnote').setDescription('Add an intelligence note to a faction')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('note').setDescription('Note text').setRequired(true)),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const { query } = await import('../lib/db.js');
    const factions = query("SELECT name FROM factions ORDER BY name").map(r => r.name);
    await interaction.respond(factions.filter(f => f.toLowerCase().includes(focused)).slice(0, 25).map(f => ({ name: f, value: f })));
  },
  async execute(interaction) {
    const factionName = interaction.options.getString('faction');
    const note = interaction.options.getString('note');
    const f = queryOne("SELECT id FROM factions WHERE name = ?", [factionName]);
    if (!f) return interaction.reply({ content: `Faction "${factionName}" not found.`, ephemeral: true });
    const today = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }).replace(/ /g, '/').toUpperCase();
    const author = interaction.user.globalName || interaction.user.username;
    run("INSERT INTO intel_notes (faction_id, text, author, author_id, date) VALUES (?, ?, ?, ?, ?)",
      [f.id, note, author, interaction.user.id, today]);
    logAudit(interaction.user.id, author, 'CREATE', 'intel_note', f.id, factionName, note.slice(0, 120));
    await interaction.reply({ content: `📝 Note added to **${factionName}**`, ephemeral: true });
  }
};
