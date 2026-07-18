"use client";
import { useEffect, useRef, useState } from "react";

// Compact overflow (⋯) menu for per-row actions. The caller passes actions
// already filtered by permission: [{ label, onClick, danger }]. Renders
// nothing when there are no actions, so a row simply has no menu if the user
// can't do anything to it.
export default function RowMenu({ actions = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const items = actions.filter(Boolean);
  if (items.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="Actions"
        style={{ background: open ? "var(--bg-3)" : "none", border: "none", cursor: "pointer", color: "var(--fg-3)", fontSize: 16, lineHeight: 1, padding: "2px 8px", borderRadius: 6 }}
      >⋯</button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 40, minWidth: 160, background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}>
          {items.map((a, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setOpen(false); a.onClick(); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", fontSize: 12, fontWeight: 600, background: "none", border: "none", cursor: "pointer", color: a.danger ? "var(--red)" : "var(--fg-2)" }}
            >{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
