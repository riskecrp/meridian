import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Client, Collection, Events, AuditLogEvent, GatewayIntentBits, Options, REST, Routes, Partials } from 'discord.js';
import dotenv from 'dotenv';
import { startScheduler, startChannelPurge, startReminderPurge } from './scheduler.js';
import { syncForumPosts } from './forumSync.js';
import { checkRecurringReminders } from './recurringReminders.js';
import { syncConversations } from './conversationSync.js';
import { startTaskReminder } from './taskReminder.js';
import { startPromotionReview } from './promotionReview.js';
import { handleDM } from './dmHandler.js';

dotenv.config({ path: '/opt/meridian/.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FM_LEADERSHIP_ROLE_ID = '1457670376745074730';
const GUILD_ID_STR          = process.env.GUILD_ID || '1457188814916423855';

// Dynamically load all FM staff discord IDs, refreshed every 5 minutes.
let _cachedStaffIds = null;
let _staffCacheTime = 0;
function getWatchedUserIds(query) {
  const now = Date.now();
  if (!_cachedStaffIds || now - _staffCacheTime > 300000) {
    const rows = query("SELECT discord_id FROM staff WHERE discord_id != '' AND discord_id NOT LIKE 'placeholder%'");
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

// Deploy commands
const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
(async () => {
  try {
    console.log(`[SYSTEM] Refreshing ${commandsToRegister.length} commands.`);
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.GUILD_ID), { body: commandsToRegister });
    console.log(`[SYSTEM] Commands registered.`);
  } catch (error) { console.error(error); }
})();

// Ready
client.once(Events.ClientReady, c => {
  console.log(`[SYSTEM] Ready as ${c.user.tag}`);
  client.user.setPresence({ activities: [{ name: "Meridian Operations", type: 3 }], status: "online" });
  startScheduler(client);
  startTaskReminder(client);
  startPromotionReview(client);
  startChannelPurge(client);
  startReminderPurge(client);
  console.log("[SYSTEM] Scheduler + Task Reminders + Promotion Review + Channel Purge + Reminder Purge started.");
  setTimeout(() => syncForumPosts(client).catch(e => console.error("[FORUM_SYNC]", e.message)), 10000);
  setInterval(() => syncForumPosts(client).catch(e => console.error("[FORUM_SYNC]", e.message)), 3600000);
  console.log("[FORUM_SYNC] Scheduled every hour, first run in 10s");
  setInterval(() => checkRecurringReminders(client).catch(e => console.error("[RECURRING]", e.message)), 60000);
  console.log("[RECURRING] Reminders scheduled — checks every minute, fires at 18:00 UTC on 1st/10th of month");
  setTimeout(() => syncConversations(client).catch(e => console.error("[CONVO_SYNC]", e.message)), 30000);
  setInterval(() => syncConversations(client).catch(e => console.error("[CONVO_SYNC]", e.message)), 3600000);
  console.log("[CONVO_SYNC] Scheduled every hour, first run in 30s");
});

// Interaction handler
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try { await command.execute(interaction); }
    catch (error) {
      console.error('[CMD ERROR]', interaction.commandName, error.message || error);
      try {
        const reply = { content: 'Error executing command: ' + (error.message || 'Unknown error'), ephemeral: true };
        if (!interaction.replied && !interaction.deferred) await interaction.reply(reply);
        else if (interaction.deferred) await interaction.editReply(reply);
        else await interaction.followUp(reply);
      } catch(e2) { console.error('[REPLY ERROR]', e2.message); }
    }
  } else if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) await command.autocomplete(interaction).catch(e => console.error('[AUTOCOMPLETE ERROR]', e.message));
  } else if (interaction.isModalSubmit()) {
    const { customId } = interaction;
    if (customId.startsWith('task_info_modal_')) {
      const questionId = parseInt(customId.replace('task_info_modal_', ''));
      const answer = interaction.fields.getTextInputValue('answer').trim();
      const { queryOne, run } = await import('./lib/db.js');
      const q = queryOne("SELECT * FROM task_questions WHERE id = ?", [questionId]);
      if (!q) { await interaction.reply({ content: '❌ Question not found.', ephemeral: true }); return; }
      if (q.answer) { await interaction.reply({ content: '❌ Already answered.', ephemeral: true }); return; }
      const task = queryOne("SELECT task_uid, target_type, target_id, created_by_id FROM tasks WHERE task_uid = ?", [q.task_uid]);
      if (!task) { await interaction.reply({ content: '❌ Task not found.', ephemeral: true }); return; }
      if (task.created_by_id && task.created_by_id !== interaction.user.id) {
        await interaction.reply({ content: '❌ Only the task creator can answer this.', ephemeral: true }); return;
      }
      const now = new Date().toISOString();
      const actorName = interaction.user.globalName || interaction.user.username;
      run("UPDATE task_questions SET answer = ?, answered_by_id = ?, answered_by_name = ?, answered_at = ? WHERE id = ?",
        [answer, interaction.user.id, actorName, now, questionId]);
      run("INSERT INTO task_log (action, actor, task_uid, description, target, created_at) VALUES ('INFO_ANSWER', ?, ?, '', 'Answered via Discord', ?)",
        [actorName, q.task_uid, now]);
      // Notify the asker
      const token = process.env.DISCORD_BOT_TOKEN;
      const askerStaff = queryOne("SELECT rank FROM staff WHERE discord_id = ?", [q.asked_by_id]);
      const askerIsManagement = (askerStaff?.rank || '').toLowerCase().includes('management');
      const leadershipRoleId = queryOne("SELECT role_id FROM discord_roles WHERE key = 'fm_leadership'")?.role_id || '';
      const routesToLeadership = task.target_type === 'Role' && (task.target_id === leadershipRoleId || task.target_id === '1457189093594239147');
      const chKey = (askerIsManagement && routesToLeadership) ? 'leadership_channel' : 'global_ping_channel';
      const ch = queryOne("SELECT channel_id FROM discord_config WHERE key = ?", [chKey])?.channel_id || '';
      if (ch && token) {
        const replyUrl = 'https://ecrpfm.com/fm/tasks/' + q.task_uid;
        await fetch(`https://discord.com/api/v10/channels/${ch}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `💬 <@${q.asked_by_id}> — **${actorName}** answered your question:\n> ${answer.replace(/\n/g, '\n> ')}\n\n📋 ${replyUrl}`, allowed_mentions: { parse: ['users'] } }),
        }).catch(e => console.error('[TASK_REPLY]', e.message));
      }
      await interaction.reply({ content: '✅ Answer sent!', ephemeral: true });
      return;
    }
    if (customId.startsWith("feedback_modal_")) {
      const { queryOne, run } = await import('./lib/db.js');
      const factionName = customId.replace("feedback_modal_", "");
      const notes = interaction.fields.getTextInputValue('notes');
      const rewards = interaction.fields.getTextInputValue('rewards') || 'None';
      const f = queryOne("SELECT id FROM factions WHERE name = ?", [factionName]);
      if (!f) { await interaction.reply({ content: 'Faction not found.', ephemeral: true }); return; }
      const today = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }).replace(/ /g, '/').toUpperCase();
      const author = interaction.user.globalName || interaction.user.username;
      run("INSERT INTO scene_logs (date, faction_id, rewards, logged_by, notes, author_id) VALUES (?, ?, ?, ?, ?, ?)",
        [today, f.id, rewards, author, notes, interaction.user.id]);
      await interaction.reply({ content: '✅ **Scene Feedback Logged** for **' + factionName + '**\n> ' + notes.substring(0, 200) + (rewards !== 'None' ? '\n**Rewards:** ' + rewards : '') });
    }
  } else if (interaction.isButton()) {
    const { customId } = interaction;
    if (customId === "dismiss") {
      await interaction.update({ content: "✅ **Acknowledged.**", components: [] });
      return;
    }
    if (customId.startsWith('task_info_btn_')) {
      const questionId = customId.replace('task_info_btn_', '');
      const { queryOne } = await import('./lib/db.js');
      const q = queryOne("SELECT id, answer FROM task_questions WHERE id = ?", [parseInt(questionId)]);
      if (!q) { await interaction.reply({ content: '❌ Question not found.', ephemeral: true }); return; }
      if (q.answer) { await interaction.reply({ content: '✅ This question has already been answered.', ephemeral: true }); return; }
      await interaction.showModal({
        title: 'Answer Question',
        customId: `task_info_modal_${questionId}`,
        components: [{ type: 1, components: [{ type: 4, custom_id: 'answer', label: 'Your answer', style: 2, required: true, min_length: 1, max_length: 1000 }] }],
      });
      return;
    }
    if (customId.startsWith("snooze_")) {
      const { query, run } = await import('./lib/db.js');
      const duration = customId.split("_")[1];
      let addMs = duration === "15m" ? 15*60000 : 60*60000;
      const newTime = Date.now() + addMs;
      const uuid = Math.random().toString(36).substring(2, 8);
      const originalEmbed = interaction.message.embeds[0];
      const originalMsg = originalEmbed ? originalEmbed.description : "Snoozed Reminder";
      const initialStatus = addMs <= 30*60000 ? "WARNED" : "ACTIVE";
      try {
        run("INSERT INTO reminders (uuid, author_id, channel_id, message, epoch_ms, readable_time, repeat_rule, target_tag, status) VALUES (?, ?, ?, ?, ?, ?, 'None', ?, ?)",
          [uuid, interaction.user.id, interaction.channelId, `(Snoozed) ${originalMsg}`, newTime.toString(), new Date(newTime).toISOString(), `<@${interaction.user.id}>`, initialStatus]);
        await interaction.update({ content: `💤 **Snoozed for ${duration}.**`, components: [] });
      } catch (err) {
        console.error("[SNOOZE ERROR]", err);
        await interaction.reply({ content: "❌ Failed to snooze.", ephemeral: true });
      }
    }
  }
});

// Mention monitor — capture user pings, FM Leadership role pings, and configured watch role pings
client.on(Events.MessageCreate, async msg => {
  try {
    if (msg.author?.bot) return;
    if (!msg.guild) console.log(`[DM_RAW] from=${msg.author?.id} content="${msg.content?.slice(0,60)}" type=${msg.type} snapshots=${msg.messageSnapshots?.size ?? 0}`);

    // DM handler — runs before guild-specific logic
    if (!msg.guild) {
      await handleDM(msg);
      return;
    }
    const channelName = msg.channel?.name || msg.channel?.id || 'unknown';
    const guildName   = msg.guild?.name || '';
    const content     = msg.content || '[no text content]';
    const createdAt   = msg.createdAt.toISOString();
    const authorName  = msg.author.globalName || msg.author.username;
    const { run, query } = await import('./lib/db.js');

    // Auto-delete channels — delete non-bot messages (with optional delay)
    const autoDelCfg = query("SELECT delay_seconds FROM auto_delete_channels WHERE channel_id = ?", [msg.channelId]);
    if (autoDelCfg.length > 0) {
      const delay = (autoDelCfg[0].delay_seconds || 0) * 1000;
      const doDelete = () => msg.delete().catch(() => {});
      if (delay > 0) setTimeout(doDelete, delay);
      else doDelete();
    }

    // Individual user pings — all FM staff, captured from any guild the bot is in
    const watchedUserIds = getWatchedUserIds(query);
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
    if (msg.guildId === GUILD_ID_STR && msg.mentions?.roles?.has(FM_LEADERSHIP_ROLE_ID)) {
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
      await checkKeywords(content, msg, 'message', run, query);
    }
  } catch (e) {
    console.error('[MENTIONS] Error storing mention:', e.message);
  }
});

const RISK_DISCORD_ID = process.env.RISK_DISCORD_ID || '738214924760907907';

// Keyword scanning — checks message content against server_log_keywords table.
// Fires a DM to risk and logs the alert. event_type: 'message' | 'edit'
async function checkKeywords(content, message, eventType, run, query) {
  if (!content || !message.guild) return;
  const keywords = query("SELECT id, phrase FROM server_log_keywords");
  if (!keywords.length) return;
  const lower = content.toLowerCase();
  for (const kw of keywords) {
    if (!lower.includes(kw.phrase.toLowerCase())) continue;
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
    try {
      const user = await client.users.fetch(RISK_DISCORD_ID);
      const label = eventType === 'edit' ? '✏️ Edited Message' : '💬 New Message';
      await user.send(
        `🚨 **Keyword Alert — "${kw.phrase}"**\n` +
        `**Type:** ${label}\n` +
        `**Server:** ${guildName} · #${channelName}\n` +
        `**Author:** ${authorName} (${authorId})\n` +
        `**Content:** ${content.substring(0, 500)}`
      );
    } catch (e) { console.error('[KW_ALERT] DM failed:', e.message); }
  }
}

