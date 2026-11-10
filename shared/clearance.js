// Clearance is an explicit column (staff.clearance) and is never inferred from
// the free-text rank at read time. These helpers exist only for the places that
// still set clearance from a rank chosen in a form, so the rule lives once:
//   Management / Leadership / Game Affairs / Founder / Executive  -> 3
//   Team Lead                                                      -> 2
//   anything else                                                  -> 1

export const RANKS = ['Guide', 'Team Lead', 'Management'];

export function clearanceForRank(rank) {
  const r = String(rank || '').toLowerCase();
  if (/management|leadership|game affairs|founder|executive/.test(r)) return 3;
  if (/\blead\b|team lead/.test(r)) return 2;
  return 1;
}

export function rankForClearance(level) {
  return level >= 3 ? 'Management' : level >= 2 ? 'Team Lead' : 'Guide';
}

/** Leadership for routing purposes is a clearance, not a rank string. */
export function isLeadershipLevel(level) { return Number(level) >= 3; }
