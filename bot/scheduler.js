import { checkRecurringReminders } from './recurringReminders.js';
import cron from "node-cron";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { query, run } from './lib/db.js';
import { pingEnabled } from './lib/pings.js';

export function startScheduler(client) {
  console.log("[SCHEDULER] Started — checking every minute");
  cron.schedule("* * * * *", async () => {
    try {
      const rows = query("SELECT * FROM reminders WHERE status IN ('ACTIVE','WARNED') ORDER BY epoch_ms");
      if (rows.length === 0) return;
      const now = Date.now();

      for (const row of rows) {
        if (!row.epoch_ms) continue;
        const triggerTime = parseInt(row.epoch_ms);
        const diffMinutes = (triggerTime - now) / 1000 / 60;

        // 30-minute warning
        if (diffMinutes <= 30 && diffMinutes > 0 && row.status === "ACTIVE" && pingEnabled('reminder.warning')) {
          console.log(`[SCHEDULER] 30min warning for: ${row.uuid} in channel ${row.channel_id}`);
          try {
            const channel = await client.channels.fetch(row.channel_id).catch((e) => { console.error(`[SCHEDULER] Cannot fetch channel ${row.channel_id}:`, e.message); return null; });
            if (channel) {
              const embed = new EmbedBuilder()
                .setTitle("⚠️ 30 Minute Warning")
                .setDescription(`${row.message}\n\n**Starting:** <t:${Math.floor(triggerTime/1000)}:R>`)
                .setColor(0xFFA500);
              await channel.send({ content: row.target_tag, embeds: [embed] });
              run("UPDATE reminders SET status = 'WARNED' WHERE id = ?", [row.id]);
              console.log(`[SCHEDULER] Warning sent for ${row.uuid}`);
            }
          } catch (e) { console.error("[SCHEDULER WARN]:", e.message); }
        }

        // Final trigger — fires when time has passed
        if (now >= triggerTime) {
          console.log(`[SCHEDULER] Firing: ${row.uuid} in channel ${row.channel_id}`);
          try {
            const channel = pingEnabled('reminder.due')
              ? await client.channels.fetch(row.channel_id).catch((e) => { console.error(`[SCHEDULER] Cannot fetch channel ${row.channel_id}:`, e.message); return null; })
              : null;
            if (channel) {
              const embed = new EmbedBuilder()
                .setTitle("📌 Due Now")
                .setDescription(row.message)
                .setColor(0x00FF00)
                .setFooter({ text: `ID: ${row.uuid}` });
              const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("snooze_15m").setLabel("💤 15m").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("snooze_1h").setLabel("💤 1h").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("dismiss").setLabel("✅ Done").setStyle(ButtonStyle.Success)
              );
              await channel.send({ content: row.target_tag, embeds: [embed], components: [buttons] });
              console.log(`[SCHEDULER] Fired ${row.uuid}`);
            }
          } catch (err) { console.error("[SCHEDULER FIRE]:", err.message); }

          // Handle repeat vs delete
          const repeatMs = getRepeatMs(row.repeat_rule);
          if (repeatMs > 0) {
            const nextTime = now + repeatMs;
            run("UPDATE reminders SET epoch_ms = ?, readable_time = ?, status = 'ACTIVE' WHERE id = ?",
              [nextTime.toString(), new Date(nextTime).toISOString(), row.id]);
          } else {
            run("DELETE FROM reminders WHERE id = ?", [row.id]);
          }
        }
      }
    } catch (e) { console.error("[SCHEDULER ERROR]:", e.message); }
  });
}

function getRepeatMs(str) {
  if (!str || str.toLowerCase() === "none") return 0;
  const match = str.match(/^(\d+)(M|H|D)$/i);
  if (!match) return 0;
  const val = parseInt(match[1]);
  const mult = { M: 60000, H: 3600000, D: 86400000 };
  return val * (mult[match[2].toUpperCase()] || 0);
}

