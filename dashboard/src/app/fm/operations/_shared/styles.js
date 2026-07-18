// Shared inline styles for all operations pages
export const st = {
  btn: { background: 'var(--accent)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' },
  btnGhost: { background: 'transparent', color: 'var(--fg-3)', border: '1px solid var(--border)', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' },
  btnDanger: { background: 'var(--red-bg)', color: 'var(--red)', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' },
  input: { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: 'var(--fg-0)', outline: 'none' },
  label: { fontSize: 11, fontWeight: 700, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 },
  tab: (a) => ({ padding: '10px 20px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', background: a ? 'var(--accent-bg)' : 'transparent', color: a ? 'var(--accent)' : 'var(--fg-4)', border: 'none', borderRadius: 8 }),
};
