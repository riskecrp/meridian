import cron from "node-cron";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { query, run } from './lib/db.js';
import { pingEnabled } from './lib/pings.js';
import { recordSyncOk, recordSyncFail } from './lib/syncStatus.js';

// A reminder that could not be delivered is NOT deleted (BOT-15): a transient
// failure is retried on the next tick for up to RETRY_WINDOW_MS after its time,
// then the row is parked as FAILED where the dashboard can show it; an
// unreachable channel parks it straight away. A muted route holds the row
// (status unchanged) until the route is enabled again.
const RETRY_WINDOW_MS = 24 * 3600000;
const WARNING_WINDOW_MS = 30 * 60000;

const createdMs = (row) => { const d = row.created_at ? new Date(String(row.created_at).replace(' ', 'T') + (String(row.created_at).endsWith('Z') ? '' : 'Z')) : null; return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0; };

/** One scheduler pass. Exported for tests; the cron below calls it every minute. */
export async function reminderTick(client, now = Date.now()) {
  const rows = query("SELECT * FROM reminders WHERE status IN ('ACTIVE','WARNED') ORDER BY epoch_ms");
  const summary = { fired: 0, warned: 0, failed: 0, held: 0, errors: [] };
  for (const row of rows) {
    if (!row.epoch_ms) continue;
    const triggerTime = parseInt(row.epoch_ms, 10);
    if (!Number.isFinite(triggerTime)) continue;
    const diffMs = triggerTime - now;

    // 30-minute warning — skipped when the reminder was created inside the
    // window (a "10m" reminder does not need a 30-minute heads-up).
    if (diffMs <= WARNING_WINDOW_MS && diffMs > 0 && row.status === "ACTIVE") {
      if (!pingEnabled('reminder.warning')) continue;
      if (triggerTime - createdMs(row) <= WARNING_WINDOW_MS) { run("UPDATE reminders SET status = 'WARNED' WHERE id = ?", [row.id]); continue; }
      try {
        const channel = await client.channels.fetch(row.channel_id).catch((e) => { console.error(`[SCHEDULER] Cannot fetch channel ${row.channel_id}:`, e.message); return null; });
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle("⚠️ 30 Minute Warning")
            .setDescription(`${row.message}\n\n**Starting:** <t:${Math.floor(triggerTime / 1000)}:R>`)
            .setColor(0xFFA500);
          await channel.send({ content: row.target_tag, embeds: [embed] });
          run("UPDATE reminders SET status = 'WARNED' WHERE id = ?", [row.id]);
          summary.warned++;
        }
      } catch (e) { console.error("[SCHEDULER WARN]:", e.message); summary.errors.push(`warn ${row.uuid}: ${e.message}`); }
      continue;
    }

    // Final trigger — fires when time has passed
    if (now >= triggerTime) {
      if (!pingEnabled('reminder.due')) { summary.held++; continue; }
      let sent = false, permanent = false, err = '';
      try {
        const channel = await client.channels.fetch(row.channel_id).catch((e) => { err = `cannot fetch channel ${row.channel_id}: ${e.message}`; return null; });
        if (!channel) permanent = true;
        else {
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
          sent = true;
        }
      } catch (e) { err = e.message; }

      if (sent) {
        summary.fired++;
        const repeatMs = getRepeatMs(row.repeat_rule);
        if (repeatMs > 0) {
          const nextTime = now + repeatMs;
          run("UPDATE reminders SET epoch_ms = ?, readable_time = ?, status = 'ACTIVE' WHERE id = ?",
            [nextTime.toString(), new Date(nextTime).toISOString(), row.id]);
        } else {
          run("DELETE FROM reminders WHERE id = ?", [row.id]);
        }
        continue;
      }
      // Not delivered: keep the row. Park it when the channel is gone or the
      // retry window has passed; otherwise it is tried again next minute.
      console.error(`[SCHEDULER FIRE] ${row.uuid}: ${err || 'send failed'}`);
      summary.errors.push(`${row.uuid}: ${err || 'send failed'}`);
      if (permanent || now - triggerTime > RETRY_WINDOW_MS) {
        run("UPDATE reminders SET status = 'FAILED' WHERE id = ?", [row.id]);
        summary.failed++;
      }
    }
  }
  if (summary.errors.length) recordSyncFail('reminders', summary.errors.slice(0, 3).join(' | '));
  else recordSyncOk('reminders', `${rows.length} live; fired ${summary.fired}, warned ${summary.warned}${summary.held ? `, held ${summary.held} (reminder.due muted)` : ''}`);
  return summary;
}

