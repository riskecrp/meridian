// Requester notices for the RP-change pipeline (policy 8): the person who asked
// for the change is told by DM, with the 'rp.requester' route's channel as the
// fallback. shared/rpChanges.js owns the wording and the fallback; this module
// gives it the discord.js client as the DM transport, and offers the same
// DM-then-channel delivery to anything else the bot wants to tell a requester.
import { setRequesterNotifier, notifyRequester as sharedNotify } from '../../shared/rpChanges.js';
import { sendPing } from './pings.js';

/** DM a user through the gateway client. Returns true on success; never throws. */
export async function dmUser(client, discordId, content, components, embeds) {
  if (!client?.users?.fetch || !discordId) return false;
  try {
    const user = await client.users.fetch(discordId);
    const payload = { content };
    if (components) payload.components = components;
    if (embeds) payload.embeds = embeds;
    await user.send(payload);
    return true;
  } catch (e) {
    console.error(`[NOTIFY] DM to ${discordId} failed: ${e.message}`);
    return false;
  }
}

let registeredFor = null;
/** Make shared/rpChanges.js deliver requester notices through this client (idempotent). */
export function ensureRequesterNotifier(client) {
  if (!client || registeredFor === client) return;
  registeredFor = client;
  setRequesterNotifier((discordId, content, components) => dmUser(client, discordId, content, components));
}

/**
 * Tell the requester of an RP change something, DM first, channel fallback.
 *   client   — the discord.js client (DM transport)
 *   execRow  — a pending_executions row (requester_id, id, faction_name, …)
 *   text     — the notice
 *   stage    — optional: 'pending' | 'approved' | 'done' adds that stage's buttons
 * Returns 'dm' | 'channel' | false. Never throws.
 */
export async function notifyRequester(client, execRow, text, { stage, routeKey } = {}) {
  ensureRequesterNotifier(client);
  try {
    const via = await sharedNotify(execRow, text, { stage });
    if (via) return via;
    // The shared route is unset or muted: a legacy per-stage route is the last resort.
    if (routeKey && execRow?.requester_id) {
      const ok = await sendPing(routeKey, `<@${execRow.requester_id}> ${text}`);
      if (ok) return 'channel';
    }
  } catch (e) { console.error('[NOTIFY] requester notice failed:', e.message); }
  return false;
}
