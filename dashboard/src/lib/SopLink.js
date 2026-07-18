"use client";
import Link from "next/link";

/**
 * Named document reference link.
 * title  — exact document title (used for the ?sop= lookup)
 * label  — optional shorter display label; defaults to title
 */
export default function SopLink({ title, label }) {
  const display = label || title;
  const encoded = encodeURIComponent(title);
  return (
    <Link
      href={`/fm/documents?sop=${encoded}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 5,
        border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.07)',
        color: '#818cf8', textDecoration: 'none', whiteSpace: 'nowrap',
      }}>
      📄 {display}
    </Link>
  );
}

/**
 * A horizontal bar of named document links, rendered below a page heading.
 *
 * links    — array of { title, label?, minLevel? }
 * authLevel — the current user's clearance level (1 | 2 | 3)
 *             Links with minLevel > authLevel are hidden.
 *             Defaults to 1 (most restrictive) so callers must pass the real level.
 */
export function DocBar({ links, authLevel = 1 }) {
  const visible = (links || []).filter(l => !l.minLevel || authLevel >= l.minLevel);
  if (!visible.length) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.12em', color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)',
      }}>Guides</span>
      {visible.map(l => <SopLink key={l.title} title={l.title} label={l.label} />)}
    </div>
  );
}
