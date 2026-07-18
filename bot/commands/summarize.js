import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query, queryOne } from '../lib/db.js';

export default {
  data: new SlashCommandBuilder().setName('summarize').setDescription('AI-powered summary — faction intel or channel recap')
    .addStringOption(o => o.setName('faction').setDescription('Faction name (omit to summarize this channel)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const factions = query("SELECT name FROM factions ORDER BY name").map(r => r.name);
    await interaction.respond(factions.filter(f => f.toLowerCase().includes(focused)).slice(0, 25).map(f => ({ name: f, value: f })));
  },

  async execute(interaction) {
    if (!process.env.OPENAI_API_KEY) return interaction.reply({ content: 'OpenAI API key not configured.', ephemeral: true });

    const factionName = interaction.options.getString('faction');

    // ── Faction summary (existing behaviour) ──────────────────────────────────
    if (factionName) {
      const f = queryOne("SELECT id FROM factions WHERE name = ?", [factionName]);
      if (!f) return interaction.reply({ content: `Faction "${factionName}" not found.`, ephemeral: true });
      await interaction.deferReply();
      const logs  = query("SELECT date, rewards, logged_by, notes FROM scene_logs WHERE faction_id = ? ORDER BY created_at DESC LIMIT 30", [f.id]);
      const notes = query("SELECT date, author, text FROM intel_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT 20", [f.id]);
      if (logs.length === 0 && notes.length === 0) return interaction.editReply('No data to summarize.');
      const input = `Faction: ${factionName}\n\n=== SCENES ===\n${logs.map(l => `[${l.date}] ${l.logged_by}: ${l.notes} | ${l.rewards}`).join('\n')}\n\n=== NOTES ===\n${notes.map(n => `[${n.date}] ${n.author}: ${n.text}`).join('\n')}`;
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: [
            { role: "system", content: "You are a Faction Management analyst for a GTA RP server. Provide a concise brief: 1) Summary, 2) Key Personnel, 3) Recent Activity, 4) Concerns, 5) Recommendations." },
            { role: "user", content: input }
          ]})
        });
        const data = await r.json();
        const summary = data.choices?.[0]?.message?.content || "No response.";
        const embed = new EmbedBuilder().setTitle(`Intel Brief: ${factionName}`).setColor(0x6366F1)
          .setDescription(summary.substring(0, 4096)).setFooter({ text: 'Powered by AI • May contain inaccuracies' });
        await interaction.editReply({ embeds: [embed] });
      } catch (e) { await interaction.editReply('AI summary failed: ' + e.message); }
      return;
    }

    // ── Channel summary ────────────────────────────────────────────────────────
    await interaction.deferReply();

    let messages;
    try {
      const batch1 = await interaction.channel.messages.fetch({ limit: 100 });
      const oldest = batch1.last();
      const batch2 = oldest ? await interaction.channel.messages.fetch({ limit: 50, before: oldest.id }) : new Map();
      // Combine newest-first, then reverse to chronological order
      messages = [...batch1.values(), ...batch2.values()].reverse();
    } catch (e) {
      return interaction.editReply('Could not read channel messages. Missing permissions?');
    }

    // Filter out bots and empty/system messages, truncate long content
    const lines = messages
      .filter(m => !m.author.bot && m.content?.trim())
      .map(m => {
        const ts = m.createdAt.toISOString().substring(11, 16); // HH:MM
        const content = m.content.replace(/\n+/g, ' ').substring(0, 300);
        return `[${ts}] ${m.author.username}: ${content}`;
      });

    if (lines.length < 3) return interaction.editReply('Not enough messages to summarize.');

    // Cap input to ~12k chars to stay well within token limits
    const transcript = lines.join('\n').substring(0, 12000);
    const channelName = interaction.channel.name ?? 'this channel';

    const systemPrompt = `You are a signals intelligence analyst. You have been handed a transcript of a Discord channel and asked to produce a situation report. Write in a dry, factual, bureaucratic style — the kind of prose that comes from someone who has stopped feeling things. Cover: who was present, what was discussed, notable patterns or recurring themes, and a one-sentence assessment of overall productivity. Do not editorialize or attempt humor. The humor will take care of itself.`;

    const userPrompt = `Channel: #${channelName}\nMessage count in transcript: ${lines.length}\n\n${transcript}`;

    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 600, messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt }
        ]})
      });
      const data = await r.json();
      const summary = data.choices?.[0]?.message?.content || "No response.";
      const embed = new EmbedBuilder()
        .setTitle(`Channel Situation Report — #${channelName}`)
        .setColor(0x475569)
        .setDescription(summary.substring(0, 4096))
        .setFooter({ text: `Last ${lines.length} messages analyzed • Powered by AI` });
      await interaction.editReply({ embeds: [embed] });
    } catch (e) { await interaction.editReply('AI summary failed: ' + e.message); }
  }
};
