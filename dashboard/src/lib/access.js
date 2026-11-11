// Faction write scoping lives in shared/access.js so the bot enforces the same
// rule. Kept here so existing dashboard imports keep working.
export { writableFactionIds, canWriteFaction, writableFactions, resolveFaction, assertFactionWrite } from '../../../shared/access.js';
