"use client";
import { useState } from "react";

// The one v2 modal. Replaces the per-page copies in the hub, leadership and
// storytelling pages plus admin's inline overlays.
export default function Modal({ title, onClose, onSave, saveDisabled, saveLabel = "Save", maxWidth = 480, error, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onClose} />
      <div style={{ position: "relative", width: "100%", maxWidth, maxHeight: "88vh", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
        {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="act" onClick={onClose}>Cancel</button>
          {onSave && <button className="act primary" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>}
        </div>
      </div>
    </div>
  );
}

// Declarative field-list modal (ported from admin/page.js so every area can use it).
export function FormModal({ title, fields, onCancel, onSubmit }) {
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map(f => [f.name, f.default ?? (f.type === "checkbox" ? false : "")])));
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)" }} onClick={onCancel} />
      <div style={{ position: "relative", width: "100%", maxWidth: 440, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 12, padding: 18 }}>
        <div style={{ fontWeight: 700, color: "var(--ink-0)", marginBottom: 14 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {fields.map(f => (
            <div key={f.name}>
              {f.type === "checkbox"
                ? <label style={{ fontSize: 12.5, color: "var(--ink-1)", display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!vals[f.name]} onChange={e => setVals({ ...vals, [f.name]: e.target.checked })} /> {f.label}</label>
                : <>
                  <div style={lbl}>{f.label}</div>
                  {f.type === "select"
                    ? <select className="filter-inp" style={{ width: "100%" }} value={vals[f.name]} onChange={e => setVals({ ...vals, [f.name]: e.target.value })}>
                      {f.placeholder !== undefined && <option value="">{f.placeholder}</option>}
                      {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    : <input className="filter-inp" style={{ width: "100%" }} value={vals[f.name]} placeholder={f.placeholder || ""} onChange={e => setVals({ ...vals, [f.name]: e.target.value })} />}
                </>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="act" onClick={onCancel}>Cancel</button>
          <button className="act primary" onClick={() => onSubmit(vals)}>Save</button>
        </div>
      </div>
    </div>
  );
}
