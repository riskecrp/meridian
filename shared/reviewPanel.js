// The review panel and the rule that confirms a monthly review outcome.
//
// The panel is the holders of the FM Leadership Discord role (discord_roles
// 'fm_leadership') in GUILD_ID, read live over REST. An outcome is confirmed
// only when a strict majority OF THE PANEL (not of the votes cast so far) has
// voted for the same 'Confirmed …' status: 2 of 3, 3 of 4 or 5, and so on.
// Until then the review reads 'Pending Discussion'. When the role can't be
// read, the panel is null and callers must not change a stored outcome.
//
// One home: the dashboard (fm/leadership/actions.js) and the bot's monthly job
// (bot/promotionReview.js) both decide through decideOutcome() here.
import { getRole } from './pings.js';
import { queryOne } from './db.js';
import { REVIEW_STATUSES } from './validate.js';

export const CONFIRMED_STATUSES = REVIEW_STATUSES.filter(s => s.startsWith('Confirmed '));

const TTL_MS = 60_000;
let cache = null; // { at, guildId, roleId, members }

/** Drop the cached panel (tests, or after a role change you want seen at once). */
export function resetReviewPanelCache() { cache = null; }

/**
 * FM Leadership role holders: [{ id, name }] sorted by name, or null when the
 * token, guild, role or member list can't be read.
 */
export async function fetchReviewPanel() {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || '';
  const guildId = process.env.GUILD_ID || '';
  const roleId = getRole('fm_leadership');
  if (!token || !guildId || !roleId) return null;
  if (cache && cache.guildId === guildId && cache.roleId === roleId && Date.now() - cache.at < TTL_MS) return cache.members;
  try {
    const members = [];
    let after = '0';
    for (let page = 0; page < 20; page++) {
      const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`, { headers: { Authorization: `Bot ${token}` } });
      if (!res.ok) { console.error(`[review panel] members HTTP ${res.status}`); return null; }
      const batch = await res.json();
      if (!Array.isArray(batch)) return null;
      for (const m of batch) {
        if (!m?.user?.id || m.user.bot || !Array.isArray(m.roles) || !m.roles.includes(roleId)) continue;
        const staffName = queryOne("SELECT display_name FROM staff WHERE discord_id = ?", [m.user.id])?.display_name;
        members.push({ id: m.user.id, name: staffName || m.nick || m.user.global_name || m.user.username || m.user.id });
      }
      if (batch.length < 1000) break;
      after = batch[batch.length - 1].user.id;
    }
    members.sort((a, b) => a.name.localeCompare(b.name));
    cache = { at: Date.now(), guildId, roleId, members };
    return members;
  } catch (e) {
    console.error('[review panel] could not read FM Leadership members:', e.message);
    return null;
  }
}

/** Matching votes needed to confirm an outcome with a panel of `size`. */
export function votesNeeded(size) {
  return size > 0 ? Math.floor(size / 2) + 1 : null;
}

/**
 * The outcome for one faction-month from its vote counts ({ status: n }; non-
 * 'Confirmed …' keys are ignored) and the panel size. Returns
 * { status, needed, confirmed } where confirmed = number of 'Confirmed …' votes.
 */
export function decideOutcome(counts, panelSize) {
  let confirmed = 0, top = null;
  for (const [status, n] of Object.entries(counts || {})) {
    if (!CONFIRMED_STATUSES.includes(status)) continue;
    confirmed += n;
    if (!top || n > top.n) top = { status, n };
  }
  const needed = votesNeeded(panelSize);
  const status = top && needed && top.n >= needed ? top.status : 'Pending Discussion';
  return { status, needed, confirmed };
}