// Edited message logging
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  try {
    if (!newMessage.guild) return;
    if (oldMessage.content === newMessage.content) return; // embed load, not a real edit
    const combined = ((oldMessage.content || '') + ' ' + (newMessage.content || '')).toLowerCase();
    if (combined.includes('wordle')) return; // ignore wordle spam
    const { run, query } = await import('./lib/db.js');
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
      await checkKeywords(after, newMessage, 'edit', run, query);
    }
    console.log(`[EDIT] ${authorName} edited msg ${newMessage.id} in #${newMessage.channel.name} (${newMessage.guild.name})`);
  } catch (e) { console.error('[EDIT_LOG]', e.message); }
});

// Deleted message logging — all guilds the bot is in
client.on(Events.MessageDelete, async message => {
  try {
    if (!message.guild) return; // ignore DMs
    const { run } = await import('./lib/db.js');
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
  } catch (e) { console.error('[DELETE_LOG]', e.message); }
});

// Auto-add staff when the main FM role is granted in the FM guild
const MAIN_FM_ROLE    = '1457229857749729363'; // fm_team_guide — base role every FM member holds
const FM_RANK_ROLES   = {
  '1457215385139941456': 'Team Lead',   // fm_team_lead
  '1457670376745074730': 'Management',  // fm_leadership
  '1457189093594239147': 'Management',  // game_affairs
  '1495186160752791562': 'Management',  // founder
  '1457220952541888666': 'Management',  // executive_admin
};