// ── Scheduled channel purge ────────────────────────────────────────────────
// Runs every hour, purges channels whose interval has elapsed since last_purged_at.
export async function startChannelPurge(client) {
  const { query, run } = await import('./lib/db.js');

  const doPurge = async (force = false) => {
    const schedules = query("SELECT * FROM channel_purge_schedules");
    const now = Date.now();

    for (const s of schedules) {
      const intervalMs = s.interval_hours * 3600000;
      const lastMs = s.last_purged_at ? new Date(s.last_purged_at).getTime() : 0;
      if (!force && now - lastMs < intervalMs) continue;

      try {
        const channel = await client.channels.fetch(s.channel_id).catch(() => null);
        if (!channel?.isTextBased()) {
          console.warn(`[PURGE] Cannot fetch channel ${s.channel_id}`);
          continue;
        }

        // Update channel name if we now know it
        if (channel.name && channel.name !== s.channel_name) {
          run("UPDATE channel_purge_schedules SET channel_name = ? WHERE channel_id = ?", [channel.name, s.channel_id]);
        }

        let totalDeleted = 0;

        // Bulk delete in batches of 100 until the channel is empty.
        // Discord bulkDelete only works for messages < 14 days old.
        // For older messages we fall back to individual deletes.
        while (true) {
          const fetched = await channel.messages.fetch({ limit: 100 });
          if (fetched.size === 0) break;

          const cutoff = Date.now() - 14 * 24 * 3600000;
          const fresh = fetched.filter(m => m.createdTimestamp > cutoff);
          const stale = fetched.filter(m => m.createdTimestamp <= cutoff);

          if (fresh.size > 1) {
            const bulkResult = await channel.bulkDelete(fresh, true).catch(e => {
              console.warn(`[PURGE] bulkDelete failed (${e.message}), falling back to individual deletes`);
              return null;
            });
            if (bulkResult) {
              totalDeleted += bulkResult.size;
            } else {
              // bulkDelete failed — delete individually
              for (const msg of fresh.values()) {
                const ok = await msg.delete().then(() => true).catch(e => {
                  console.warn(`[PURGE] individual delete failed for ${msg.id}: ${e.message}`);
                  return false;
                });
                if (ok) totalDeleted += 1;
              }
            }
          } else if (fresh.size === 1) {
            // bulkDelete requires at least 2; delete the single message individually
            const ok = await fresh.first().delete().then(() => true).catch(e => {
              console.warn(`[PURGE] individual delete failed for ${fresh.first().id}: ${e.message}`);
              return false;
            });
            if (ok) totalDeleted += 1;
          }

          for (const msg of stale.values()) {
            const ok = await msg.delete().then(() => true).catch(e => {
              console.warn(`[PURGE] stale delete failed for ${msg.id}: ${e.message}`);
              return false;
            });
            if (ok) totalDeleted += 1;
          }

          // If we got fewer than 100 back, the channel is now empty
          if (fetched.size < 100) break;

          // Small pause between batches to avoid rate limits
          await new Promise(r => setTimeout(r, 1000));
        }

        run("UPDATE channel_purge_schedules SET last_purged_at = datetime('now') WHERE channel_id = ?", [s.channel_id]);
        console.log(`[PURGE] #${channel.name} (${s.channel_id}) — ${totalDeleted} messages deleted`);
      } catch (e) {
        console.error(`[PURGE] Error purging ${s.channel_id}:`, e.message);
      }
    }
  };

  // Startup run: always force-purge regardless of interval, in case messages
  // accumulated while the bot was down. Hourly cron respects the interval.
  setTimeout(() => doPurge(true).catch(e => console.error('[PURGE] startup run error:', e.message)), 15000);
  cron.schedule('0 * * * *', () => doPurge().catch(e => console.error('[PURGE] hourly run error:', e.message)));
  console.log('[PURGE] Scheduled channel purge started — checks every hour');
}

// ── Reminder message purge ─────────────────────────────────────────────────────
// Hourly sweep of channels in reminder_purge_channels.
// - Human user messages: deleted unconditionally.
// - Bot messages matching reminder patterns: deleted only if the event timestamp has passed.
export async function startReminderPurge(client) {
  const { query } = await import('./lib/db.js');

  const doReminderPurge = async () => {
    const channels = query("SELECT channel_id FROM reminder_purge_channels");
    if (channels.length === 0) return;
    const now = Date.now();
    const botId = client.user.id;

    for (const { channel_id } of channels) {
      try {
        const channel = await client.channels.fetch(channel_id).catch(() => null);
        if (!channel?.isTextBased()) {
          console.warn(`[REMINDER_PURGE] Cannot fetch channel ${channel_id}`);
          continue;
        }

        let totalDeleted = 0;
        let lastId = null;

        while (true) {
          const options = { limit: 100 };
          if (lastId) options.before = lastId;

          const fetched = await channel.messages.fetch(options);
          if (fetched.size === 0) break;

          for (const msg of fetched.values()) {
            let shouldDelete = false;

            if (!msg.author.bot) {
              // Human user message — always delete
              shouldDelete = true;
            } else if (msg.author.id === botId) {
              // Our bot's message — apply pattern logic
              const embed = msg.embeds?.[0];
              const content = msg.content || '';

              if (embed) {
                const title = embed.title || '';
                const desc  = embed.description || '';
                const tsMatch = desc.match(/<t:(\d+):/);

                if (title === '📌 Due Now') {
                  // Already fired — always stale
                  shouldDelete = true;
                } else if (tsMatch && (title.startsWith('📌') || title.startsWith('⏰') || title.startsWith('⚠️'))) {
                  // Scheduled/warning/confirmation — only if event time has passed
                  shouldDelete = parseInt(tsMatch[1]) * 1000 <= now;
                }
              } else {
                // No embed — post-interaction leftovers
                if (content === '✅ **Acknowledged.**' || content.startsWith('💤 **Snoozed')) {
                  shouldDelete = true;
                }
              }
            }
            // Messages from other bots are left alone

            if (shouldDelete) {
              const ok = await msg.delete().then(() => true).catch(e => {
                console.warn(`[REMINDER_PURGE] Delete failed for ${msg.id}: ${e.message}`);
                return false;
              });
              if (ok) totalDeleted++;
            }
          }

          lastId = fetched.last()?.id;
          if (fetched.size < 100) break;
          await new Promise(r => setTimeout(r, 1000));
        }

        console.log(`[REMINDER_PURGE] #${channel.name} (${channel_id}) — ${totalDeleted} messages deleted`);
      } catch (e) {
        console.error(`[REMINDER_PURGE] Error for ${channel_id}:`, e.message);
      }
    }
  };

  // Startup run + hourly cron (offset by 30 min from the channel purge)
  setTimeout(() => doReminderPurge().catch(e => console.error('[REMINDER_PURGE] startup error:', e.message)), 25000);
  cron.schedule('30 * * * *', () => doReminderPurge().catch(e => console.error('[REMINDER_PURGE] hourly error:', e.message)));
  console.log('[REMINDER_PURGE] Scheduled — checks every hour at :30');
}
