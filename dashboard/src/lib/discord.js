import { queryOne } from './db.js';

export function getChannel(key) {
  return queryOne("SELECT channel_id FROM discord_config WHERE key = ?", [key])?.channel_id || '';
}

export function getRole(key) {
  return queryOne("SELECT role_id FROM discord_roles WHERE key = ?", [key])?.role_id || '';
}

/**
 * A channel or thread's recent messages, oldest first. Read live rather than
 * mirrored into the database: the discussion under a feedback thread is written
 * in Discord and belongs there, and CDN links on attachments are signed at fetch
 * time — a stored copy of one would be expired by the time anyone clicked it.
 *
 * Failures return [] rather than throwing. The caller is showing a discussion
 * beside content that loaded fine, so an unreachable thread should read as
 * "nothing to show" and not take the page down with it.
 */
export async function fetchChannelMessages(channelId, limit = 100) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return [];
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`,
      { headers: { Authorization: `Bot ${token}` } },
    );
    if (!res.ok) {
      console.error(`[Discord] messages fetch for ${channelId} failed ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.reverse().map(m => ({
      author: m.author?.global_name || m.author?.username || '?',
      bot: !!m.author?.bot,
      content: m.content || '',
      timestamp: (m.timestamp || '').slice(0, 16).replace('T', ' '),
      attachments: (m.attachments || []).map(a => ({
        url: a.url || '',
        filename: a.filename || 'file',
        contentType: a.content_type || '',
      })),
    }));
  } catch (e) {
    console.error('[Discord] messages fetch:', e.message);
    return [];
  }
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
