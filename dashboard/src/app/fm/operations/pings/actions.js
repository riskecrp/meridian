"use server";
import { query, queryOne, run } from "../../../../lib/db.js";
import { logAudit } from "../../../../lib/audit.js";
import { requireActor } from "../../../../lib/requireActor.js";
import { sendDiscord } from "../../../../lib/discord.js";
import { getDiscordDirectory, resolveChannelIds } from "../../../../lib/discordDirectory.js";
import { PING_GROUPS } from "./pingGroups.js";

// Ping configuration is L3-only: retargeting a route changes where confidential
// leadership traffic lands.

export async function getPingConfig() {
  await requireActor(3);

  const routes = query("SELECT * FROM ping_routes ORDER BY group_key, sort, key").map(r => ({
    ...r,
    enabled: !!r.enabled,
    mention_roles: safeParse(r.mention_roles),
  }));

  const { channels, roles, error } = await getDiscordDirectory();

  // Anything a route points at that the sweep didn't list gets looked up
  // directly, so archived threads and private channels still render by name and
  // genuinely deleted channels are reported as such rather than merely absent.
  const known = new Set(channels.map(c => c.id));
  const unlisted = [];
  for (const r of routes) {
    if (r.channel_id && !known.has(r.channel_id)) unlisted.push(r.channel_id);
    if (r.alt_channel_id && !known.has(r.alt_channel_id)) unlisted.push(r.alt_channel_id);
  }
  let dead = [];
  let allChannels = channels;
  if (unlisted.length && !error) {
    const res = await resolveChannelIds(unlisted);
    allChannels = channels.concat(res.extra);
    dead = res.dead;
  }

  return {
    groups: PING_GROUPS,
    routes,
    channels: allChannels,
    roles,
    deadChannels: dead,
    directoryError: error || '',
    namedChannels: query("SELECT key, channel_id, description FROM discord_config ORDER BY id"),
    syncChannels: query("SELECT channel_id, name, enabled, sort FROM conversation_sync_channels ORDER BY sort, name")
      .map(c => ({ ...c, enabled: !!c.enabled })),
    knownRoles: query("SELECT key, role_id, description FROM discord_roles ORDER BY key"),
  };
}

