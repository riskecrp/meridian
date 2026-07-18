"use client";
import { DocBar } from "../../../../lib/SopLink";

export default function LeadershipShell({ title, children, level, docs, section = "Leadership", accent = "var(--leadership)", headerBg = "rgba(251,191,36,0.06)", subtitle }) {
  return (
    <div className="page-shell">
      <div className="page-hdr" style={{ background: `linear-gradient(180deg, ${headerBg} 0%, transparent 100%)` }}>
        <div className="accent-bar" style={{ background: `linear-gradient(90deg, ${accent} 0%, transparent 60%)` }} />
        <div className="page-hdr-tag" style={{ color: accent }}>{section} / {title}</div>
        <h1>{title}</h1>
        <div className="page-hdr-sub">{subtitle ?? (level >= 3 ? 'Full Access — All Teams' : 'Team Lead View')}</div>
        {docs && <DocBar links={docs} authLevel={level || 2} />}
      </div>
      <div className="page-body scr">{children}</div>
    </div>
  );
}
