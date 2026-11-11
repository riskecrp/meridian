// Loads .env before anything else reads process.env (see lib/env.js).
import { envReport } from './lib/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client, Collection, Events, AuditLogEvent, GatewayIntentBits, Options, REST, Routes, Partials } from 'discord.js';
import { startScheduler, startChannelPurge, startReminderPurge, startHousekeeping } from './scheduler.js';
import { syncForumPosts } from './forumSync.js';
import { checkRecurringReminders } from './recurringReminders.js';
import { syncConversations } from './conversationSync.js';
import { startTaskReminder } from './taskReminder.js';
import { startPromotionReview } from './promotionReview.js';
import { startFactionFeedback, handleFeedbackButton } from './factionFeedback.js';
import { startFormSubmissions, handleFormButton, handleFormModal } from './formSubmissions.js';
import { handleTaskButton, handleTaskModal } from './taskButtons.js';
import { handleRPButton, handleRPModal } from './rpButtons.js';
import { handleDM } from './dmHandler.js';
import { sendPingVia, pingRoleIds, getRole } from './lib/pings.js';
import { logAudit } from './lib/audit.js';
import { query, queryOne, run } from './lib/db.js';
import { requireStaff, resolveActor, replyEphemeral } from './lib/auth.js';
import { assertFactionWrite } from './lib/factions.js';
import { ensureRequesterNotifier } from './lib/notify.js';
import { answerTaskQuestion } from '../shared/tasks.js';
import { GUILD_ID } from '../shared/config.js';
import { syncStaffFromRoles, retireStaffOnLeave } from './lib/staffSync.js';
import { todayIso } from '../shared/dates.js';
import { str } from '../shared/validate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

{
  const { envPath, missing } = envReport();
  console.log(`[SYSTEM] env from ${envPath}${missing.length ? ` — MISSING: ${missing.join(', ')}` : ''}`);
  if (!process.env.DISCORD_BOT_TOKEN) { console.error('[SYSTEM] DISCORD_BOT_TOKEN is not set; refusing to start.'); process.exit(1); }
  if (!GUILD_ID) console.error('[SYSTEM] GUILD_ID is not set: slash commands will not be registered and FM-guild features (staff sync, leadership mentions) are off.');
}

// Dynamically load all FM staff discord IDs, refreshed every 5 minutes.
let _cachedStaffIds = null;
let _staffCacheTime = 0;
function getWatchedUserIds() {
  const now = Date.now();
  if (!_cachedStaffIds || now - _staffCacheTime > 300000) {
    const rows = query("SELECT discord_id FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%' AND COALESCE(active, 1) = 1");
    _cachedStaffIds = new Set(rows.map(r => r.discord_id));
    _staffCacheTime = now;
  }
  return _cachedStaffIds;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 500 }),
});
client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
const commandsToRegister = [];

console.log(`[SYSTEM] Loading ${commandFiles.length} commands...`);
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = await import(pathToFileURL(filePath).href);
  if (command.default?.data && command.default?.execute) {
    client.commands.set(command.default.data.name, command.default);
    commandsToRegister.push(command.default.data.toJSON());
    console.log(`  -> Loaded: ${command.default.data.name}`);
  }
}

// Register the slash commands in the FM guild. Runs after login so the
// application id comes from the logged-in client rather than a second env var,
// and a failure is reported instead of swallowed inside an IIFE at import.
async function registerCommands(c) {
  const appId = c.user?.id || process.env.DISCORD_CLIENT_ID;
  if (!GUILD_ID || !appId) { console.error('[SYSTEM] Commands not registered: GUILD_ID / application id unknown.'); return; }
  try {
    const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
    await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commandsToRegister });
    console.log(`[SYSTEM] ${commandsToRegister.length} commands registered in guild ${GUILD_ID}.`);
  } catch (error) { console.error('[SYSTEM] Command registration failed:', error.message || error); }
}

// Hourly jobs never overlap: a run that is still going when the next tick
// arrives is skipped, not stacked.
function every(ms, label, fn) {
  let running = false;
  const tick = async () => {
    if (running) { console.warn(`[${label}] previous run still in progress — skipped`); return; }
    running = true;
    try { await fn(); } catch (e) { console.error(`[${label}]`, e.message); } finally { running = false; }
  };
  setInterval(tick, ms);
  return tick;
}

