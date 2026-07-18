import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query, queryOne } from '../lib/db.js';
export default {
  data: new SlashCommandBuilder().setName('factioninfo').setDescription('Show faction details')
    .addStringOption(o => o.setName('faction').setDescription('Faction name').setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const factions = query("SELECT name FROM factions ORDER BY name").map(r => r.name);
    await interaction.respond(factions.filter(f => f.toLowerCase().includes(focused)).slice(0, 25).map(f => ({ name: f, value: f })));
  },
  async execute(interaction) {
    await interaction.deferReply();
    const name = interaction.options.getString('faction');
    const f = queryOne("SELECT * FROM factions WHERE name = ?", [name]);
    if (!f) return interaction.editReply({ content: `Faction "${name}" not found.` });
    const members = query("SELECT character_name, phone, residence, is_leader FROM faction_members WHERE faction_id = ? ORDER BY is_leader DESC, character_name", [f.id]);
    const scenes30 = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE faction_id = ? AND created_at >= datetime('now','-30 days')", [f.id]);
    const scenesAll = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE faction_id = ?", [f.id]);
    const props = query("SELECT address, is_hq FROM properties WHERE faction_id = ?", [f.id]);
    const lead = queryOne("SELECT display_name, team_name FROM staff WHERE discord_id = ?", [f.lead_discord_id]);
    const guides = query("SELECT display_name FROM staff WHERE team_id = (SELECT team_id FROM staff WHERE discord_id = ?) AND discord_id != ?", [f.lead_discord_id, f.lead_discord_id]);

    // Format members with phone + residence
    let memberList = '';
    for (const m of members) {
      const prefix = m.is_leader ? '👑 ' : '• ';
      const phone = m.phone && m.phone !== 'N/A' ? ` | 📞 ${m.phone}` : '';
      const res = m.residence && m.residence !== 'N/A' ? ` | 🏠 ${m.residence}` : '';
      memberList += `${prefix}**${m.character_name}**${phone}${res}\n`;
    }
    memberList = memberList || 'No known members';

    const propList = props.map(p => `${p.is_hq ? '🏰 ' : '📍 '}${p.address}`).join('\n') || 'None';

    // Links
    const links = [];
    if (f.discord_url) links.push(`[Discord](${f.discord_url})`);
    if (f.forum_url) links.push(`[Forum](${f.forum_url})`);
    if (f.thread_id) links.push('[Feedback](https://discord.com/channels/1457188814916423855/' + f.thread_id + ')');
    const linkStr = links.join(' · ') || 'None configured';

    const embed = new EmbedBuilder()
      .setTitle(f.name).setColor(0x6366F1)
      .addFields(
        { name: 'Tier', value: `${f.tier}`, inline: true },
        { name: 'Scenes (30d)', value: `${scenes30?.c || 0}`, inline: true },
        { name: 'Scenes (All)', value: `${scenesAll?.c || 0}`, inline: true },
        { name: 'Forum Posts (30d)', value: `${f.forum_posts_30d || 0}`, inline: true },
        { name: 'Team', value: lead?.team_name || 'Unassigned', inline: true },
        { name: 'Team Lead', value: lead?.display_name || 'Unassigned', inline: true },
        { name: 'Guides', value: guides.map(g => g.display_name).join(', ') || 'None', inline: true },
        { name: 'Links', value: linkStr, inline: false },
        { name: `Known Command (${members.length})`, value: memberList.substring(0, 1024), inline: false },
        { name: 'Properties', value: propList.substring(0, 1024), inline: false },
      )
      .setFooter({ text: `Last promoted: ${f.last_promoted || 'Never'}` });
    await interaction.editReply({ embeds: [embed] });
  }
};
