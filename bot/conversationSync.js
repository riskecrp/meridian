import { query, run, queryOne } from './lib/db.js';

// Team channels get renamed and added/removed with staffing, so the harvest list
// lives in the DB (Admin › Pings › Conversation sync) rather than in this file.
function syncChannels() {
  return query("SELECT channel_id AS id, name FROM conversation_sync_channels WHERE enabled = 1 ORDER BY sort, name");
}

const RETENTION_DAYS = 90;

export async function syncConversations(client) {
  try {
    let totalNew = 0;
    let totalBatches = 0;

    const channels = syncChannels();
    for (const chan of channels) {
      try {
        const channel = await client.channels.fetch(chan.id).catch(e => {
          console.error(`[CONVO_SYNC] Cannot fetch ${chan.name}:`, e.message);
          return null;
        });
        if (!channel) continue;

        // Get last synced message ID for this channel
        const state = queryOne("SELECT last_message_id FROM channel_sync_state WHERE channel_id = ?", [chan.id]);
        const lastId = state?.last_message_id || '';

        const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

        // Helper: fetch messages from a channel or thread, store to DB
        const syncChannelOrThread = async (target, displayName, syncKey) => {
          const targetState = queryOne("SELECT last_message_id FROM channel_sync_state WHERE channel_id = ?", [syncKey]);
          const targetLastId = targetState?.last_message_id || '';

          let fetchOptions = { limit: 100 };
          if (targetLastId) fetchOptions.after = targetLastId;

          let newestId = targetLastId;
          let syncedCount = 0;
          let pagesScanned = 0;
          let keepGoing = true;

          while (keepGoing && pagesScanned < 20) {
            const messages = await target.messages.fetch(fetchOptions).catch(() => null);
            if (!messages || messages.size === 0) break;
            pagesScanned++;
            totalBatches++;

            const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

            for (const msg of sorted) {
              if (msg.createdTimestamp < cutoffDate.getTime()) continue;
              if (!msg.content || msg.content.trim() === '') continue;
              if (msg.author.bot) continue;

              try {
                run(`INSERT OR IGNORE INTO discord_messages (message_id, channel_id, channel_name, author_id, author_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  [msg.id, chan.id, displayName, msg.author.id, msg.author.displayName || msg.author.username, msg.content, new Date(msg.createdTimestamp).toISOString()]);
                syncedCount++;
                totalNew++;
                if (!newestId || BigInt(msg.id) > BigInt(newestId)) newestId = msg.id;
              } catch (e) {}
            }

            if (targetLastId) {
              const newestInBatch = sorted[sorted.length - 1];
              fetchOptions.after = newestInBatch.id;
              if (messages.size < 100) keepGoing = false;
            } else {
              keepGoing = false;
            }
          }

          if (syncedCount > 0 || !targetState) {
            run(`INSERT OR REPLACE INTO channel_sync_state (channel_id, channel_name, last_message_id, last_synced_at) VALUES (?, ?, ?, ?)`,
              [syncKey, displayName, newestId, new Date().toISOString()]);
          }

          return syncedCount;
        };

        // Sync the main channel
        let syncedCount = await syncChannelOrThread(channel, chan.name, chan.id);

        // Sync all threads (active + archived) if the channel supports them
        try {
          const activeThreads = await channel.threads.fetchActive().catch(() => null);
          if (activeThreads?.threads) {
            for (const [, thread] of activeThreads.threads) {
              const tCount = await syncChannelOrThread(thread, `${chan.name} / ${thread.name}`, thread.id);
              syncedCount += tCount;
            }
          }

          const archivedThreads = await channel.threads.fetchArchived({ limit: 50 }).catch(() => null);
          if (archivedThreads?.threads) {
            for (const [, thread] of archivedThreads.threads) {
              // Skip threads archived before our cutoff (nothing new to get)
              if (thread.archiveTimestamp && thread.archiveTimestamp < cutoffDate.getTime()) continue;
              const tCount = await syncChannelOrThread(thread, `${chan.name} / ${thread.name}`, thread.id);
              syncedCount += tCount;
            }
          }
        } catch (e) {
          console.error(`[CONVO_SYNC] Thread fetch failed for ${chan.name}:`, e.message);
        }

        console.log(`[CONVO_SYNC] ${chan.name}: synced ${syncedCount} new messages (channel + threads)`);
      } catch (e) {
        console.error(`[CONVO_SYNC] Error on ${chan.name}:`, e.message);
      }
    }

    // Cleanup: delete messages older than retention window
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const deleted = run("DELETE FROM discord_messages WHERE created_at < ?", [cutoff]);
    if (deleted?.changes > 0) {
      console.log(`[CONVO_SYNC] Pruned ${deleted.changes} old messages`);
    }

    // Clear old summary cache (7+ days old)
    run("DELETE FROM conversation_summaries WHERE created_at < datetime('now', '-7 days')");

    console.log(`[CONVO_SYNC] Complete: ${totalNew} new messages across ${channels.length} channels, ${totalBatches} API calls`);
  } catch (e) {
    console.error('[CONVO_SYNC] Fatal error:', e.message);
  }
}