// Ready
client.once(Events.ClientReady, async c => {
  console.log(`[SYSTEM] Ready as ${c.user.tag}`);
  client.user.setPresence({ activities: [{ name: "Meridian Operations", type: 3 }], status: "online" });
  await registerCommands(c);
  ensureRequesterNotifier(client);   // RP-change requester notices go by DM through this client
  startScheduler(client);
  startTaskReminder(client);
  startPromotionReview(client);
  startChannelPurge(client);
  startReminderPurge(client);
  startHousekeeping();
  startFactionFeedback();
  startFormSubmissions();
  console.log("[SYSTEM] Scheduler + Task Reminders + Promotion Review + Channel Purge + Reminder Purge + Housekeeping + Faction Feedback + Form Intake started.");
  const forum = every(3600000, 'FORUM_SYNC', () => syncForumPosts(client));
  setTimeout(forum, 10000);
  console.log("[FORUM_SYNC] Scheduled every hour, first run in 10s");
  every(60000, 'RECURRING', () => checkRecurringReminders(client));
  console.log("[RECURRING] Reminders checked every minute; a definition fires at/after 18:00 UTC on its ping_day");
  const convo = every(3600000, 'CONVO_SYNC', () => syncConversations(client));
  setTimeout(convo, 30000);
  console.log("[CONVO_SYNC] Scheduled every hour, first run in 30s");
});

// ── Interaction handler ───────────────────────────────────────────────────────
// Every interaction gets an answer: a handler that recognises a custom id but
// cannot act replies ephemerally with the reason; anything unrecognised gets a
// short "no longer handled" so Discord never shows "This interaction failed".

async function handleSnooze(interaction) {
  const actor = await requireStaff(interaction, 1);
  if (!actor) return;
  const duration = interaction.customId.split("_")[1];
  const addMs = duration === "15m" ? 15 * 60000 : 60 * 60000;
  const newTime = Date.now() + addMs;
  const uuid = Math.random().toString(36).substring(2, 8);
  const originalEmbed = interaction.message?.embeds?.[0];
  const originalMsg = (originalEmbed ? originalEmbed.description : '') || "Snoozed Reminder";
  const initialStatus = addMs <= 30 * 60000 ? "WARNED" : "ACTIVE";
  try {
    run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, ?)",
      [uuid, actor.id, interaction.channelId, `(Snoozed) ${originalMsg}`.slice(0, 1000), newTime.toString(), new Date(newTime).toISOString(), `<@${actor.id}>`, initialStatus]);
    logAudit(actor.id, actor.name, 'CREATE', 'reminder', uuid, originalMsg.slice(0, 120), `snoozed ${duration} from a reminder`);
    await interaction.update({ content: `💤 **Snoozed for ${duration}.**`, components: [] });
  } catch (err) {
    console.error("[SNOOZE ERROR]", err);
    await replyEphemeral(interaction, "❌ Failed to snooze.");
  }
}

