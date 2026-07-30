import { ui } from "../../../../lib/ui.js";
// Shared inline styles + helpers for the Factions list and detail pages.
export const s = {
  ...ui,
  card: { background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 12 },
  cardHover: { borderColor: 'var(--accent)', boxShadow: '0 0 20px var(--accent-bg)' },
  badge: { background: 'var(--bg-3)', color: 'var(--fg-3)', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 99, letterSpacing: '0.1em' },
  link: { color: 'var(--accent)', fontSize: 11, fontWeight: 700, textDecoration: 'none', letterSpacing: '0.05em' },
  modalContent: { position: 'relative', width: '100%', maxWidth: 1100, maxHeight: '92vh', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  tab: (active) => ({ padding: '12px 24px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'pointer', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', color: active ? 'var(--accent)' : 'var(--fg-4)', background: 'transparent', border: 'none', borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: active ? 'var(--accent)' : 'transparent', whiteSpace: 'nowrap' }),
  subtab: (active) => ({ padding: '6px 14px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', borderRadius: 7, background: active ? 'var(--accent)' : 'var(--bg-2)', color: active ? 'white' : 'var(--fg-3)', border: '1px solid var(--border)' }),
  section: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 },
};

export const tierColor = (t) => {
  if (t >= 5) return 'var(--fg-0)';
  if (t >= 4) return 'var(--fg-2)';
  if (t >= 3) return 'var(--accent)';
  if (t >= 2) return 'var(--green)';
  return 'var(--fg-4)';
};
