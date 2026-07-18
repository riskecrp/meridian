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

// Guild ID
export const GUILD_ID = process.env.GUILD_ID || '1457188814916423855';
