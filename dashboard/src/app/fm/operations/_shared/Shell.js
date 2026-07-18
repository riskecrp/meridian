"use client";
import { DocBar } from "../../../../lib/SopLink";

export default function OperationsShell({ title, children, docs, authLevel }) {
  return (
    <div className="page-shell">
      <div className="page-hdr" style={{ background: 'linear-gradient(180deg, rgba(248,113,113,0.06) 0%, transparent 100%)' }}>
        <div className="accent-bar" style={{ background: 'linear-gradient(90deg, var(--red) 0%, transparent 60%)' }} />
        <div className="page-hdr-tag" style={{ color: 'var(--red)' }}>Operations / {title}</div>
        <h1>{title}</h1>
        {docs && <DocBar links={docs} authLevel={authLevel || 3} />}
      </div>
      <div className="page-body scr">{children}</div>
    </div>
  );
}
