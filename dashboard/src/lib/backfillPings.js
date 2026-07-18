import { query, run } from './db.js';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

async function discordApi(path) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
    cache: 'no-store',
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    await new Promise(r => setTimeout(r, ((body.retry_after || 1) * 1000) + 250));
    return discordApi(path);
  }
  if (!res.ok) return null;
  return res.json();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchLast150(channelId) {
  const first = await discordApi(`/channels/${channelId}/messages?limit=100`);
  if (!Array.isArray(first) || first.length === 0) return [];
  if (first.length < 100) return first;
  const lastId = first[first.length - 1].id;
  await sleep(300);
  const second = await discordApi(`/channels/${channelId}/messages?limit=50&before=${lastId}`);
  return first.concat(Array.isArray(second) ? second : []);
}

// Scan all text channels of a single guild for watch role pings.
// configId — the bot_server_configs.id for this guild
// watchRoles — array of { role_id, role_name }
// If watchRoles is empty, derives them from the DB.
export async function backfillGuildPings(guildId, guildName, configId, watchRoles) {
  if (!BOT_TOKEN) { console.error('[BACKFILL] No bot token'); return; }

  const roles = watchRoles?.length
    ? watchRoles
    : query("SELECT role_id, role_name FROM bot_watch_roles WHERE config_id = ?", [configId]);

  if (!roles.length) { console.log(`[BACKFILL] No watch roles for config ${configId}`); return; }

  console.log(`[BACKFILL] Starting guild ${guildName} (${guildId}), ${roles.length} role(s)`);
  const channels = await discordApi(`/guilds/${guildId}/channels`);
  if (!Array.isArray(channels)) { console.error('[BACKFILL] Could not fetch channels'); return; }

  const textChannels = channels.filter(c => c.type === 0 || c.type === 5);
  let inserted = 0;

  for (const ch of textChannels) {
    const messages = await fetchLast150(ch.id);
    for (const msg of messages) {
      if (!msg || msg.author?.bot) continue;
      const mentionedRoles = new Set((msg.mention_roles || []).map(String));
      for (const wr of roles) {
        if (mentionedRoles.has(wr.role_id)) {
          try {
            const result = run(
              `INSERT OR IGNORE INTO watch_role_mentions
                 (message_id, config_id, watch_role_id, watch_role_name, channel_id, channel_name,
                  author_id, author_name, content, guild_id, guild_name, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
              [msg.id, configId, wr.role_id, wr.role_name, ch.id, ch.name || '',
               msg.author?.id || '', msg.author?.global_name || msg.author?.username || '',
               msg.content || '', guildId, guildName, msg.timestamp]
            );
            if (result.changes > 0) inserted++;
          } catch {}
        }
      }
    }
    await sleep(350);
  }

  console.log(`[BACKFILL] Done ${guildName}: ${inserted} new pings from ${textChannels.length} channels`);
}