function safeParse(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export async function updatePingRoute(key, data) {
  const actor = await requireActor(3);
  const route = queryOne("SELECT * FROM ping_routes WHERE key = ?", [key]);
  if (!route) return { ok: false, error: 'Unknown ping route.' };

  const channelId    = (data.channel_id ?? route.channel_id) || '';
  const altChannelId = route.alt_label ? ((data.alt_channel_id ?? route.alt_channel_id) || '') : '';
  const mentionRoles = Array.isArray(data.mention_roles)
    ? data.mention_roles.filter(id => /^\d{17,20}$/.test(String(id)))
    : safeParse(route.mention_roles);
  const enabled = data.enabled === undefined ? route.enabled : (data.enabled ? 1 : 0);

  // A channel route that is on must have somewhere to go.
  if (enabled && route.kind === 'channel' && !channelId) {
    return { ok: false, error: 'Pick a channel, or switch the ping off.' };
  }

  run(
    `UPDATE ping_routes
        SET channel_id = ?, alt_channel_id = ?, mention_roles = ?, enabled = ?,
            updated_at = datetime('now'), updated_by = ?
      WHERE key = ?`,
    [channelId, altChannelId, JSON.stringify(mentionRoles), enabled, actor.name, key]
  );

  const changes = [];
  if (channelId !== route.channel_id) changes.push(`channel ${route.channel_id || '—'} → ${channelId || '—'}`);
  if (altChannelId !== route.alt_channel_id) changes.push(`alt channel ${route.alt_channel_id || '—'} → ${altChannelId || '—'}`);
  if (JSON.stringify(mentionRoles) !== route.mention_roles) changes.push(`mentions → ${mentionRoles.length ? mentionRoles.join(', ') : 'none'}`);
  if (enabled !== route.enabled) changes.push(enabled ? 'enabled' : 'DISABLED');

  logAudit(actor.id, actor.name, 'EDIT', 'ping_route', null, route.label, changes.join('; ') || 'no change');
  return { ok: true };
}

// Fires a clearly-marked test message through the route exactly as a real ping
// would travel, so a misconfigured channel fails here instead of in production.
export async function testPing(key, { alt = false } = {}) {
  const actor = await requireActor(3);
  const route = queryOne("SELECT * FROM ping_routes WHERE key = ?", [key]);
  if (!route) return { ok: false, error: 'Unknown ping route.' };
  if (!route.enabled) return { ok: false, error: 'This ping is switched off — turn it on to test it.' };

  const channelId = (alt && route.alt_channel_id) ? route.alt_channel_id : route.channel_id;
  if (!channelId) return { ok: false, error: 'No channel set for this destination.' };

  const mentions = safeParse(route.mention_roles);
  // Deliberately does NOT resolve the role mentions — a test shouldn't ping people.
  const mentionNote = mentions.length
    ? `\nWould mention: ${mentions.map(id => `@${id}`).join(', ')}`
    : '';
  const body = `🧪 **Ping test — ${route.label}**\nSent by ${actor.name} from Admin › Pings. This is the channel **${route.label}** will post to.${mentionNote}`;

  const ok = await sendDiscord(channelId, body, null, null);
  logAudit(actor.id, actor.name, 'EDIT', 'ping_route', null, route.label, `Test send → ${channelId} (${ok ? 'ok' : 'failed'})`);
  return ok
    ? { ok: true }
    : { ok: false, error: 'Discord rejected the message — check the bot can post in that channel.' };
}

export async function refreshDirectory() {
  await requireActor(3);
  const { channels, roles, error } = await getDiscordDirectory({ force: true });
  return { channels, roles, error: error || '' };
}

// ── Named channels (discord_config) ──────────────────────────────────────────
// These feed the recurring-reminder channel picker and dashboard visibility
// rules, so they are configured here alongside the routes.
export async function updateNamedChannel(key, channelId) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT * FROM discord_config WHERE key = ?", [key]);
  if (!row) return { ok: false, error: 'Unknown channel key.' };
  if (channelId && !/^\d{17,20}$/.test(String(channelId))) return { ok: false, error: 'That is not a channel id.' };
  run("UPDATE discord_config SET channel_id = ? WHERE key = ?", [channelId || '', key]);
  logAudit(actor.id, actor.name, 'EDIT', 'discord_config', null, key, `${row.channel_id || '—'} → ${channelId || '—'}`);
  return { ok: true };
}

// ── Conversation sync channels ───────────────────────────────────────────────
export async function addSyncChannel(channelId, name) {
  const actor = await requireActor(3);
  if (!/^\d{17,20}$/.test(String(channelId || ''))) return { ok: false, error: 'That is not a channel id.' };
  const max = queryOne("SELECT COALESCE(MAX(sort), 0) AS m FROM conversation_sync_channels")?.m || 0;
  run("INSERT OR IGNORE INTO conversation_sync_channels (channel_id, name, sort) VALUES (?, ?, ?)",
    [channelId, name || '', max + 10]);
  logAudit(actor.id, actor.name, 'CREATE', 'conversation_sync', null, name || channelId, 'Added to harvest list');
  return { ok: true };
}

export async function setSyncChannelEnabled(channelId, enabled) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT name FROM conversation_sync_channels WHERE channel_id = ?", [String(channelId || '')]);
  if (!row) return { ok: false, error: 'That channel is not in the sync list.' };
  run("UPDATE conversation_sync_channels SET enabled = ? WHERE channel_id = ?", [enabled ? 1 : 0, channelId]);
  logAudit(actor.id, actor.name, 'EDIT', 'conversation_sync', null, row.name || channelId, enabled ? 'Enabled' : 'Disabled');
  return { ok: true };
}

export async function removeSyncChannel(channelId) {
  const actor = await requireActor(3);
  const row = queryOne("SELECT name FROM conversation_sync_channels WHERE channel_id = ?", [String(channelId || '')]);
  if (!row) return { ok: false, error: 'That channel is not in the sync list.' };
  run("DELETE FROM conversation_sync_channels WHERE channel_id = ?", [channelId]);
  logAudit(actor.id, actor.name, 'DELETE', 'conversation_sync', null, row.name || channelId, 'Removed from harvest list');
  return { ok: true };
}
