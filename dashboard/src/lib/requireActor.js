import { cookies } from 'next/headers';
import { resolveActor } from './session.js';

function authError(code, message) { const e = new Error(message); e.code = code; return e; }

async function currentActor() {
  const cookieStore = await cookies();
  const token = cookieStore.get('meridian_session')?.value;
  const viewAsId = cookieStore.get('meridian_viewas')?.value;
  return resolveActor(token, viewAsId);
}

/**
 * The gate every server action starts with.
 *   requireActor(2)                            team lead or above
 *   requireActor(3, { allowEventTeam: true })  leadership, or Event Team acting as L3 here
 *   requireActor(1, { allowLeadStoryteller: true })  guides and above, plus Lead Storytellers
 *                                              (their level is NOT raised: write gates still reject them)
 * Throws { code: 'AUTH_REQUIRED' | 'AUTH_INSUFFICIENT' }. Owner view-as is applied
 * server-side from the meridian_viewas cookie; the actor carries _impersonating,
 * _realId and _realName so the audit log can name who really acted.
 */
export async function requireActor(minLevel = 1, { allowEventTeam = false, allowLeadStoryteller = false } = {}) {
  const actor = await currentActor();
  if (!actor) throw authError('AUTH_REQUIRED', 'Not authenticated');
  if (allowEventTeam && actor.isEventTeam) actor.level = Math.max(actor.level, 3);
  const lstGranted = allowLeadStoryteller && actor.isLeadStoryteller;
  if (actor.level < minLevel && !lstGranted) {
    throw authError('AUTH_INSUFFICIENT', `Insufficient clearance (need L${minLevel}, have L${actor.level})`);
  }
  return actor;
}

/** The actor or null; never throws. */
export async function getActor() {
  try { return await currentActor(); } catch { return null; }
}

export async function requireEventTeam() {
  const actor = await currentActor();
  if (!actor) throw authError('AUTH_REQUIRED', 'Not authenticated');
  if (!actor.isEventTeam) throw authError('AUTH_INSUFFICIENT', 'Event Team access required');
  return actor;
}

export async function requireLeadStoryteller() {
  const actor = await currentActor();
  if (!actor) throw authError('AUTH_REQUIRED', 'Not authenticated');
  if (!actor.isLeadStoryteller) throw authError('AUTH_INSUFFICIENT', 'Lead Storyteller access required');
  return actor;
}

/** Owner-only powers (view-as, audit prune). */
export async function requireOwner() {
  const actor = await currentActor();
  if (!actor) throw authError('AUTH_REQUIRED', 'Not authenticated');
  const realId = actor._realId || actor.id;
  if (!actor.isOwner && !(actor._impersonating && realId)) throw authError('AUTH_INSUFFICIENT', 'Owner access required');
  return actor;
}
