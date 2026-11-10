// The ping registry lives in shared/pings.js so the dashboard and the bot read
// and send through one implementation. Kept as a module so existing imports work.
export { getPingRoute, pingChannel, pingEnabled, pingMentions, pingRoleIds, sendPing, sendDiscord, taskComponents, rpComponents, urls, BASE_URL } from '../../../shared/pings.js';
