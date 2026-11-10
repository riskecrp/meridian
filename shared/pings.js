// Central resolver for every Discord notification ("ping") Meridian emits,
// shared by the dashboard and the bot. Destinations live in ping_routes so a
// route can be retargeted, re-mentioned or muted from the dashboard with no
// redeploy; both halves read the same SQLite file so a change takes effect on
// the next ping.
//
// Routes with a confidentiality branch (leadership-scoped tasks and events)
// keep the branch in code — it encodes who is ALLOWED to see the ping — but both
// destinations are configurable. Callers pass { alt: true } to take the branch.
import { queryOne } from './db.js';

export const BASE_URL = (process.env.BASE_URL || 'https://ecrpfm.com').replace(/\/$/, '');

export function getPingRoute(key) {
  return queryOne("SELECT * FROM ping_routes WHERE key = ?", [key]) || null;
}

export function getRole(key) {
  return queryOne("SELECT role_id FROM discord_roles WHERE key = ?", [key])?.role_id || '';
}

export function getChannel(key) {
  return queryOne("SELECT channel_id FROM discord_config WHERE key = ?", [key])?.channel_id || '';
}

// Channel a route resolves to, or '' if muted/unset.
// ignoreEnabled: resolve the destination even when the route is muted, for
// callers that PERSIST the channel (a reminder row the bot fires later).
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

// The raw snowflakes behind pingMentions, for callers that hand Discord an
// explicit allow-list rather than "any role mention in this message may fire".
export function pingRoleIds(key) {
  const route = getPingRoute(key);
  if (!route || !route.enabled) return [];
  try {
    const ids = JSON.parse(route.mention_roles || '[]');
    return Array.isArray(ids) ? ids.filter(Boolean).map(String) : [];
  } catch { return []; }
}

export function pingMentions(key) {
  return pingRoleIds(key).map(id => `<@&${id}>`).join(' ');
}

/** Low-level REST post to a channel. Returns true on success, false otherwise; never throws. */
export async function sendDiscord(channelId, content, embeds, components, { allowedMentions } = {}) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return false;
  try {
    const body = { allowed_mentions: allowedMentions || { parse: ['roles', 'users'] } };
    if (content) body.content = content;
    if (embeds) body.embeds = embeds;
    if (components) body.components = components;
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[Discord] POST to ${channelId} failed ${res.status}: ${err}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[Discord]', e.message);
    return false;
  }
}

/**
 * Send a ping through its configured route (REST; works in both processes).
 * @returns {Promise<boolean>} false when muted, unrouted, or the POST failed
 */
export async function sendPing(key, content, { alt = false, embeds, components, allowedMentions } = {}) {
  const route = getPingRoute(key);
  if (!route) { console.error(`[ping] unknown route "${key}" — nothing sent`); return false; }
  if (!route.enabled) return false;
  const channelId = (alt && route.alt_channel_id) ? route.alt_channel_id : route.channel_id;
  if (!channelId) return false;
  const mentions = pingMentions(key);
  const body = mentions ? (content ? `${mentions} ${content}` : mentions) : content;
  return sendDiscord(channelId, body, embeds, components, { allowedMentions });
}

/** Send via an existing discord.js client (bot side; keeps builders callers already construct). */
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

/** Dashboard URLs used inside pings. One place, built from BASE_URL. */
export const urls = {
  task: (uid) => `${BASE_URL}/v2/tasks/${encodeURIComponent(uid)}`,
  approvals: () => `${BASE_URL}/v2/leadership?tab=approvals`,
  faction: (name, tab) => `${BASE_URL}/v2/factions/${encodeURIComponent(name)}${tab ? `?tab=${tab}` : ''}`,
  reviews: () => `${BASE_URL}/v2/leadership?tab=reviews`,
  documents: (title) => `${BASE_URL}/v2/story?tab=docs${title ? `&sop=${encodeURIComponent(title)}` : ''}`,
  library: (tab) => `${BASE_URL}/v2/story?tab=${tab || 'scenes'}`,
  home: () => `${BASE_URL}/v2`,
};

/**
 * Action row for a task-assigned ping. Claim / Done are handled by the bot's
 * tsk:* button handlers; Open links the task detail page. The task_uid inside
 * the custom_id is the entire contract between dashboard and bot.
 */
export function taskComponents(uid) {
  return [{
    type: 1,
    components: [
      { type: 2, style: 1, label: 'Claim', custom_id: `tsk:claim:${uid}` },
      { type: 2, style: 3, label: 'Done', custom_id: `tsk:done:${uid}` },
      { type: 2, style: 5, label: 'Open', url: urls.task(uid) },
    ],
  }];
}

/**
 * Action row for an RP-change pipeline ping. One row per stage; the bot's
 * rpc:* handlers mirror the dashboard actions. Contract: rpc:<action>:<pending_executions.id>.
 */
export function rpComponents(execId, stage) {
  const open = { type: 2, style: 5, label: 'Open', url: urls.approvals() };
  const rows = {
    pending:  [{ type: 2, style: 3, label: 'Approve', custom_id: `rpc:approve:${execId}` },
               { type: 2, style: 4, label: 'Deny…', custom_id: `rpc:deny:${execId}` }, open],
    approved: [{ type: 2, style: 3, label: 'Confirm RP done', custom_id: `rpc:done:${execId}` }, open],
    done:     [{ type: 2, style: 1, label: 'Execute…', custom_id: `rpc:exec:${execId}` }, open],
  };
  return rows[stage] ? [{ type: 1, components: rows[stage] }] : undefined;
}
