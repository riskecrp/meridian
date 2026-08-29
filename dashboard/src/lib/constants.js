// Clearance levels
export const LEVEL_GUIDE      = 1;
export const LEVEL_LEAD       = 2;
export const LEVEL_MANAGEMENT = 3;

// Discord role/user IDs that are not in discord_config (static)
export const GAME_AFFAIRS_ID  = '1457189093594239147';
export const RISK_DISCORD_ID  = process.env.RISK_DISCORD_ID || '738214924760907907';

// Owner-only powers (view-as another staffer, prune the audit log). RISK plus the
// head of FM (lightningbolt9, added 2026-08-29). Plain strings so client
// components can import this too.
export const OWNER_IDS = [RISK_DISCORD_ID, '232331558676070401'];
export const isOwner = (id) => !!id && OWNER_IDS.includes(String(id));

// The FM management guild — where IC-contact / intake threads live.
// Client-safe plain string (no env fallback) so v2 pages can build thread links.
export const FM_GUILD_ID      = '1457188814916423855';

