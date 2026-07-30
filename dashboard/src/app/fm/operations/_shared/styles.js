import { ui } from "../../../../lib/ui.js";
// Shared inline styles for all operations pages
export const st = {
  ...ui,
  tab: (a) => ({ padding: '10px 20px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: a ? 'var(--accent-bg)' : 'transparent', color: a ? 'var(--accent)' : 'var(--fg-4)', border: 'none', borderRadius: 8 }),
};
