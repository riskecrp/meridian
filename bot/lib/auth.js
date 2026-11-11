// One permission gate for every slash command, button and modal, built on the
// same actor the dashboard uses (shared/actor.js → staff row + dashboard_access
// grant + Event Team / Lead Storyteller flags + owner). A Discord role on its
// own grants nothing: the staff roster is the truth on both surfaces.
//
//   const actor = await requireStaff(interaction, 3);              // leadership
//   const actor = await requireStaff(interaction, 1, { allowLeadStoryteller: true });
//   if (!actor) return true;   // the refusal has already been sent, ephemeral
//
// Mirrors dashboard/src/lib/requireActor.js: allowEventTeam lifts an Event
// Teamer to L3 for that call; allowLeadStoryteller lets a Lead Storyteller
// through WITHOUT raising their level (write gates still reject them). Owners
// are at least L3, as they are at login.
import { actorFromDiscord } from '../../shared/actor.js';
import { getRole } from './pings.js';

const LEVEL_NAME = { 1: 'FM staff', 2: 'Team Leads and Leadership', 3: 'FM Leadership' };

/**
 * Reply to an interaction exactly once, ephemerally, whatever state it is in.
 * Never throws — a refusal that cannot be delivered must not take the handler
 * down with it.
 */
export async function replyEphemeral(interaction, payload) {
  const body = typeof payload === 'string' ? { content: payload } : { ...payload };
  body.ephemeral = true;
  try {
    if (interaction.deferred && !interaction.replied) return await interaction.editReply(body);
    if (interaction.replied || interaction.deferred) return await interaction.followUp(body);
    return await interaction.reply(body);
  } catch (e) {
    console.error('[AUTH] could not reply:', e.message);
    return null;
  }
}

/** The acting staffer behind an interaction, or null when they are not on the roster. */
export function resolveActor(interaction) {
  const user = interaction?.user;
  if (!user?.id) return null;
  const fallbackName = interaction.member?.displayName || user.globalName || user.username || '';
  const actor = actorFromDiscord(user.id, fallbackName);
  if (!actor) return null;
  // The dashboard derives these two flags from Discord roles at login; a
  // button press carries the member's roles directly, so honour them here too.
  const held = interaction.member?.roles?.cache;
  if (held) {
    const et = getRole('event_team'), lst = getRole('lead_storyteller');
    if (et && held.has(et)) actor.isEventTeam = true;
    if (lst && held.has(lst)) actor.isLeadStoryteller = true;
  }
  if (actor.isOwner) actor.level = Math.max(actor.level, 3);
  actor.discordName = user.username || '';
  return actor;
}

/**
 * Gate an interaction. Returns the actor, or null after sending an ephemeral
 * refusal that says why. Every caller must `return` when it gets null.
 */
export async function requireStaff(interaction, minLevel = 1, { allowEventTeam = false, allowLeadStoryteller = false } = {}) {
  const actor = resolveActor(interaction);
  if (!actor) {
    await replyEphemeral(interaction, 'This is for FM staff only — you are not on the staff roster.');
    return null;
  }
  if (allowEventTeam && actor.isEventTeam) actor.level = Math.max(actor.level, 3);
  const lstGranted = allowLeadStoryteller && actor.isLeadStoryteller;
  if (actor.level < minLevel && !lstGranted) {
    await replyEphemeral(interaction, `Only ${LEVEL_NAME[minLevel] || `clearance L${minLevel}`} can do that (you are L${actor.level}).`);
    return null;
  }
  return actor;
}

/** The system actor for things the bot does on its own (promotion review, intakes). */
export const BOT_ACTOR = Object.freeze({ id: 'bot', name: 'Meridian', level: 3, rank: 'Management', teamId: '', teamName: '', isEventTeam: false, isLeadStoryteller: false, isOwner: false, source: 'bot' });
