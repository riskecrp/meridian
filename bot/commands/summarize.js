import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { query } from '../lib/db.js';
import { requireStaff, replyEphemeral } from '../lib/auth.js';
import { findFaction, respondFactions } from '../lib/factions.js';
import { legacyDate } from '../../shared/dates.js';

// Plain fetch against the OpenAI chat completions API — no SDK dependency.
// OPENAI_API_KEY is required; OPENAI_MODEL overrides the model. Intel and
// channel transcripts leave the server here, so this is staff-only.
const MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';

/** Returns { text } or { error } — never throws, never swallows an HTTP error. */
export async function askOpenAI(messages, { maxTokens = 900 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { error: 'OpenAI is not configured on this bot (OPENAI_API_KEY is unset). Ask whoever runs the server.' };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, messages }),
      signal: AbortSignal.timeout(60000),
    });
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    if (!r.ok) {
      const detail = data?.error?.message || `HTTP ${r.status}`;
      return { error: r.status === 401 ? `OpenAI rejected the API key (${detail}).` : r.status === 429 ? `OpenAI is rate-limiting or out of quota (${detail}).` : `OpenAI returned an error (${detail}).` };
    }
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text ? { text } : { error: 'OpenAI returned an empty response.' };
  } catch (e) {
    return { error: `Could not reach OpenAI (${e.message}).` };
  }
}

export default {
  data: new SlashCommandBuilder().setName('summarize').setDescription('AI-powered summary — faction intel or channel recap')
    .addStringOption(o => o.setName('faction').setDescription('Faction name (omit to summarize this channel)').setRequired(false).setAutocomplete(true)),

  async autocomplete(interaction) { await respondFactions(interaction, { includeArchived: true }); },

  async execute(interaction) {
    const actor = await requireStaff(interaction, 1);
    if (!actor) return;
    if (!process.env.OPENAI_API_KEY) return replyEphemeral(interaction, '❌ OpenAI is not configured on this bot (OPENAI_API_KEY is unset). Ask whoever runs the server.');

    const factionInput = interaction.options.getString('faction');

    // ── Faction summary ───────────────────────────────────────────────────────
    if (factionInput) {
      const r = findFaction(factionInput, { allowArchived: true });
      if (r.error) return replyEphemeral(interaction, `❌ ${r.error}`);
      const f = r.faction;
      await interaction.deferReply();
      const logs  = query("SELECT date, rewards, logged_by, notes FROM scene_logs WHERE faction_id = ? ORDER BY created_at DESC LIMIT 30", [f.id]);
      const notes = query("SELECT date, author, text FROM intel_notes WHERE faction_id = ? ORDER BY created_at DESC LIMIT 20", [f.id]);
      if (logs.length === 0 && notes.length === 0) return interaction.editReply('No data to summarize.');
      const input = `Faction: ${f.name}\n\n=== SCENES ===\n${logs.map(l => `[${legacyDate(l.date)}] ${l.logged_by}: ${l.notes} | ${l.rewards}`).join('\n')}\n\n=== NOTES ===\n${notes.map(n => `[${legacyDate(n.date)}] ${n.author}: ${n.text}`).join('\n')}`.slice(0, 24000);
      const res = await askOpenAI([
        { role: "system", content: "You are a Faction Management analyst for a GTA RP server. Provide a concise brief: 1) Summary, 2) Key Personnel, 3) Recent Activity, 4) Concerns, 5) Recommendations." },
        { role: "user", content: input },
      ]);
      if (res.error) return interaction.editReply(`❌ ${res.error}`);
      const embed = new EmbedBuilder().setTitle(`Intel Brief: ${f.name}`).setColor(0x6366F1)
        .setDescription(res.text.substring(0, 4096)).setFooter({ text: 'Powered by AI • May contain inaccuracies' });
      await interaction.editReply({ embeds: [embed] });
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

    const res = await askOpenAI([
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ], { maxTokens: 600 });
    if (res.error) return interaction.editReply(`❌ ${res.error}`);
    const embed = new EmbedBuilder()
      .setTitle(`Channel Situation Report — #${channelName}`)
      .setColor(0x475569)
      .setDescription(res.text.substring(0, 4096))
      .setFooter({ text: `Last ${lines.length} messages analyzed • Powered by AI` });
    await interaction.editReply({ embeds: [embed] });
  }
};