export function startScheduler(client) {
  console.log("[SCHEDULER] Started — checking every minute");
  let running = false;
  cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try { await reminderTick(client); }
    catch (e) { console.error("[SCHEDULER ERROR]:", e.message); recordSyncFail('reminders', e); }
    finally { running = false; }
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

// ── Housekeeping ───────────────────────────────────────────────────────────────
// Expired dashboard sessions are pruned here (F9). The dashboard also prunes on
// login, but a quiet week left thousands of dead rows behind.
export function pruneExpiredSessions() {
  // expires_at is ISO ("…T…Z") while datetime('now') has a space; normalise
  // before comparing or a same-day ISO value sorts after "now".
  const r = run("DELETE FROM sessions WHERE replace(replace(expires_at, 'T', ' '), 'Z', '') < datetime('now')");
  return r.changes;
}

export function startHousekeeping() {
  const tick = () => {
    try {
      const n = pruneExpiredSessions();
      recordSyncOk('housekeeping', `${n} expired session(s) pruned`);
    } catch (e) { console.error('[HOUSEKEEPING]', e.message); recordSyncFail('housekeeping', e); }
  };
  setTimeout(tick, 20000);
  cron.schedule('15 * * * *', tick);
  console.log('[HOUSEKEEPING] Session prune scheduled hourly at :15');
}

// ── Scheduled channel purge ────────────────────────────────────────────────
// Runs every hour, purges channels whose interval has elapsed since last_purged_at.
export async function startChannelPurge(client) {
  let running = false;
  const doPurge = async (force = false) => {
    if (running) { console.warn('[PURGE] previous run still in progress — skipped'); return; }
    running = true;
    const errors = [];
    let purged = 0;
    try {
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
            errors.push(`cannot fetch ${s.channel_id}`);
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
                for (const msg of fresh.values()) {
                  const ok = await msg.delete().then(() => true).catch(e => {
                    console.warn(`[PURGE] individual delete failed for ${msg.id}: ${e.message}`);
                    return false;
                  });
                  if (ok) totalDeleted += 1;
                }
              }
            } else if (fresh.size === 1) {
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

            if (fetched.size < 100) break;
            await new Promise(r => setTimeout(r, 1000));
          }

          run("UPDATE channel_purge_schedules SET last_purged_at = datetime('now') WHERE channel_id = ?", [s.channel_id]);
          purged++;
          console.log(`[PURGE] #${channel.name} (${s.channel_id}) — ${totalDeleted} messages deleted`);
        } catch (e) {
          console.error(`[PURGE] Error purging ${s.channel_id}:`, e.message);
          errors.push(`${s.channel_id}: ${e.message}`);
        }
      }
      if (errors.length) recordSyncFail('channel_purge', errors.slice(0, 3).join(' | '));
      else recordSyncOk('channel_purge', `${purged} of ${schedules.length} channel(s) purged${force ? ' (startup run)' : ''}`);
    } finally { running = false; }
  };

  // Startup run: always force-purge regardless of interval, in case messages
  // accumulated while the bot was down. Hourly cron respects the interval.
  setTimeout(() => doPurge(true).catch(e => { console.error('[PURGE] startup run error:', e.message); recordSyncFail('channel_purge', e); }), 15000);
  cron.schedule('0 * * * *', () => doPurge().catch(e => { console.error('[PURGE] hourly run error:', e.message); recordSyncFail('channel_purge', e); }));
  console.log('[PURGE] Scheduled channel purge started — checks every hour');
}

// ── Reminder message purge ─────────────────────────────────────────────────────
// Hourly sweep of channels in reminder_purge_channels.
// - Human user messages: deleted unconditionally.
// - Bot messages matching reminder patterns: deleted only if the event timestamp has passed.
export async function startReminderPurge(client) {
  let running = false;
  const doReminderPurge = async () => {
    if (running) { console.warn('[REMINDER_PURGE] previous run still in progress — skipped'); return; }
    running = true;
    const errors = [];
    let total = 0;
    try {
      const channels = query("SELECT channel_id FROM reminder_purge_channels");
      if (channels.length === 0) { recordSyncOk('reminder_purge', 'no channels configured'); return; }
      const now = Date.now();
      const botId = client.user.id;

      for (const { channel_id } of channels) {
        try {
          const channel = await client.channels.fetch(channel_id).catch(() => null);
          if (!channel?.isTextBased()) {
            console.warn(`[REMINDER_PURGE] Cannot fetch channel ${channel_id}`);
            errors.push(`cannot fetch ${channel_id}`);
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
                shouldDelete = true;
              } else if (msg.author.id === botId) {
                const embed = msg.embeds?.[0];
                const content = msg.content || '';

                if (embed) {
                  const title = embed.title || '';
                  const desc  = embed.description || '';
                  const tsMatch = desc.match(/<t:(\d+):/);

                  if (title === '📌 Due Now') {
                    shouldDelete = true;
                  } else if (tsMatch && (title.startsWith('📌') || title.startsWith('⏰') || title.startsWith('⚠️'))) {
                    shouldDelete = parseInt(tsMatch[1]) * 1000 <= now;
                  }
                } else {
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

          total += totalDeleted;
          console.log(`[REMINDER_PURGE] #${channel.name} (${channel_id}) — ${totalDeleted} messages deleted`);
        } catch (e) {
          console.error(`[REMINDER_PURGE] Error for ${channel_id}:`, e.message);
          errors.push(`${channel_id}: ${e.message}`);
        }
      }
      if (errors.length) recordSyncFail('reminder_purge', errors.slice(0, 3).join(' | '));
      else recordSyncOk('reminder_purge', `${total} message(s) deleted across ${channels.length} channel(s)`);
    } finally { running = false; }
  };

  // Startup run + hourly cron (offset by 30 min from the channel purge)
  setTimeout(() => doReminderPurge().catch(e => { console.error('[REMINDER_PURGE] startup error:', e.message); recordSyncFail('reminder_purge', e); }), 25000);
  cron.schedule('30 * * * *', () => doReminderPurge().catch(e => { console.error('[REMINDER_PURGE] hourly error:', e.message); recordSyncFail('reminder_purge', e); }));
  console.log('[REMINDER_PURGE] Scheduled — checks every hour at :30');
}
