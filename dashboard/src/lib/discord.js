import { queryOne } from './db.js';

export function getChannel(key) {
  return queryOne("SELECT channel_id FROM discord_config WHERE key = ?", [key])?.channel_id || '';
}

export function getRole(key) {
  return queryOne("SELECT role_id FROM discord_roles WHERE key = ?", [key])?.role_id || '';
}

export async function sendDiscord(channelId, content, embeds, components) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return false;
  try {
    const body = { content, allowed_mentions: { parse: ['roles', 'users'] } };
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