function deriveFMRank(roleIds) {
  let rank = 'Guide';
  for (const r of roleIds) {
    if (FM_RANK_ROLES[r] === 'Management') return 'Management';
    if (FM_RANK_ROLES[r] === 'Team Lead')  rank = 'Team Lead';
  }
  return rank;
}

const RANK_ROLES = new Set(Object.keys(FM_RANK_ROLES)); // Team Lead + Management role IDs

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    if (newMember.guild.id !== GUILD_ID_STR) return;
    const addedRoles  = [...newMember.roles.cache.keys()].filter(r => !oldMember.roles.cache.has(r));
    if (!addedRoles.length) return;

    const { run, queryOne } = await import('./lib/db.js');
    const allRoles    = [...newMember.roles.cache.keys()];
    const displayName = newMember.nickname || newMember.user.globalName || newMember.user.username;

    // ── New staff: base FM role granted ──────────────────────────────────
    if (addedRoles.includes(MAIN_FM_ROLE)) {
      const existing = queryOne("SELECT id FROM staff WHERE discord_id = ?", [newMember.user.id]);
      if (existing) {
        console.log(`[STAFF_SYNC] ${displayName} already in staff`);
      } else {
        const rank      = deriveFMRank(allRoles);
        const clearance = rank === 'Management' ? 3 : rank === 'Team Lead' ? 2 : 1;
        run(
          "INSERT INTO staff (discord_id, display_name, discord_name, rank, team_id, team_name, clearance) VALUES (?, ?, ?, ?, '', '', ?)",
          [newMember.user.id, displayName, newMember.user.username, rank, clearance]
        );
        console.log(`[STAFF_SYNC] Auto-added ${displayName} as ${rank}`);
      }
      return;
    }

    // ── Existing staff: rank role granted — update their rank ─────────────
    const gotRankRole = addedRoles.some(r => RANK_ROLES.has(r));
    if (!gotRankRole) return;

    const existing = queryOne("SELECT id, rank FROM staff WHERE discord_id = ?", [newMember.user.id]);
    if (!existing) return; // not in staff, nothing to update

    const newRank    = deriveFMRank(allRoles);
    const clearance  = newRank === 'Management' ? 3 : newRank === 'Team Lead' ? 2 : 1;
    run(
      "UPDATE staff SET rank=?, clearance=?, updated_at=datetime('now') WHERE discord_id=?",
      [newRank, clearance, newMember.user.id]
    );
    console.log(`[STAFF_SYNC] Updated ${displayName}: ${existing.rank} → ${newRank}`);
  } catch (e) { console.error('[STAFF_SYNC]', e.message); }
});

// Member join/leave logging — all guilds the bot is in
client.on(Events.GuildMemberAdd, async member => {
  try {
    const { run } = await import('./lib/db.js');
    run(
      `INSERT INTO member_join_leave_logs (guild_id, guild_name, user_id, username, display_name, event)
       VALUES (?, ?, ?, ?, ?, 'join')`,
      [member.guild.id, member.guild.name, member.user.id,
       member.user.username, member.user.globalName || member.user.username]
    );
    console.log(`[JOIN] ${member.user.username} joined ${member.guild.name}`);
  } catch (e) { console.error('[JOIN_LOG]', e.message); }
});

client.on(Events.GuildMemberRemove, async member => {
  try {
    const { run } = await import('./lib/db.js');
    run(
      `INSERT INTO member_join_leave_logs (guild_id, guild_name, user_id, username, display_name, event)
       VALUES (?, ?, ?, ?, ?, 'leave')`,
      [member.guild.id, member.guild.name, member.user.id,
       member.user.username, member.user.globalName || member.user.username]
    );
    console.log(`[LEAVE] ${member.user.username} left ${member.guild.name}`);
  } catch (e) { console.error('[LEAVE_LOG]', e.message); }
});

client.login(process.env.DISCORD_BOT_TOKEN);
