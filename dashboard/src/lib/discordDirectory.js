// Live channel + role directory across EVERY guild the bot is in, so the Pings
// admin shows real names instead of raw snowflakes.
//
// This deliberately spans all guilds, not just the FM one: several routes post
// into other servers (the storytelling log, the documents channel and the FM
// hours report all live outside [ECRP] Game Affairs), and a main-guild-only
// directory would make those destinations impossible to re-point.
//
// ~22 guilds × 2 calls, cached in-process for 5 minutes and only ever read by an
// L3 admin screen.

const HOME_GUILD_ID = process.env.GUILD_ID || '1457188814916423855';
const TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 6;

const TEXTLIKE = new Set([0, 5, 15]); // text, announcement, forum
const CATEGORY = 4;

let cache = { at: 0, channels: [], roles: [] };

async function discordGet(path) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set');
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Discord GET ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

// Run tasks with a small concurrency cap so a 22-guild sweep doesn't burst
// straight into Discord's rate limiter.
async function pooled(items, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]).catch(() => null);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Resolve destinations the guild sweep can't enumerate — archived threads and
 * private channels — and report the ones Discord no longer knows about at all.
 *
 * The sweep lists active threads only, so a route posting into an archived
 * thread (posting silently unarchives it) would otherwise look deleted. Looking
 * each unknown id up individually is cheap and tells the two cases apart.
 *
 * @returns {Promise<{extra: Array, dead: string[]}>}
 */
export async function resolveChannelIds(ids) {
  const extra = [];
  const dead = [];
  await pooled([...new Set(ids.filter(Boolean))], async (id) => {
    try {
      const c = await discordGet(`/channels/${id}`);
      let guildName = '';
      if (c.guild_id) {
        guildName = await discordGet(`/guilds/${c.guild_id}`).then(g => g.name).catch(() => '');
      }
      const isThread = [10, 11, 12].includes(c.type);
      extra.push({
        id: c.id,
        name: isThread ? `${c.name} (archived/hidden thread)` : c.name,
        guildId: c.guild_id || '',
        guildName: guildName || 'Unknown server',
        category: isThread ? 'Threads' : 'Not listed',
        position: 9500,
        isThread,
      });
    } catch (e) {
      // 404 = the channel is gone; anything else we can't confirm, so don't
      // accuse a working destination of being dead.
      if (/→ 404/.test(e.message)) dead.push(id);
    }
  });
  return { extra, dead };
}

/**
 * @returns {Promise<{channels: Array, roles: Array, error?: string}>}
 *   channels: { id, name, guildId, guildName, category, position }
 *   roles:    { id, name, guildId, guildName, color }
 */
export async function getDiscordDirectory({ force = false } = {}) {
  if (!force && cache.at && Date.now() - cache.at < TTL_MS) {
    return { channels: cache.channels, roles: cache.roles };
  }

  try {
    const guilds = await discordGet('/users/@me/guilds');

    // Home guild first so its channels head the pickers.
    guilds.sort((a, b) =>
      (b.id === HOME_GUILD_ID) - (a.id === HOME_GUILD_ID) || a.name.localeCompare(b.name)
    );

    const results = await pooled(guilds, async (g) => {
      // Active threads are included because real routes post into them — the
      // storytelling Change Log is a thread, not a channel.
      const [chans, roles, active] = await Promise.all([
        discordGet(`/guilds/${g.id}/channels`),
        discordGet(`/guilds/${g.id}/roles`),
        discordGet(`/guilds/${g.id}/threads/active`).catch(() => ({ threads: [] })),
      ]);
      return { guild: g, chans, roles, threads: active?.threads || [] };
    });

    const channels = [];
    const roles = [];

    for (const r of results) {
      if (!r) continue; // a guild we lost access to shouldn't break the whole page
      const { guild, chans, roles: gRoles, threads } = r;

      const categories = new Map(
        (chans || []).filter(c => c.type === CATEGORY).map(c => [c.id, c.name])
      );
      const channelNames = new Map((chans || []).map(c => [c.id, c.name]));

      for (const c of chans || []) {
        if (!TEXTLIKE.has(c.type)) continue;
        channels.push({
          id: c.id,
          name: c.name,
          guildId: guild.id,
          guildName: guild.name,
          category: c.parent_id ? (categories.get(c.parent_id) || '') : '',
          position: c.position ?? 0,
        });
      }

      for (const t of threads || []) {
        const parent = channelNames.get(t.parent_id) || '';
        channels.push({
          id: t.id,
          name: parent ? `${t.name} (thread in #${parent})` : `${t.name} (thread)`,
          guildId: guild.id,
          guildName: guild.name,
          category: 'Threads',
          position: 9000,
          isThread: true,
        });
      }
      for (const role of gRoles || []) {
        if (role.name === '@everyone' || role.managed) continue;
        roles.push({ id: role.id, name: role.name, guildId: guild.id, guildName: guild.name, color: role.color });
      }
    }

    if (!channels.length) throw new Error('no channels returned');

    cache = { at: Date.now(), channels, roles };
    return { channels, roles };
  } catch (e) {
    // Serve stale over nothing — a picker with old names beats a broken page.
    if (cache.at) return { channels: cache.channels, roles: cache.roles, error: e.message };
    return { channels: [], roles: [], error: e.message };
  }
}
