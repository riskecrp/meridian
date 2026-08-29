"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import { listTables, getTableExport, getFullDump } from "./actions";
import { RUNBOOK, TABLE_DOCS } from "../../../lib/handoverContent.js";

/*
 * Server Handover / Migration Runbook.
 * L3-only (FM Leadership + Game Affairs Management, per callback/discord role map).
 * Static content — no secrets are rendered here; the .env is referenced by name only.
 * Content is data-driven (RUNBOOK below) so it stays easy to edit.
 */

// ── inline markdown: **bold** and `code` ──
function md(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} style={{ color: "#f1f5f9", fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={i} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.88em", background: "rgba(129,140,248,0.12)", color: "#c7d2fe", padding: "1px 5px", borderRadius: 4 }}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {}
  };
  return (
    <div style={{ position: "relative", margin: "12px 0" }}>
      <button onClick={copy} style={{
        position: "absolute", top: 8, right: 8, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
        fontFamily: "JetBrains Mono, monospace", border: "1px solid rgba(255,255,255,0.12)",
        background: copied ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.05)", color: copied ? "#34d399" : "rgba(255,255,255,0.5)",
      }}>{copied ? "COPIED" : "COPY"}</button>
      <pre style={{
        margin: 0, padding: "14px 16px", paddingRight: 64, borderRadius: 10, overflowX: "auto",
        background: "#0c0c12", border: "1px solid rgba(255,255,255,0.08)",
        fontFamily: "JetBrains Mono, monospace", fontSize: 12.5, lineHeight: 1.6, color: "#d4d4e0",
      }}><code>{code}</code></pre>
    </div>
  );
}

