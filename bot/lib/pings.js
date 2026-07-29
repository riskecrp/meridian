import { queryOne } from './db.js';

// Bot-side twin of dashboard/src/lib/pings.js — same ping_routes table, same
// semantics. The bot and the dashboard read the same SQLite file, so a change
// made in the dashboard takes effect on the bot's next ping with no restart.

export function getPingRoute(key) {
  return queryOne("SELECT * FROM ping_routes WHERE key = ?", [key]) || null;
}

// Role snowflake by registry key — the bot used to hardcode these inline.
export function getRole(key) {
  return queryOne("SELECT role_id FROM discord_roles WHERE key = ?", [key])?.role_id || '';
}

export function pingChannel(key, { alt = false } = {}) {
  const route = getPingRoute(key);
  if (!route || !route.enabled) return '';
  if (alt && route.alt_channel_id) return route.alt_channel_id;
  return route.channel_id || '';
}

export function pingEnabled(key) {
  const route = getPingRoute(key);
  return !!route && !!route.enabled;
}

// The raw snowflakes behind pingMentions, for callers that need to hand Discord
// an explicit allow-list rather than "any role mention in this message may fire".
// That distinction matters whenever a message carries text somebody outside FM
// wrote: a form answer containing <@&…> would otherwise ping for real.
export function pingRoleIds(key) {
  const route = getPingRoute(key);
  if (!route || !route.enabled) return [];
  try {
    const ids = JSON.parse(route.mention_roles || '[]');
    return Array.isArray(ids) ? ids.filter(Boolean).map(String) : [];
  } catch { return []; }
}

export function pingMentions(key) {
  const route = getPingRoute(key);
  if (!route || !route.enabled) return '';
  let ids;
  try { ids = JSON.parse(route.mention_roles || '[]'); } catch { return ''; }
  if (!Array.isArray(ids) || !ids.length) return '';
  return ids.map(id => `<@&${id}>`).join(' ');
}

// REST send — works without a discord.js channel handle.
export async function sendPing(key, content, { alt = false, embeds, components } = {}) {
  const route = getPingRoute(key);
  if (!route) {
    console.error(`[ping] unknown route "${key}" — nothing sent`);
    return false;
  }
  if (!route.enabled) return false;

  const channelId = (alt && route.alt_channel_id) ? route.alt_channel_id : route.channel_id;
  if (!channelId) return false;

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return false;

  const mentions = pingMentions(key);
  const payload = { allowed_mentions: { parse: ['roles', 'users'] } };
  const body = mentions ? (content ? `${mentions} ${content}` : mentions) : content;
  if (body) payload.content = body;
  if (embeds) payload.embeds = embeds;
  if (components) payload.components = components;

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[ping] ${key} → ${channelId} failed ${res.status}: ${err}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[ping] ${key}:`, e.message);
    return false;
  }
}

// Send via an existing discord.js client (keeps embed builders / components that
// callers already construct).
export async function sendPingVia(client, key, payload, { alt = false } = {}) {
  const channelId = pingChannel(key, { alt });
  if (!channelId) return false;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return false;
    const mentions = pingMentions(key);
    const out = { ...payload };
    if (mentions) out.content = out.content ? `${mentions} ${out.content}` : mentions;
    if (!out.allowedMentions) out.allowedMentions = { parse: ['roles', 'users'] };
    await channel.send(out);
    return true;
  } catch (e) {
    console.error(`[ping] ${key} via client:`, e.message);
    return false;
  }
}
