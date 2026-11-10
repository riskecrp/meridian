// Bot-side entry to the shared ping registry (shared/pings.js). Same table,
// same semantics as the dashboard; a change made there takes effect here on the
// next ping with no restart.
export { getPingRoute, getRole, pingChannel, pingEnabled, pingRoleIds, pingMentions, sendPing, sendPingVia, sendDiscord, taskComponents, rpComponents, urls, BASE_URL } from '../../shared/pings.js';
