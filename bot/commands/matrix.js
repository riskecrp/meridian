import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query, queryOne } from '../lib/db.js';
import { BASE_URL } from '../lib/pings.js';
import { requireStaff, replyEphemeral } from '../lib/auth.js';
import { guildChannelUrl } from '../../shared/config.js';

// Team rosters come from the teams table (Admin › Staff), leads are the L2 on
// the team and guides the L1s — clearance is the truth, never the rank text.
const ACTIVE = "COALESCE(active, 1) = 1 AND discord_id NOT LIKE 'placeholder%'";

function factionLinks(fc, { mentionThread = false } = {}) {
  const links = [];
  if (fc.discord_url) links.push(`[Discord](${fc.discord_url})`);
  if (fc.forum_url) links.push(`[Forum](${fc.forum_url})`);
  if (fc.thread_id) {
    if (mentionThread) links.push(`<#${fc.thread_id}>`);
    else { const u = guildChannelUrl(fc.thread_id); links.push(u.startsWith('http') ? `[Feedback](${u})` : u); }
  }
  return links;
}

export default {
  data: new SlashCommandBuilder().setName('matrix').setDescription('View the Meridian Operations Hub')
    .addSubcommand(s => s.setName('link').setDescription('Get the dashboard link'))
    .addSubcommand(s => s.setName('teams').setDescription('View all teams and their assignments'))
    .addSubcommand(s => s.setName('team').setDescription('View a specific team')
      .addStringOption(o => o.setName('name').setDescription('Team name').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('staff').setDescription('View a staff member')
      .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))),
  async autocomplete(interaction) {
    const focused = String(interaction.options.getFocused() || '').toLowerCase();
    const teams = query("SELECT team_name FROM teams ORDER BY team_name").map(r => r.team_name);
    await interaction.respond(teams.filter(t => t.toLowerCase().includes(focused)).slice(0, 25).map(t => ({ name: t, value: t })));
  },
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'link') {
      await interaction.reply({ content: `🔗 **Meridian Operations Hub**\n${BASE_URL}` });
      return;
    }

    const actor = await requireStaff(interaction, 1, { allowLeadStoryteller: true });
    if (!actor) return;
    await interaction.deferReply();

    const membersOf = (teamId) => query(`SELECT display_name, rank, clearance, discord_id FROM staff WHERE team_id = ? AND ${ACTIVE} ORDER BY clearance DESC, display_name`, [teamId]);
    const factionsOf = (teamId) => query("SELECT f.name, f.tier, f.discord_url, f.forum_url, f.thread_id FROM factions f JOIN staff s ON f.lead_discord_id = s.discord_id WHERE s.team_id = ? AND f.archived = 0 ORDER BY f.name", [teamId]);
    const leadOf = (members) => members.find(m => m.clearance === 2) || null;
    const guidesOf = (members) => members.filter(m => m.clearance <= 1);
    const leadershipOf = (members) => members.filter(m => m.clearance >= 3);

    if (sub === 'teams') {
      const teams = query("SELECT team_id, team_name FROM teams ORDER BY team_name");
      const embeds = [];
      for (const team of teams) {
        const members = membersOf(team.team_id);
        const factions = factionsOf(team.team_id);
        const lead = leadOf(members);
        let factionList = '';
        for (const fc of factions) {
          const links = factionLinks(fc);
          factionList += 'T' + fc.tier + ' **' + fc.name + '**' + (links.length ? ' — ' + links.join(' · ') : '') + '\n';
        }
        factionList = factionList || 'None assigned';
        const fields = [
          { name: 'Team Lead', value: lead?.display_name || 'Vacant', inline: true },
          { name: 'Guides', value: guidesOf(members).map(m => m.display_name).join(', ') || 'None', inline: true },
        ];
        const leadership = leadershipOf(members);
        if (leadership.length) fields.push({ name: 'Leadership', value: leadership.map(m => m.display_name).join(', '), inline: true });
        fields.push({ name: `Factions (${factions.length})`, value: factionList.substring(0, 1024), inline: false });
        embeds.push(new EmbedBuilder().setTitle(team.team_name).setColor(0x6366F1).addFields(fields));
      }
      if (!embeds.length) return interaction.editReply({ content: 'No teams are configured yet.' });
      await interaction.editReply({ embeds: embeds.slice(0, 10) });
      return;
    }

    if (sub === 'team') {
      const teamName = String(interaction.options.getString('name') || '').trim();
      const team = queryOne("SELECT team_id, team_name FROM teams WHERE team_name = ? COLLATE NOCASE", [teamName]);
      if (!team) return interaction.editReply({ content: `Team "${teamName}" not found.` });
      const members = membersOf(team.team_id);
      const factions = factionsOf(team.team_id);
      const scenes30 = query("SELECT f.name, COUNT(sl.id) as cnt FROM factions f JOIN staff s ON f.lead_discord_id = s.discord_id LEFT JOIN scene_logs sl ON sl.faction_id = f.id AND sl.created_at >= datetime('now','-30 days') WHERE s.team_id = ? AND f.archived = 0 GROUP BY f.name", [team.team_id]);
      const sceneMap = {}; scenes30.forEach(s => { sceneMap[s.name] = s.cnt; });
      const lead = leadOf(members);
      let factionDesc = '';
      for (const f of factions) {
        factionDesc += `**${f.name}** (T${f.tier}) — ${sceneMap[f.name] || 0} scenes/30d\n`;
        const links = factionLinks(f, { mentionThread: true });
        if (links.length) factionDesc += links.join(' · ') + '\n';
        factionDesc += '\n';
      }
      const embed = new EmbedBuilder().setTitle(team.team_name).setColor(0x6366F1)
        .addFields(
          { name: 'Team Lead', value: lead ? `${lead.display_name} (<@${lead.discord_id}>)` : 'Vacant', inline: false },
          { name: 'Guides', value: guidesOf(members).map(g => `${g.display_name} (<@${g.discord_id}>)`).join('\n') || 'None', inline: false },
          { name: `Factions (${factions.length})`, value: factionDesc.substring(0, 1024) || 'None assigned', inline: false }
        );
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }

    if (sub === 'staff') {
      const user = interaction.options.getUser('user');
      const staff = queryOne("SELECT * FROM staff WHERE discord_id = ?", [user.id]);
      if (!staff) return interaction.editReply({ content: `${user.username} is not in the FM staff database.` });
      const factions = staff.team_id ? factionsOf(staff.team_id) : [];
      const scenes30 = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE author_id = ? AND created_at >= datetime('now','-30 days')", [user.id]);
      const scenesAll = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE author_id = ?", [user.id]);
      const embed = new EmbedBuilder().setTitle(`${staff.display_name}${staff.active === 0 ? ' (retired)' : ''}`).setColor(0x6366F1)
        .addFields(
          { name: 'Team', value: staff.team_name || 'Unassigned', inline: true },
          { name: 'Rank', value: staff.rank || 'Guide', inline: true },
          { name: 'Clearance', value: `L${staff.clearance}`, inline: true },
          { name: 'Scenes (30d)', value: `${scenes30?.c || 0}`, inline: true },
          { name: 'Scenes (All)', value: `${scenesAll?.c || 0}`, inline: true },
          { name: 'Assigned Factions', value: factions.map(f => {
            const links = factionLinks(f);
            return 'T' + f.tier + ' **' + f.name + '**' + (links.length ? '\n' + links.join(' · ') : '');
          }).join('\n\n') || 'None', inline: false }
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    await replyEphemeral(interaction, 'Unknown subcommand.');
  }
};
