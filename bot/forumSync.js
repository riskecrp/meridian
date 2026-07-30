import { query, run } from './lib/db.js';
import { recordSyncOk, recordSyncFail } from './lib/syncStatus.js';
import { pingChannel } from './lib/pings.js';

function extractFactionName(message) {
  const candidates = [];
  if (message.content) candidates.push(message.content);
  if (message.embeds && message.embeds.length > 0) {
    for (const embed of message.embeds) {
      if (embed.title) candidates.push(embed.title);
      if (embed.description) candidates.push(embed.description);
    }
  }
  for (const text of candidates) {
    const m = text.match(/New forum (?:reply|post|thread)[:\s]+(.+?)(?:\s*[\-—\n]|$)/i);
    if (m) return m[1].trim();
  }
  return null;
}

// Normalize a name for comparison: lowercase, remove "the", remove spaces/punctuation
function normalize(name) {
  return name.toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/[^a-z0-9]/gi, '');
}

function matchFaction(extractedName, factions) {
  const target = normalize(extractedName);
  if (!target) return null;

  // 1. Exact normalized match on name
  for (const f of factions) {
    if (normalize(f.name) === target) return f;
  }

  // 2. Alias match
  for (const f of factions) {
    if (!f.aliases) continue;
    const aliasList = f.aliases.split(',').map(a => normalize(a.trim())).filter(Boolean);
    if (aliasList.includes(target)) return f;
  }

  // 3. Substring match (target contains faction name or vice versa, whichever is longer)
  for (const f of factions) {
    const fn = normalize(f.name);
    if (fn.length >= 4 && (target.includes(fn) || fn.includes(target))) return f;
  }

  return null;
}

export async function syncForumPosts(client) {
  try {
    const forumChannelId = pingChannel('forum.sync.source');
    if (!forumChannelId) return;
    const channel = await client.channels.fetch(forumChannelId).catch(e => {
      console.error('[FORUM_SYNC] Cannot fetch channel:', e.message);
      return null;
    });
    if (!channel) return;

    const factions = query("SELECT id, name, aliases FROM factions WHERE archived = 0");
    const counts = {};
    factions.forEach(f => { counts[f.id] = 0; });

    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const unmatched = {};
    let lastId = null;
    let total = 0, matched = 0, fetchedBatches = 0;

    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      const messages = await channel.messages.fetch(options).catch(() => null);
      if (!messages || messages.size === 0) break;
      fetchedBatches++;
      let oldestInBatch = Date.now();

      for (const [, msg] of messages) {
        total++;
        const msgTime = msg.createdTimestamp;
        if (msgTime < oldestInBatch) oldestInBatch = msgTime;
        if (msgTime < cutoff) continue;

        const extracted = extractFactionName(msg);
        if (!extracted) continue;

        const faction = matchFaction(extracted, factions);
        if (faction) {
          counts[faction.id]++;
          matched++;
        } else {
          unmatched[extracted] = (unmatched[extracted] || 0) + 1;
        }
      }

      lastId = messages.last()?.id;
      if (oldestInBatch < cutoff - (24 * 60 * 60 * 1000)) break; // only break if whole batch is well past cutoff
      if (fetchedBatches > 50) break; // safety cap at 5000 messages
    }

    const now = new Date().toISOString();
    for (const f of factions) {
      run("UPDATE factions SET forum_posts_30d = ?, forum_last_synced = ? WHERE id = ?",
        [counts[f.id], now, f.id]);
    }

    console.log(`[FORUM_SYNC] Scanned ${total} messages, matched ${matched}`);
    recordSyncOk('forum_sync', `${total} messages scanned, ${matched} matched to factions`);
    const unmatchedEntries = Object.entries(unmatched).sort((a,b) => b[1] - a[1]);
    if (unmatchedEntries.length > 0) {
      console.log('[FORUM_SYNC] Unmatched names:');
      unmatchedEntries.forEach(([n, c]) => console.log(`  "${n}" (${c}x)`));
    }
  } catch (e) {
    console.error('[FORUM_SYNC] Error:', e.message);
    recordSyncFail('forum_sync', e);
  }
}