async function handleFeedbackModal(interaction) {
  const actor = await requireStaff(interaction, 1);
  if (!actor) return;
  const factionId = interaction.customId.replace("feedback_modal_", "");
  const r = assertFactionWrite(actor, factionId);
  if (r.error) { await replyEphemeral(interaction, `❌ ${r.error}`); return; }
  const f = r.faction;
  const notes = str(interaction.fields.getTextInputValue('notes'), { max: 4000 });
  const rewards = str(interaction.fields.getTextInputValue('rewards'), { max: 500 }) || 'None';
  if (!notes) { await replyEphemeral(interaction, '❌ Scene notes are required.'); return; }
  const ins = run("INSERT INTO scene_logs (date, faction_id, rewards, logged_by, notes, author_id) VALUES (?, ?, ?, ?, ?, ?)",
    [todayIso(), f.id, rewards, actor.name, notes, actor.id]);
  logAudit(actor.id, actor.name, 'CREATE', 'scene', Number(ins.lastInsertRowid), f.name, `via /feedback${rewards !== 'None' ? ` · rewards: ${rewards}` : ''}`);
  await interaction.reply({ content: '✅ **Scene Feedback Logged** for **' + f.name + '**\n> ' + notes.substring(0, 200) + (rewards !== 'None' ? '\n**Rewards:** ' + rewards : '') });
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) { await replyEphemeral(interaction, 'That command is no longer available.'); return; }
      try { await command.execute(interaction); }
      catch (error) {
        console.error('[CMD ERROR]', interaction.commandName, error.message || error);
        await replyEphemeral(interaction, 'Something went wrong running that command. It has been logged.');
      }
      return;
    }
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction).catch(e => console.error('[AUTOCOMPLETE ERROR]', e.message));
      else await interaction.respond([]).catch(() => {});
      return;
    }
    if (interaction.isModalSubmit()) {
      const { customId } = interaction;
      // Rejecting a form application asks for a reason first (frmmodal:*), so the
      // rejection itself lands here rather than on the button press.
      if (await handleFormModal(interaction)) return;
      if (await handleTaskModal(interaction)) return;
      if (await handleRPModal(interaction)) return;
      if (customId.startsWith('task_info_modal_')) {
        const actor = await requireStaff(interaction, 1);
        if (!actor) return;
        const questionId = parseInt(customId.replace('task_info_modal_', ''), 10);
        const answer = interaction.fields.getTextInputValue('answer');
        const res = await answerTaskQuestion(actor, questionId, answer);
        await replyEphemeral(interaction, res.ok ? '✅ Answer sent!' : `❌ ${res.error}`);
        return;
      }
      if (customId.startsWith("feedback_modal_")) { await handleFeedbackModal(interaction); return; }
      await replyEphemeral(interaction, 'This form is no longer handled.');
      return;
    }
    if (interaction.isButton()) {
      const { customId } = interaction;
      if (await handleFeedbackButton(interaction)) return;
      if (await handleFormButton(interaction)) return;
      if (await handleTaskButton(interaction)) return;
      if (await handleRPButton(interaction)) return;
      if (customId === "dismiss") {
        if (!await requireStaff(interaction, 1)) return;
        await interaction.update({ content: "✅ **Acknowledged.**", components: [] });
        return;
      }
      if (customId.startsWith('task_info_btn_')) {
        if (!await requireStaff(interaction, 1)) return;
        const questionId = parseInt(customId.replace('task_info_btn_', ''), 10);
        const q = queryOne("SELECT id, answer FROM task_questions WHERE id = ?", [questionId]);
        if (!q) { await replyEphemeral(interaction, '❌ Question not found.'); return; }
        if (q.answer) { await replyEphemeral(interaction, '✅ This question has already been answered.'); return; }
        await interaction.showModal({
          title: 'Answer Question',
          customId: `task_info_modal_${questionId}`,
          components: [{ type: 1, components: [{ type: 4, custom_id: 'answer', label: 'Your answer', style: 2, required: true, min_length: 1, max_length: 1000 }] }],
        });
        return;
      }
      if (customId.startsWith("snooze_")) { await handleSnooze(interaction); return; }
      await replyEphemeral(interaction, 'This button is no longer handled.');
    }
  } catch (e) {
    console.error('[INTERACTION]', e.message || e);
    await replyEphemeral(interaction, 'Something went wrong handling that. It has been logged.');
  }
});

