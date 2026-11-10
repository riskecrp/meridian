// Clearance levels
export const LEVEL_GUIDE      = 1;
export const LEVEL_LEAD       = 2;
export const LEVEL_MANAGEMENT = 3;

// Owner-only powers come from shared/owners.js (env-configurable: OWNER_IDS,
// RISK_DISCORD_ID). Plain strings so client components can import this too.
export { RISK_DISCORD_ID, OWNER_IDS, isOwner } from '../../../shared/owners.js';

// The Game Affairs role id is read from discord_roles at runtime
// (getRole('game_affairs')); this constant is only the client-side fallback for
// labels and pickers until the first server round-trip.
export const GAME_AFFAIRS_ID  = '1457189093594239147';

// The FM management guild — where IC-contact / intake threads live.
// Client-safe plain string so v2 pages can build thread links.
export const FM_GUILD_ID      = process.env.NEXT_PUBLIC_GUILD_ID || '1457188814916423855';
