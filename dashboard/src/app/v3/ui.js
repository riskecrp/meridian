"use client";
// The v3 component kit. Every page composes these; layout never lives in
// inline styles. Classes are defined in v3.css.
import { useEffect, useState, createContext, useContext } from "react";
import Link from "next/link";

export function PageHeader({ eyebrow, title, sub, actions }) {
  return (
    <div className="ph">
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, right, flush, className = "", children, ...rest }) {
  return (
    <div className={`card${flush ? " flush" : ""} ${className}`} {...rest}>
      {(title || right) && <div className="ch"><span className="t">{title}</span>{right}</div>}
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }) {
  return <div className={`stat${tone ? ` ${tone}` : ""}`}><div className="l">{label}</div><div className="v">{value}</div></div>;
}

export function Badge({ tone, children, title }) { return <span className={`badge${tone ? ` ${tone}` : ""}`} title={title}>{children}</span>; }

export function Button({ variant, size, children, ...rest }) {
  return <button className={`btn${variant ? ` ${variant}` : ""}${size === "sm" ? " sm" : ""}`} {...rest}>{children}</button>;
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={active === t.id} className={`tab${active === t.id ? " on" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}{t.count > 0 && <span className="ct">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, help, children }) {
  return <div className="field">{label && <label>{label}</label>}{children}{help && <div className="help">{help}</div>}</div>;
}

export function Empty({ title, children }) {
  return <div className="empty">{title && <div className="t">{title}</div>}{children}</div>;
}

export function Restricted({ children = "You do not have access to this section." }) { return <div className="restricted">{children}</div>; }

export function ListItem({ title, detail, side, hot, href, onClick }) {
  const cls = `li${hot ? " hot" : ""}${href || onClick ? " link" : ""}`;
  const body = <><div className="body"><div className="t">{title}</div>{detail && <div className="d">{detail}</div>}</div>{side && <div className="side">{side}</div>}</>;
  if (href) return <Link href={href} className={cls}>{body}</Link>;
  return <div className={cls} onClick={onClick}>{body}</div>;
}

/** Age in days from an ISO/SQLite timestamp, coloured past 7 and 14 days. */
export function Age({ since, warnDays = 7, staleDays = 14 }) {
  const d = since ? Math.floor((Date.now() - new Date(String(since).replace(" ", "T")).getTime()) / 86400000) : null;
  if (d == null || Number.isNaN(d)) return null;
  const cls = d >= staleDays ? "age stale" : d >= warnDays ? "age old" : "age";
  return <span className={cls} title={String(since)}>{d === 0 ? "today" : `${d}d`}</span>;
}

export function Modal({ title, onClose, onSave, saveLabel = "Save", saveDisabled, error, children, maxWidth }) {
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose?.(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true">
      <div className="modal-bg" onClick={onClose} />
      <div className="modal" style={maxWidth ? { maxWidth } : undefined}>
        <div className="mt">{title}</div>
        <div className="stack" style={{ gap: 10 }}>{children}</div>
        {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
        <div className="mf"><Button variant="ghost" onClick={onClose}>Cancel</Button>{onSave && <Button disabled={saveDisabled} onClick={onSave}>{saveLabel}</Button>}</div>
      </div>
    </div>
  );
}

// ── Toasts: one provider in the shell, useToast() anywhere ──
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = (text, tone = "") => {
    const id = Math.random().toString(36).slice(2);
    setItems(l => [...l, { id, text, tone }]);
    setTimeout(() => setItems(l => l.filter(t => t.id !== id)), 4500);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">{items.map(t => <div key={t.id} className={`toast${t.tone ? ` ${t.tone}` : ""}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export function useToast() { return useContext(ToastCtx); }

/**
 * The one action runner: every server action call goes through run(). Shows
 * {ok:false,error} and thrown errors as a toast (and returns false); shows a
 * returned `notice` as a success toast.
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn, { onDone, success } = {}) => {
    setBusy(true);
    let r;
    try { r = await fn(); }
    catch (e) { setBusy(false); toast(e?.message || "Action failed.", "bad"); return false; }
    setBusy(false);
    if (r && r.ok === false) { toast(r.error || "Action failed.", "bad"); return false; }
    if (r?.notice) toast(r.notice, "good"); else if (success) toast(success, "good");
    if (onDone) await onDone(r);
    return true;
  };
  return { run, busy };
}

/** Read ?tab= (and any other key) from the location without a Suspense boundary. */
export function useQueryParam(key, fallback = "") {
  const [v, setV] = useState(fallback);
  useEffect(() => {
    const read = () => { try { setV(new URLSearchParams(window.location.search).get(key) || fallback); } catch {} };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [key, fallback]);
  return v;
}

export function setQueryParam(key, value) {
  const u = new URL(window.location.href);
  if (value == null || value === "") u.searchParams.delete(key); else u.searchParams.set(key, value);
  window.history.pushState({}, "", u.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const fmtDate = (v) => { if (!v) return ""; const d = new Date(String(v).replace(" ", "T")); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); };
export const fmtDateTime = (v) => { if (!v) return ""; const d = new Date(String(v).replace(" ", "T")); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };
