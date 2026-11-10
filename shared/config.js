// Reads discord channel/role config from the database
import { query, queryOne } from './db.js';

export function getDiscordChannel(key) {
    const row = queryOne('SELECT channel_id FROM discord_config WHERE key = ?', [key]);
    return row?.channel_id || '';
}

export function getDiscordRole(key) {
    const row = queryOne('SELECT role_id FROM discord_roles WHERE key = ?', [key]);
    return row?.role_id || '';
}

export function getAllChannels() {
    return query('SELECT key, channel_id, description FROM discord_config');
}

export function getAllRoles() {
    return query('SELECT key, role_id, description FROM discord_roles');
}

// The FM guild. Comes from the environment only (policy 12): an unconfigured
// copy gets '' and every guild-scoped feature says so instead of silently
// pointing at someone else's server.
export const GUILD_ID = process.env.GUILD_ID || '';

/** Link to a channel/thread in the FM guild; a plain mention when the guild is unknown. */
export function guildChannelUrl(channelId) {
    if (!channelId) return '';
    return GUILD_ID ? `https://discord.com/channels/${GUILD_ID}/${channelId}` : `<#${channelId}>`;
}
