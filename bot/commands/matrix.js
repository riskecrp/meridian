import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query, queryOne } from '../lib/db.js';
export default {
  data: new SlashCommandBuilder().setName('matrix').setDescription('View the Meridian Operations Hub')
    .addSubcommand(s => s.setName('link').setDescription('Get the dashboard link'))
    .addSubcommand(s => s.setName('teams').setDescription('View all teams and their assignments'))
    .addSubcommand(s => s.setName('team').setDescription('View a specific team')
      .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('staff').setDescription('View a staff member')
      .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const teams = query("SELECT DISTINCT team_name FROM staff WHERE team_name != '' AND team_name != 'Game Affairs Management' ORDER BY team_name").map(r => r.team_name);
    await interaction.respond(teams.filter(t => t.toLowerCase().includes(focused)).slice(0, 25).map(t => ({ name: t, value: t })));
  },
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'link') {
      await interaction.reply({ content: '🔗 **Meridian Operations Hub**\nhttps://ecrpfm.com' });
      return;
    }

    await interaction.deferReply();

    if (sub === 'teams') {
      const teams = query("SELECT DISTINCT team_id, team_name FROM staff WHERE team_id != '' AND team_name != 'Game Affairs Management' ORDER BY team_name");
      const embeds = [];
      for (const team of teams) {
        const members = query("SELECT display_name, rank FROM staff WHERE team_id = ? ORDER BY CASE WHEN rank LIKE '%Lead%' THEN 0 ELSE 1 END, display_name", [team.team_id]);
        const factions = query("SELECT f.name, f.tier, f.discord_url, f.forum_url, f.thread_id FROM factions f JOIN staff s ON f.lead_discord_id = s.discord_id WHERE s.team_id = ? AND f.archived = 0 ORDER BY f.name", [team.team_id]);
        const lead = members.find(m => m.rank && m.rank.toLowerCase().includes('lead'));
        const guides = members.filter(m => !m.rank?.toLowerCase().includes('lead')).map(m => m.display_name);
        let factionList = '';
        for (const fc of factions) {
          const links = [];
          if (fc.discord_url) links.push('[Discord](' + fc.discord_url + ')');
          if (fc.forum_url) links.push('[Forum](' + fc.forum_url + ')');
          if (fc.thread_id) links.push('[Feedback](https://discord.com/channels/1457188814916423855/' + fc.thread_id + ')');
          factionList += 'T' + fc.tier + ' **' + fc.name + '**' + (links.length ? ' — ' + links.join(' · ') : '') + '\n';
        }
        factionList = factionList || 'None assigned';
        embeds.push(new EmbedBuilder()
          .setTitle(team.team_name).setColor(0x6366F1)
          .addFields(
            { name: 'Team Lead', value: lead?.display_name || 'Vacant', inline: true },
            { name: 'Guides', value: guides.join(', ') || 'None', inline: true },
            { name: `Factions (${factions.length})`, value: factionList.substring(0, 1024), inline: false }
          ));
      }
      await interaction.editReply({ embeds: embeds.slice(0, 10) });
      return;
    }

    if (sub === 'team') {
      const teamName = interaction.options.getString('name');
      const team = queryOne("SELECT team_id, team_name FROM staff WHERE team_name = ? LIMIT 1", [teamName]);
      if (!team) return interaction.editReply({ content: `Team "${teamName}" not found.`, ephemeral: true });
      const members = query("SELECT display_name, rank, discord_id FROM staff WHERE team_id = ? ORDER BY CASE WHEN rank LIKE '%Lead%' THEN 0 ELSE 1 END, display_name", [team.team_id]);
      const factions = query("SELECT f.name, f.tier, f.discord_url, f.forum_url, f.thread_id FROM factions f JOIN staff s ON f.lead_discord_id = s.discord_id WHERE s.team_id = ? AND f.archived = 0", [team.team_id]);
      const scenes30 = query("SELECT f.name, COUNT(sl.id) as cnt FROM factions f JOIN staff s ON f.lead_discord_id = s.discord_id LEFT JOIN scene_logs sl ON sl.faction_id = f.id AND sl.created_at >= datetime('now','-30 days') WHERE s.team_id = ? AND f.archived = 0 GROUP BY f.name", [team.team_id]);
      const sceneMap = {}; scenes30.forEach(s => { sceneMap[s.name] = s.cnt; });
      const lead = members.find(m => m.rank?.toLowerCase().includes('lead'));
      const guides = members.filter(m => !m.rank?.toLowerCase().includes('lead'));
      let factionDesc = '';
      for (const f of factions) {
        factionDesc += `**${f.name}** (T${f.tier}) — ${sceneMap[f.name] || 0} scenes/30d\n`;
        const links = [];
        if (f.discord_url) links.push(`[Discord](${f.discord_url})`);
        if (f.forum_url) links.push(`[Forum](${f.forum_url})`);
        if (f.thread_id) links.push(`<#${f.thread_id}>`);
        if (links.length) factionDesc += links.join(' · ') + '\n';
        factionDesc += '\n';
      }
      const embed = new EmbedBuilder().setTitle(team.team_name).setColor(0x6366F1)
        .addFields(
          { name: 'Team Lead', value: lead ? `${lead.display_name} (<@${lead.discord_id}>)` : 'Vacant', inline: false },
          { name: 'Guides', value: guides.map(g => `${g.display_name} (<@${g.discord_id}>)`).join('\n') || 'None', inline: false },
          { name: `Factions (${factions.length})`, value: factionDesc.substring(0, 1024) || 'None assigned', inline: false }
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'staff') {
      const user = interaction.options.getUser('user');
      const staff = queryOne("SELECT * FROM staff WHERE discord_id = ?", [user.id]);
      if (!staff) return interaction.editReply({ content: `${user.username} is not in the FM staff database.`, ephemeral: true });
      const factions = query("SELECT f.name, f.tier, f.discord_url, f.forum_url, f.thread_id FROM factions f JOIN staff s ON f.lead_discord_id = s.discord_id WHERE s.team_id = ? AND f.archived = 0", [staff.team_id]);
      const scenes30 = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE author_id = ? AND created_at >= datetime('now','-30 days')", [user.id]);
      const scenesAll = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE author_id = ?", [user.id]);
      const embed = new EmbedBuilder().setTitle(staff.display_name).setColor(0x6366F1)
        .addFields(
          { name: 'Team', value: staff.team_name || 'Unassigned', inline: true },
          { name: 'Rank', value: staff.rank || 'Guide', inline: true },
          { name: 'Clearance', value: `L${staff.clearance}`, inline: true },
          { name: 'Scenes (30d)', value: `${scenes30?.c || 0}`, inline: true },
          { name: 'Scenes (All)', value: `${scenesAll?.c || 0}`, inline: true },
          { name: 'Assigned Factions', value: factions.map(f => {
          const links = [];
          if (f.discord_url) links.push('[Discord](' + f.discord_url + ')');
          if (f.forum_url) links.push('[Forum](' + f.forum_url + ')');
          if (f.thread_id) links.push('[Feedback](https://discord.com/channels/1457188814916423855/' + f.thread_id + ')');
          return 'T' + f.tier + ' **' + f.name + '**' + (links.length ? '\n' + links.join(' · ') : '');
        }).join('\n\n') || 'None', inline: false }
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }
  }
};
