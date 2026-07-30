"use client";

/**
 * A placeholder in the shape of the page that is about to arrive.
 *
 * These pages fetch through server actions, so there is always a gap. A centred
 * "Loading..." leaves the page blank and then jumps when content lands; holding
 * the shape means the only thing that changes is the content itself.
 *
 * `cols` is given as grid fractions so the bars line up with the real table
 * rather than reading as a generic grey block. The shimmer is defined in
 * globals.css (`.sk-bar`) because keyframes cannot be set inline, and it stops
 * for anyone who has asked for reduced motion.
 */
export default function TableSkeleton({ cols = ['1.4fr', '1fr', '1fr', '0.8fr'], rows = 6, title = true }) {
  const widths = [85, 55, 70, 60, 75, 50];
  return (
    <div className="page-shell" aria-busy="true" aria-live="polite">
      {title && (
        <div className="page-hdr">
          <div className="accent-bar" style={{ background: 'linear-gradient(90deg,var(--accent) 0%,transparent 60%)' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="sk-bar" style={{ height: 8, width: 120, borderRadius: 3 }} />
            <span className="sk-bar" style={{ height: 18, width: 240, borderRadius: 4 }} />
          </div>
        </div>
      )}
      <div className="page-body">
        <div className="sec-card">
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} style={{
              display: 'grid', gridTemplateColumns: cols.join(' '), gap: 12,
              padding: '11px 14px', borderBottom: r === rows - 1 ? 'none' : '1px solid var(--border)',
            }}>
              {cols.map((_c, c) => (
                <span key={c} className="sk-bar" style={{ height: 9, borderRadius: 3, width: `${widths[(r + c) % widths.length]}%` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
