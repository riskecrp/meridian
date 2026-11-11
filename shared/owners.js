// Owner-only powers (view-as another staffer, prune the audit log).
// Plain strings, no imports, so client components can use this too.
// RISK_DISCORD_ID / OWNER_IDS come from the environment where one is set; the
// literals are the production defaults so an unconfigured copy still works.
const envOwners = (typeof process !== 'undefined' && process.env && process.env.OWNER_IDS)
  ? process.env.OWNER_IDS.split(',').map(s => s.trim()).filter(Boolean)
  : [];
export const RISK_DISCORD_ID = (typeof process !== 'undefined' && process.env && process.env.RISK_DISCORD_ID) || '738214924760907907';
export const OWNER_IDS = envOwners.length ? envOwners : [RISK_DISCORD_ID, '232331558676070401', '225429360411279360'];
export const isOwner = (id) => !!id && OWNER_IDS.includes(String(id));
