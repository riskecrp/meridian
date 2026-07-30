/**
 * The dashboard's shared inline-style primitives.
 *
 * Before this there were five definitions of the primary button — one in each of
 * the four `_shared/styles.js` files and one in each page that skipped them —
 * differing by a pixel of padding, a step of font weight, two pixels of radius.
 * Nobody notices any single one; what people notice is that the app feels
 * slightly unsettled as they move around it.
 *
 * Everything here is deliberately a *primitive*: a button, a field, a label. It
 * does not try to absorb the genuinely different components — Factions' underline
 * tabs and Operations' pill tabs are different things that happen to share a
 * name, and flattening them would change what pages look like rather than making
 * them consistent. Those stay where they are.
 *
 * Usage, keeping each area's existing export name so no page import changes:
 *
 *     import { ui } from '../../../lib/ui.js';
 *     export const s = { ...ui, cardHover: {...} };   // area-specific extras win
 */
export const ui = {
  // 11.5px/700 rather than any one file's value: the four sat at 11–12px and
  // 700–800, and this is the middle that looked right at both sizes.
  btn: { background: 'var(--accent)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em', textDecoration: 'none' },
  btnGhost: { background: 'transparent', color: 'var(--fg-3)', border: '1px solid var(--border)', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em', textDecoration: 'none' },
  btnDanger: { background: 'var(--red-bg)', color: 'var(--red)', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' },
  // A bare text button, for row-level actions that should not compete with the
  // real controls around them.
  btnSm: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 700, padding: '2px 5px' },

  input: { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--fg-0)', outline: 'none' },
  label: { fontSize: 10, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 },

  modal: { position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalBg: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' },
};