function Note({ tone = "info", children }) {
  const c = tone === "warn"
    ? { bg: "rgba(245,158,11,0.08)", bd: "rgba(245,158,11,0.35)", fg: "#fbbf24", icon: "⚠" }
    : tone === "danger"
    ? { bg: "rgba(248,113,113,0.08)", bd: "rgba(248,113,113,0.35)", fg: "#f87171", icon: "⛔" }
    : { bg: "rgba(99,102,241,0.08)", bd: "rgba(99,102,241,0.3)", fg: "#a5b4fc", icon: "ℹ" };
  return (
    <div style={{ display: "flex", gap: 10, padding: "11px 14px", margin: "12px 0", borderRadius: 10, background: c.bg, border: `1px solid ${c.bd}` }}>
      <span style={{ color: c.fg, fontSize: 14, lineHeight: 1.5, flexShrink: 0 }}>{c.icon}</span>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function Table({ head, rows }) {
  return (
    <div style={{ overflowX: "auto", margin: "12px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
        <thead>
          <tr>{head.map((h, i) => (
            <th key={i} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.45)", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((cell, ci) => (
              <td key={ci} style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.72)", verticalAlign: "top", lineHeight: 1.5 }}>{md(cell)}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Block({ b }) {
  if (b.p) return <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.75, margin: "10px 0" }}>{md(b.p)}</p>;
  if (b.code) return <CodeBlock code={b.code} />;
  if (b.note) return <Note tone={b.note.tone}>{md(b.note.text)}</Note>;
  if (b.table) return <Table head={b.table.head} rows={b.table.rows} />;
  if (b.ul) return (
    <ul style={{ margin: "10px 0", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 }}>
      {b.ul.map((li, i) => <li key={i} style={{ fontSize: 13.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.65 }}>{md(li)}</li>)}
    </ul>
  );
  return null;
}

// ── Database export ──────────────────────────────────────────────────────────
const PREVIEW_CAP = 5000; // inline copy box shows up to this many rows; download always gives all

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CopyBtn({ text, label = "Copy", style }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch {} }}
      style={{ fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
        border: "1px solid rgba(255,255,255,0.12)", background: done ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.05)", color: done ? "#34d399" : "rgba(255,255,255,0.6)", ...style }}>
      {done ? "COPIED" : label}
    </button>
  );
}

function TableRow({ t }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("csv");
  const [data, setData] = useState(null);      // { text, returned, total, cols }
  const [busy, setBusy] = useState(false);
  const [dl, setDl] = useState(false);

  const load = async (fmt) => {
    setBusy(true);
    try { setData(await getTableExport(t.name, fmt, PREVIEW_CAP)); } catch (e) { setData({ text: "-- error: " + (e.message || e), returned: 0, total: t.rows }); }
    setBusy(false);
  };
  const toggle = () => { const next = !open; setOpen(next); if (next && !data) load(format); };
  const switchFmt = (fmt) => { setFormat(fmt); load(fmt); };
  const doDownload = async () => {
    setDl(true);
    try {
      const full = await getTableExport(t.name, format, 0); // 0 = all rows
      downloadText(`${t.name}.${format}`, full.text, format === "json" ? "application/json" : "text/csv");
    } catch {}
    setDl(false);
  };

  const truncated = data && data.total > data.returned;

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, background: "rgba(255,255,255,0.02)", overflow: "hidden" }}>
      <button onClick={toggle} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, width: 12, marginTop: 2, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{t.name}</span>
            <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", fontFamily: "JetBrains Mono, monospace" }}>{t.rows.toLocaleString()} row{t.rows === 1 ? "" : "s"}</span>
            {t.redacted && <span style={{ fontSize: 9, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", padding: "1px 6px", borderRadius: 4, fontFamily: "JetBrains Mono, monospace" }}>TOKENS REDACTED</span>}
          </span>
          {TABLE_DOCS[t.name] && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.45 }}>{TABLE_DOCS[t.name]}</span>}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {["csv", "json"].map((f) => (
              <button key={f} onClick={() => switchFmt(f)} disabled={busy} style={{ fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
                border: `1px solid ${format === f ? "rgba(129,140,248,0.4)" : "rgba(255,255,255,0.12)"}`, background: format === f ? "rgba(99,102,241,0.15)" : "transparent", color: format === f ? "#a5b4fc" : "rgba(255,255,255,0.5)" }}>{f.toUpperCase()}</button>
            ))}
            {data && <CopyBtn text={data.text} />}
            <button onClick={doDownload} disabled={dl} style={{ fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "JetBrains Mono, monospace", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)" }}>{dl ? "…" : `DOWNLOAD .${format.toUpperCase()}`}</button>
            {truncated && <span style={{ fontSize: 10.5, color: "#fbbf24" }}>preview capped at {PREVIEW_CAP.toLocaleString()} of {data.total.toLocaleString()} — download for all</span>}
          </div>
          {busy && !data ? <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", padding: "8px 0" }}>Loading…</div> : data && (
            <pre style={{ margin: 0, padding: "12px 14px", borderRadius: 8, maxHeight: 320, overflow: "auto", background: "#0c0c12", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "JetBrains Mono, monospace", fontSize: 11.5, lineHeight: 1.55, color: "#d4d4e0", whiteSpace: "pre" }}>{data.text || "(empty)"}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", fontFamily: "JetBrains Mono, monospace", margin: "0 0 8px" }}>{children}</div>;
}

function DatabaseExport() {
  const [tables, setTables] = useState(null);
  const [filter, setFilter] = useState("");
  const [dump, setDump] = useState("");        // which bundle is generating
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => { listTables().then(setTables).catch(() => setTables([])); }, []);

  const fullDump = async (format) => {
    setDump(format);
    try {
      const text = await getFullDump(format);  // core scope (transient excluded)
      downloadText(`meridian-handover.${format === "sql" ? "sql" : "json"}`, text, format === "sql" ? "application/sql" : "application/json");
    } catch (e) { alert("Export failed: " + (e.message || e)); }
    setDump("");
  };

  const match = (t) => t.name.toLowerCase().includes(filter.toLowerCase());
  const core = (tables || []).filter((t) => t.core && match(t));
  const excluded = (tables || []).filter((t) => !t.core && match(t));
  const coreCount = (tables || []).filter((t) => t.core).length;
  const coreRows = (tables || []).filter((t) => t.core).reduce((a, t) => a + t.rows, 0);

  return (
    <div>
      <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.75, margin: "10px 0" }}>
        {md("This is where the data lives. Each table below is a spreadsheet of one kind of information, with a **plain-English note explaining what it holds**. This is a live, read-only export of the **transition-critical** data — factions & history (**including archived**), properties, NPCs, scene logs, arsenal, inventory, fleet, treasury, staff, config, documents & knowledge base — so it survives even if the website is switched off. Everyday clutter (pings, tasks, reminders, message/audit logs, logins) is **left out of the download** and tucked below.")}
      </p>
      <Note tone="warn">{md("This reads the database **at the moment you click** — regenerate right before handoff so it's current. Live session tokens (`sessions.token`, `mdb_sessions.token`) are redacted.")}</Note>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "16px 0 6px" }}>
        <button onClick={() => fullDump("sql")} disabled={!!dump} style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, cursor: "pointer", border: "none", background: "rgba(99,102,241,0.85)", color: "#fff", opacity: dump ? 0.5 : 1 }}>
          {dump === "sql" ? "Generating…" : "⬇ Handover data — SQL"}
        </button>
        <button onClick={() => fullDump("json")} disabled={!!dump} style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "rgba(255,255,255,0.7)", opacity: dump ? 0.5 : 1 }}>
          {dump === "json" ? "Generating…" : "⬇ Handover data — JSON"}
        </button>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>
          {tables ? `${coreCount} core tables · ${coreRows.toLocaleString()} rows` : "loading…"}
        </span>
      </div>
      <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", margin: "0 0 16px", lineHeight: 1.6 }}>
        {md("The bundle includes **only** the transition data below. **SQL** rebuilds it anywhere: `sqlite3 restored.db < meridian-handover.sql`. **JSON** is `{ tables: { name: [rows] } }`. Need a specific transient table too? Expand it below and download it on its own.")}
      </p>

      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tables… (e.g. properties, npcs, scene_logs, faction_history)"
        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, boxSizing: "border-box", marginBottom: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 13, outline: "none" }} />

      {!tables ? <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", padding: "8px 0" }}>Loading tables…</div> : (
        <>
          <GroupLabel>Included in handover — {core.length} table{core.length === 1 ? "" : "s"}</GroupLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {core.map((t) => <TableRow key={t.name} t={t} />)}
            {core.length === 0 && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", padding: "4px 0" }}>No included tables match “{filter}”.</div>}
          </div>

          {excluded.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <button onClick={() => setShowExcluded((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 8 }}>
                <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>{showExcluded ? "▾" : "▸"}</span>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", fontFamily: "JetBrains Mono, monospace" }}>
                  Excluded — transient &amp; logs · {excluded.length} · not in the bundle
                </span>
              </button>
              {showExcluded && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.7 }}>
                  {excluded.map((t) => <TableRow key={t.name} t={t} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function HandoverPage() {
  const auth = useAuth();
  const canAccess = !auth.loading && auth.level >= 3;

  if (auth.loading) return <div style={{ padding: "60px 24px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Loading…</div>;
  if (!canAccess) return <div style={{ padding: "60px 24px", textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Leadership access (L3) required.</div>;

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "12px 16px 80px" }}>
      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em", margin: 0 }}>Server Handover Runbook</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: "6px 0 0", lineHeight: 1.6 }}>
          {md("Written so **anyone can follow it** — no technical background assumed. It does two things: keep every piece of faction data safe forever, and let a tech-savvy helper put the whole system back up if you want to keep it running. **Begin with “Start here” below.** Restricted to **FM Leadership** and **Game Affairs Management**.")}
        </p>
      </div>

      {/* contents */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0 26px", padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)" }}>
        {RUNBOOK.map((s) => (
          <a key={s.id} href={`#${s.id}`} style={{ fontSize: 11.5, fontWeight: 600, color: "#a5b4fc", textDecoration: "none", padding: "3px 9px", borderRadius: 6, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
            {s.title}
          </a>
        ))}
        <a href="#dbexport" style={{ fontSize: 11.5, fontWeight: 600, color: "#a5b4fc", textDecoration: "none", padding: "3px 9px", borderRadius: 6, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
          12 · Database export
        </a>
      </div>

      {RUNBOOK.map((s) => (
        <section key={s.id} id={s.id} style={{ scrollMarginTop: 20, marginBottom: 30 }}>
          <h2 style={{ fontSize: 16.5, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em", margin: "0 0 4px", paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{s.title}</h2>
          {s.blocks.map((b, i) => <Block key={i} b={b} />)}
        </section>
      ))}

      <section id="dbexport" style={{ scrollMarginTop: 20, marginBottom: 30 }}>
        <h2 style={{ fontSize: 16.5, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em", margin: "0 0 4px", paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>12 · Database export (transition data)</h2>
        <DatabaseExport />
      </section>
    </div>
  );
}