// ── Messages: DMs, passive capture, auto-delete, keyword alerts ──────────────
client.on(Events.MessageCreate, async msg => {
  try {
    if (msg.author?.bot) return;

    // DM handler — staff only. Anyone else (including forwarded messages from
    // non-staff) gets a one-line answer instead of silence or a stored forward.
    if (!msg.guild) {
      const actor = resolveActor({ user: msg.author });
      if (!actor) {
        await msg.reply('This bot only takes DMs from FM staff on the roster. If you are staff, enable DM tracking on the dashboard first.').catch(() => {});
        return;
      }
      await handleDM(msg);
      return;
    }
    const channelName = msg.channel?.name || msg.channel?.id || 'unknown';
    const guildName   = msg.guild?.name || '';
    const content     = msg.content || '[no text content]';
    const createdAt   = msg.createdAt.toISOString();
    const authorName  = msg.author.globalName || msg.author.username;

    // Auto-delete channels — delete non-bot messages (with optional delay)
    const autoDelCfg = query("SELECT delay_seconds FROM auto_delete_channels WHERE channel_id = ?", [msg.channelId]);
    if (autoDelCfg.length > 0) {
      const delay = (autoDelCfg[0].delay_seconds || 0) * 1000;
      const doDelete = () => msg.delete().catch(() => {});
      if (delay > 0) setTimeout(doDelete, delay);
      else doDelete();
    }

    // Individual user pings — all FM staff, captured from any guild the bot is in
    const watchedUserIds = getWatchedUserIds();
    for (const userId of watchedUserIds) {
      if (msg.mentions?.users?.has(userId)) {
        run(
          `INSERT OR IGNORE INTO mentions
             (message_id, target_user_id, channel_id, channel_name, author_id, author_name, content, guild_id, guild_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [msg.id, userId, msg.channelId, channelName, msg.author.id, authorName, content, msg.guildId, guildName, createdAt]
        );
        console.log(`[MENTIONS] Stored mention of ${userId} from ${msg.author.username} in #${channelName} (${guildName})`);
      }
    }

    // FM Leadership role pings (FM guild only)
    const leadershipRole = getRole('fm_leadership');
    if (GUILD_ID && msg.guildId === GUILD_ID && leadershipRole && msg.mentions?.roles?.has(leadershipRole)) {
      run(
        `INSERT OR IGNORE INTO role_mentions
           (message_id, channel_id, channel_name, author_id, author_name, content, guild_id, guild_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [msg.id, msg.channelId, channelName, msg.author.id, authorName, content, msg.guildId, guildName, createdAt]
      );
      console.log(`[ROLE_MENTIONS] Stored FM Leadership mention from ${msg.author.username} in #${channelName}`);
    }

    // Configured watch role pings across all external servers
    if (msg.mentions?.roles?.size > 0) {
      const watchRoles = query(
        `SELECT bw.role_id, bw.role_name, bw.config_id, bc.guild_id, bc.guild_name
         FROM bot_watch_roles bw
         JOIN bot_server_configs bc ON bw.config_id = bc.id
         WHERE bc.guild_id = ?`,
        [msg.guildId]
      );
      for (const wr of watchRoles) {
        if (msg.mentions.roles.has(wr.role_id)) {
          run(
            `INSERT OR IGNORE INTO watch_role_mentions
               (message_id, config_id, watch_role_id, watch_role_name, channel_id, channel_name,
                author_id, author_name, content, guild_id, guild_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [msg.id, wr.config_id, wr.role_id, wr.role_name, msg.channelId, channelName,
             msg.author.id, authorName, content, msg.guildId, wr.guild_name, createdAt]
          );
          console.log(`[WATCH_ROLES] Stored @${wr.role_name} ping from ${msg.author.username} in #${channelName} (${wr.guild_name})`);
        }
      }
    }
    // Keyword scanning on all guild messages
    if (msg.guild && content) {
      await checkKeywords(content, msg, 'message');
    }
  } catch (e) {
    console.error('[MENTIONS] Error storing mention:', e.message);
  }
});

// ── Server log channel ────────────────────────────────────────────────────────
// Everything the server log records in the DB (joins, leaves, edits, deletes,
// trigger words) is also posted as an embed to the channel on the 'logs.events'
// / 'logs.keyword' ping routes. All user-written text lives inside the embed,
// so nothing in it can ping; the only mention Discord may honour is the roles
// configured on the route. Posting is best-effort — a missing channel or a
// disabled route never blocks the DB write.
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const LOG_COLOURS = { join: 0x57f287, leave: 0xed4245, edit: 0xfee75c, delete: 0xed4245, keyword: 0xeb459e };

async function postServerLog(routeKey, embed) {
  try {
    const roles = pingRoleIds(routeKey);
    await sendPingVia(client, routeKey, {
      embeds: [{ timestamp: new Date().toISOString(), ...embed }],
      allowedMentions: { parse: [], roles },
    });
  } catch (e) { console.error(`[SERVER_LOG] ${routeKey}:`, e.message); }
}

// Stored invite for the server a message came from: the guild's Bot Servers
// entry names its faction, and the faction carries its Discord invite. Empty
// when the guild isn't configured or the faction has no invite on file.
function storedInviteFor(guildId) {
  const row = query(
    `SELECT f.discord_url FROM bot_server_configs bc
       JOIN factions f ON f.id = bc.faction_id
      WHERE bc.guild_id = ? AND f.discord_url <> ''
      ORDER BY f.archived, bc.id LIMIT 1`,
    [guildId]
  )[0];
  return row?.discord_url || '';
}

// Keyword scanning — checks message content against server_log_keywords.
// The alert goes to the logs.keyword route (whose mention_roles decide who is
// paged); nobody is DM'd by hardcoded id. event_type: 'message' | 'edit'
async function checkKeywords(content, message, eventType) {
  if (!content || !message.guild) return;
  const keywords = query("SELECT id, phrase FROM server_log_keywords");
  if (!keywords.length) return;
  const lower = content.toLowerCase();
  let invite;
  for (const kw of keywords) {
    if (!lower.includes(kw.phrase.toLowerCase())) continue;
    if (invite === undefined) invite = storedInviteFor(message.guild.id);
    const guildName   = message.guild?.name || '';
    const channelName = message.channel?.name || message.channel?.id || '';
    const authorId    = message.author?.id || '';
    const authorName  = message.author?.globalName || message.author?.username || '';
    run(
      `INSERT INTO keyword_alerts
         (keyword, message_id, guild_id, guild_name, channel_id, channel_name, author_id, author_name, content, event_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [kw.phrase, message.id, message.guild.id, guildName, message.channel.id, channelName,
       authorId, authorName, content.substring(0, 1000), eventType]
    );
    await postServerLog('logs.keyword', {
      color: LOG_COLOURS.keyword,
      title: `🚨 Trigger word — "${clip(kw.phrase, 100)}"`,
      fields: [
        { name: 'Type',    value: eventType === 'edit' ? 'Edited message' : 'New message', inline: true },
        { name: 'Author',  value: `<@${authorId}> (${clip(authorName, 60)})`, inline: true },
        { name: 'Channel', value: `<#${message.channel.id}> · ${clip(guildName, 60)}`, inline: true },
        { name: 'Content', value: clip(content, 1000) || '[no text]' },
        { name: 'Link',    value: message.url || `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}` },
        { name: 'Server invite', value: invite || 'None stored for this server' },
      ],
    });
  }
}

// Edited message logging
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  try {
    if (!newMessage.guild) return;
    if (oldMessage.content === newMessage.content) return; // embed load, not a real edit
    const combined = ((oldMessage.content || '') + ' ' + (newMessage.content || '')).toLowerCase();
    if (combined.includes('wordle')) return; // ignore wordle spam
    const before   = oldMessage.partial  ? '[not cached]' : (oldMessage.content  || '[no text]');
    const after    = newMessage.partial  ? '[not cached]' : (newMessage.content  || '[no text]');
    const authorId      = newMessage.author?.id || '';
    const authorName    = newMessage.author?.username || '';
    const authorDisplay = newMessage.author?.globalName || newMessage.author?.username || '';
    run(
      `INSERT INTO edited_message_logs
         (message_id, guild_id, guild_name, channel_id, channel_name,
          author_id, author_name, author_display_name, content_before, content_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newMessage.id, newMessage.guild.id, newMessage.guild.name,
       newMessage.channel.id, newMessage.channel.name || newMessage.channel.id,
       authorId, authorName, authorDisplay, before, after]
    );
    if (!newMessage.partial) {
      await checkKeywords(after, newMessage, 'edit');
    }
    console.log(`[EDIT] ${authorName} edited msg ${newMessage.id} in #${newMessage.channel.name} (${newMessage.guild.name})`);
    await postServerLog('logs.events', {
      color: LOG_COLOURS.edit,
      title: '✏️ Message edited',
      fields: [
        { name: 'Author',  value: authorId ? `<@${authorId}> (${clip(authorDisplay, 60)})` : '[unknown]', inline: true },
        { name: 'Channel', value: `<#${newMessage.channel.id}> · ${clip(newMessage.guild.name, 60)}`, inline: true },
        { name: 'Before',  value: clip(before, 1000) },
        { name: 'After',   value: clip(after, 1000) },
        { name: 'Link',    value: newMessage.url },
      ],
    });
  } catch (e) { console.error('[EDIT_LOG]', e.message); }
});

