// Clearance levels
export const LEVEL_GUIDE      = 1;
export const LEVEL_LEAD       = 2;
export const LEVEL_MANAGEMENT = 3;

// Discord role/user IDs that are not in discord_config (static)
export const GAME_AFFAIRS_ID  = '1457189093594239147';
export const RISK_DISCORD_ID  = process.env.RISK_DISCORD_ID || '738214924760907907';

// The FM management guild — where IC-contact / intake threads live.
// Client-safe plain string (no env fallback) so v2 pages can build thread links.
export const FM_GUILD_ID      = '1457188814916423855';

