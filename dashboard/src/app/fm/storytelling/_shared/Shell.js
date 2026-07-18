"use client";
export default function StorytellingShell({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="page-hdr" style={{ background: 'linear-gradient(180deg, rgba(192,132,252,0.07) 0%, transparent 100%)' }}>
        <div className="accent-bar" style={{ background: 'linear-gradient(90deg, var(--storytelling) 0%, transparent 60%)' }} />
        <div className="page-hdr-tag" style={{ color: 'var(--storytelling)' }}>Storytelling / {title}</div>
        <h1 style={{ fontSize: 22, fontFamily: 'var(--font-display)', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>{title}</h1>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '14px 24px 0' }}>
        {children}
      </div>
    </div>
  );
}