// Deleted message logging — all guilds the bot is in
client.on(Events.MessageDelete, async message => {
  try {
    if (!message.guild) return; // ignore DMs
    const isPartial     = message.partial;
    const content       = isPartial ? '' : (message.content || '[attachment/embed only]');
    const authorId      = isPartial ? '' : (message.author?.id       || '');
    const authorName    = isPartial ? '' : (message.author?.username  || '');
    const authorDisplay = isPartial ? '' : (message.author?.globalName || message.author?.username || '');

    // Check audit log to find who deleted the message.
    // If the author deleted their own message, Discord creates no audit entry.
    let deleterId   = '';
    let deleterName = '';
    try {
      await new Promise(r => setTimeout(r, 800));
      const logs  = await message.guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 });
      const entry = logs.entries.find(e =>
        Date.now() - e.createdTimestamp < 8000 &&
        e.extra?.channel?.id === message.channel.id &&
        (isPartial || e.target?.id === authorId)
      );
      if (entry?.executor) {
        deleterId   = entry.executor.id;
        deleterName = entry.executor.globalName || entry.executor.username || '';
      }
    } catch { /* audit log unavailable in this guild */ }

    run(
      `INSERT INTO deleted_message_logs
         (message_id, guild_id, guild_name, channel_id, channel_name,
          author_id, author_name, author_display_name, content, had_content,
          deleter_id, deleter_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.guild.id,
        message.guild.name,
        message.channel.id,
        message.channel.name || message.channel.id,
        authorId, authorName, authorDisplay,
        content,
        isPartial ? 0 : 1,
        deleterId, deleterName,
      ]
    );
    const who = deleterId ? `deleted by ${deleterName}` : 'self-deleted or unknown';
    console.log(`[DELETE] msg ${message.id} in #${message.channel.name} (${message.guild.name}) — ${isPartial ? 'not cached' : 'content logged'}, ${who}`);
    await postServerLog('logs.events', {
      color: LOG_COLOURS.delete,
      title: '🗑️ Message deleted',
      fields: [
        { name: 'Author',     value: authorId ? `<@${authorId}> (${clip(authorDisplay, 60)})` : '[not cached]', inline: true },
        { name: 'Channel',    value: `<#${message.channel.id}> · ${clip(message.guild.name, 60)}`, inline: true },
        { name: 'Deleted by', value: deleterId ? `<@${deleterId}> (${clip(deleterName, 60)})` : 'Self-deleted or unknown', inline: true },
        { name: 'Content',    value: isPartial ? '[not cached — message predates the bot\'s last restart]' : clip(content, 1000) },
      ],
      footer: { text: `Message ID ${message.id}` },
    });
  } catch (e) { console.error('[DELETE_LOG]', e.message); }
});

