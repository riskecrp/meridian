import { queryOne } from './db.js';
import { sendDiscord } from './discord.js';

// Central resolver for every ping Meridian emits.
//
// Destinations used to be split between discord_config, hardcoded channel
// constants and inline snowflakes. They now all live in ping_routes, so a route
// can be retargeted, re-mentioned or muted from the dashboard with no redeploy.
//
// Routes with a confidentiality branch (leadership-scoped tasks and events) keep
// the branch in code — it encodes who is ALLOWED to see the ping — but both
// destinations are configurable. Callers pass { alt: true } to take the branch.

export function getPingRoute(key) {
  return queryOne("SELECT * FROM ping_routes WHERE key = ?", [key]) || null;
}

// Channel a route resolves to, or '' if muted/unset. Use when a caller needs the
// raw channel id (custom fetch, thread creation, a channel the bot reads).
//
// ignoreEnabled: resolve the destination even when the route is muted. For
// callers that PERSIST the channel (a reminder row the bot fires later) — muting
// the announcement shouldn't write an empty channel and orphan the record.
export function pingChannel(key, { alt = false, ignoreEnabled = false } = {}) {
  const route = getPingRoute(key);
  if (!route) return '';
  if (!route.enabled && !ignoreEnabled) return '';
  if (alt && route.alt_channel_id) return route.alt_channel_id;
  return route.channel_id || '';
}

export function pingEnabled(key) {
  const route = getPingRoute(key);
  return !!route && !!route.enabled;
}

// Static @-mentions configured for a route, as a Discord-ready prefix.
// Dynamic mentions (task target, faction lead, requester) stay with the caller.
export function pingMentions(key) {
  const route = getPingRoute(key);
  if (!route || !route.enabled) return '';
  let ids;
  try { ids = JSON.parse(route.mention_roles || '[]'); } catch { return ''; }
  if (!Array.isArray(ids) || !ids.length) return '';
  return ids.map(id => `<@&${id}>`).join(' ');
}

/**
 * Send a ping through its configured route.
 *
 * @param {string} key      ping_routes.key
 * @param {string} content  message body; configured role mentions are prepended
 * @param {object} opts
 *   alt        take the confidentiality branch (alt_channel_id)
 *   embeds     Discord embeds
 *   components Discord components
 * @returns {Promise<boolean>} false when muted, unrouted, or the POST failed
 */
export async function sendPing(key, content, { alt = false, embeds, components } = {}) {
  const route = getPingRoute(key);
  if (!route) {
    console.error(`[ping] unknown route "${key}" — nothing sent`);
    return false;
  }
  if (!route.enabled) return false;

  const channelId = (alt && route.alt_channel_id) ? route.alt_channel_id : route.channel_id;
  if (!channelId) return false;

  const mentions = pingMentions(key);
  const body = mentions ? (content ? `${mentions} ${content}` : mentions) : content;

  return sendDiscord(channelId, body, embeds, components);
}
