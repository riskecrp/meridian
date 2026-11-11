import cron from "node-cron";
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { query, run } from './lib/db.js';
import { pingEnabled, sendPing, BASE_URL } from './lib/pings.js';
import { recordSyncOk, recordSyncFail } from './lib/syncStatus.js';
import { healthReport, diffHealth, registerJob, LATE_FACTOR, FAILING_AFTER } from './lib/health.js';
import { sendLeadershipDigest, verifyNudgeTick, reviewVoteNudge } from './lib/digest.js';

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
  startLeadershipJobs(client);
}

// ── Leadership nudges + job health ───────────────────────────────────────────
// Read-only jobs (bot/lib/digest.js): they remind, they never move a request,
// vote or task. Each one is muted from the dashboard through its ping route and
// records sync_status so the health check below (and /api/health) judges it.

const healthState = new Map();   // job → last status alerted; alerts fire on change only

const fmtAge = (m) => m == null ? 'never' : m < 120 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
const alertLine = (a) => {
  const j = a.job;
  if (a.kind === 'recovered') return `✅ **${j.label}** recovered${j.lastOk ? ` (ok ${fmtAge(j.ageMinutes)} ago)` : ''}`;
  if (a.kind === 'failing') return `🔴 **${j.label}** failing — ${j.consecutiveFailures} failure${j.consecutiveFailures === 1 ? '' : 's'} in a row${j.lastError ? `: ${String(j.lastError).slice(0, 160)}` : ''}`;
  return `🟠 **${j.label}** late — no successful run for ${fmtAge(j.ageMinutes)} (expected every ${j.expectedEveryMinutes} min)`;
};

/**
 * One health pass: classify every sync_status row (lib/health.js) and post the
 * CHANGES since the previous pass on route 'ops.health' — a job that turned late
 * or failing, or one that recovered. The in-memory map keeps a broken job from
 * being announced again every half hour. While the route is muted nothing is
 * compared, so the first pass after un-muting reports the current state.
 */
export async function healthAlertTick({ now = Date.now(), state = healthState } = {}) {
  const out = { sent: 0, alerts: [], muted: false };
  try {
    const report = healthReport({ now });
    out.report = report;
    const bad = report.jobs.filter(j => j.status !== 'ok').length;
    if (!pingEnabled('ops.health')) { out.muted = true; recordSyncOk('ops_health', `${bad} unhealthy job(s); route ops.health muted`); return out; }
    const alerts = diffHealth(state, report).filter(a => a.job.job !== 'ops_health');
    out.alerts = alerts;
    if (alerts.length) {
      const content = `🩺 **Job health** — ${alerts.length} change${alerts.length === 1 ? '' : 's'}\n${alerts.map(alertLine).join('\n')}\n${BASE_URL}/v2/admin?tab=audit`;
      const sent = await sendPing('ops.health', content);
      if (!sent) { recordSyncFail('ops_health', `${alerts.length} alert(s) could not be posted`); for (const a of alerts) state.delete(a.job.job); return out; }
      out.sent = alerts.length;
    }
    recordSyncOk('ops_health', `${report.jobs.length} job(s) checked, ${bad} unhealthy, ${alerts.length} alert(s) sent`);
  } catch (e) { console.error('[HEALTH]', e.message); recordSyncFail('ops_health', e); out.error = e.message; }
  return out;
}

export const LEADERSHIP_JOBS = [
  { job: 'leadership_digest', label: 'Weekly leadership digest', cron: '0 9 * * 1', every: 7 * 24 * 60 },
  { job: 'rp_verify_nudge', label: 'Verify-in-game nudge', cron: '5 * * * *', every: 60 },
  { job: 'review_vote_nudge', label: 'Review vote nudge', cron: '0 10 12 * *', every: 31 * 24 * 60 },
  { job: 'ops_health', label: 'Job health alert', cron: '*/30 * * * *', every: 30 },
];

export function startLeadershipJobs(client) {
  for (const j of LEADERSHIP_JOBS) registerJob(j.job, j.label, j.every);
  const guard = (name, fn) => { let busy = false; return async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { console.error(`[${name}]`, e.message); } finally { busy = false; } }; };
  const tz = { timezone: 'UTC' };
  cron.schedule('0 9 * * 1', guard('DIGEST', () => sendLeadershipDigest()), tz);
  cron.schedule('5 * * * *', guard('VERIFY_NUDGE', () => verifyNudgeTick(client)), tz);
  cron.schedule('0 10 12 * *', guard('VOTE_NUDGE', () => reviewVoteNudge(client)), tz);
  cron.schedule('*/30 * * * *', guard('HEALTH', () => healthAlertTick()), tz);
  setTimeout(() => healthAlertTick().catch(e => console.error('[HEALTH] startup:', e.message)), 60000);
  console.log(`[SCHEDULER] Leadership jobs scheduled — digest Mon 09:00 UTC, verify nudge hourly, vote nudge 12th 10:00 UTC, health every 30 min (late > ${LATE_FACTOR}× cadence, failing ≥ ${FAILING_AFTER})`);
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