// ── Staff sync (FM guild) ─────────────────────────────────────────────────────
// Logic lives in lib/staffSync.js (testable without a client).
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    if (!GUILD_ID || newMember.guild.id !== GUILD_ID) return;
    const addedRoles   = [...newMember.roles.cache.keys()].filter(r => !oldMember.roles.cache.has(r));
    const removedRoles = [...oldMember.roles.cache.keys()].filter(r => !newMember.roles.cache.has(r));
    if (!addedRoles.length && !removedRoles.length) return;
    syncStaffFromRoles(newMember, { addedRoles, removedRoles });
  } catch (e) { console.error('[STAFF_SYNC]', e.message); }
});

// Member join/leave logging — all guilds the bot is in
client.on(Events.GuildMemberAdd, async member => {
  try {
    run(
      `INSERT INTO member_join_leave_logs (guild_id, guild_name, user_id, username, display_name, event)
       VALUES (?, ?, ?, ?, ?, 'join')`,
      [member.guild.id, member.guild.name, member.user.id,
       member.user.username, member.user.globalName || member.user.username]
    );
    console.log(`[JOIN] ${member.user.username} joined ${member.guild.name}`);
    await postServerLog('logs.events', {
      color: LOG_COLOURS.join,
      title: '📥 Member joined',
      fields: [
        { name: 'User',    value: `<@${member.user.id}> (${clip(member.user.username, 60)})`, inline: true },
        { name: 'Server',  value: clip(member.guild.name, 60), inline: true },
        { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      ],
      footer: { text: `User ID ${member.user.id}` },
    });
  } catch (e) { console.error('[JOIN_LOG]', e.message); }
});

client.on(Events.GuildMemberRemove, async member => {
  try {
    run(
      `INSERT INTO member_join_leave_logs (guild_id, guild_name, user_id, username, display_name, event)
       VALUES (?, ?, ?, ?, ?, 'leave')`,
      [member.guild.id, member.guild.name, member.user.id,
       member.user.username, member.user.globalName || member.user.username]
    );
    console.log(`[LEAVE] ${member.user.username} left ${member.guild.name}`);
    // Leaving the FM guild retires the staff row (never deleted).
    if (GUILD_ID && member.guild.id === GUILD_ID) retireStaffOnLeave(member.user.id, member.user.globalName || member.user.username);
    await postServerLog('logs.events', {
      color: LOG_COLOURS.leave,
      title: '📤 Member left',
      fields: [
        { name: 'User',   value: `<@${member.user.id}> (${clip(member.user.username, 60)})`, inline: true },
        { name: 'Server', value: clip(member.guild.name, 60), inline: true },
        { name: 'Joined', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '[unknown]', inline: true },
      ],
      footer: { text: `User ID ${member.user.id}` },
    });
  } catch (e) { console.error('[LEAVE_LOG]', e.message); }
});

client.login(process.env.DISCORD_BOT_TOKEN);
