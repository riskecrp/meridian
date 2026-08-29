"use client";
// Admin › Handover: make Meridian movable. Three tabs —
//   Run it yourself   plain-English setup on any computer (SELF_HOST_GUIDE)
//   Export the data   downloads: CSV bundle for Google Sheets, the database, the code
//   Technical runbook the server-to-server migration runbook (RUNBOOK, shared with /fm/handover)
// L3-only; every download goes through /api/handover and is audit-logged.
import { useEffect, useState } from "react";
import { useCopy } from "../../hooks.js";
import { listTables, getTableExport } from "../../../fm/handover/actions.js";
import { RUNBOOK, SELF_HOST_GUIDE, TABLE_DOCS } from "../../../../lib/handoverContent.js";

/* ── inline markup: **bold** and `code` ── */
function md(text) {
  return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} style={{ color: "var(--ink-0)", fontWeight: 650 }}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={i} style={{ fontFamily: "var(--v2-mono)", fontSize: "0.9em", background: "var(--accent-bg)", color: "var(--accent-hi)", padding: "1px 5px", borderRadius: 4 }}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

const P = { fontSize: 13.5, color: "var(--ink-1)", lineHeight: 1.7, margin: "10px 0" };

function CodeBlock({ code, id }) {
  const [copied, copy] = useCopy();
  return (
    <div style={{ position: "relative", margin: "10px 0" }}>
      <button className={"copybtn" + (copied === id ? " done" : "")} onClick={() => copy(code, id)} style={{ position: "absolute", top: 6, right: 6, fontSize: 10 }}>{copied === id ? "Copied" : "Copy"}</button>
      <pre className="codeblock" style={{ margin: 0, paddingRight: 70, color: "var(--ink-0)", overflowX: "auto", whiteSpace: "pre" }}>{code}</pre>
    </div>
  );
}

function Note({ tone = "info", children }) {
  const c = tone === "warn" ? ["var(--amber)", "var(--amber-bg)", "⚠"] : tone === "danger" ? ["var(--rose)", "color-mix(in srgb, var(--rose) 10%, transparent)", "⛔"] : ["var(--accent)", "var(--accent-bg)", "ℹ"];
  return (
    <div style={{ display: "flex", gap: 10, padding: "10px 13px", margin: "10px 0", borderRadius: 8, background: c[1], borderLeft: `3px solid ${c[0]}` }}>
      <span style={{ color: c[0], flexShrink: 0 }}>{c[2]}</span>
      <div style={{ fontSize: 13, color: "var(--ink-1)", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function Block({ b, k }) {
  if (b.p) return <p style={P}>{md(b.p)}</p>;
  if (b.code) return <CodeBlock code={b.code} id={k} />;
  if (b.note) return <Note tone={b.note.tone}>{md(b.note.text)}</Note>;
  if (b.table) return (
    <div style={{ overflowX: "auto", margin: "10px 0" }}>
      <table className="dtable"><thead><tr>{b.table.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{b.table.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ lineHeight: 1.5 }}>{md(c)}</td>)}</tr>)}</tbody></table>
    </div>
  );
  if (b.ul) return <ul style={{ margin: "8px 0", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 }}>{b.ul.map((li, i) => <li key={i} style={{ ...P, margin: 0 }}>{md(li)}</li>)}</ul>;
  return null;
}

function Sections({ sections }) {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "0 0 22px" }}>
        {sections.map((s) => <a key={s.id} href={`#${s.id}`} className="pill" style={{ textDecoration: "none" }}>{s.title}</a>)}
      </div>
      {sections.map((s) => (
        <section key={s.id} id={s.id} className="card" style={{ scrollMarginTop: 20 }}>
          <div className="hd"><span className="t" style={{ textTransform: "none", fontSize: 14, letterSpacing: 0 }}>{s.title}</span></div>
          {s.blocks.map((b, i) => <Block key={i} k={`${s.id}-${i}`} b={b} />)}
        </section>
      ))}
    </>
  );
}

/* ── Export the data ── */
function downloadText(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Download({ href, title, desc, primary, size }) {
  return (
    <a href={href} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "13px 15px", borderRadius: 10, textDecoration: "none", border: `1px solid ${primary ? "transparent" : "var(--line)"}`, background: primary ? "var(--accent)" : "var(--panel)", color: primary ? "#fff" : "var(--ink-0)", minWidth: 0 }}>
      <span style={{ fontSize: 13.5, fontWeight: 650 }}>⬇ {title}</span>
      <span style={{ fontSize: 11.5, lineHeight: 1.5, opacity: primary ? 0.88 : 1, color: primary ? "#fff" : "var(--ink-2)" }}>{desc}</span>
      {size && <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10, opacity: 0.7 }}>{size}</span>}
    </a>
  );
}

function TableRow({ t }) {
  const [busy, setBusy] = useState(false);
  const dl = async () => {
    setBusy(true);
    try { const r = await getTableExport(t.name, "csv", 0); downloadText(`${t.name}.csv`, r.text, "text/csv"); } catch (e) { alert(e.message || "Export failed"); }
    setBusy(false);
  };
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--v2-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--ink-0)" }}>{t.name}</span>
          <span style={{ fontFamily: "var(--v2-mono)", fontSize: 10, color: "var(--ink-3)" }}>{t.rows.toLocaleString()} row{t.rows === 1 ? "" : "s"}</span>
          {!t.core && <span className="chip role">log / transient</span>}
          {t.redacted && <span className="chip lock">tokens redacted</span>}
        </div>
        {TABLE_DOCS[t.name] && <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45, marginTop: 2 }}>{TABLE_DOCS[t.name]}</div>}
      </div>
      <button className="act" onClick={dl} disabled={busy}>{busy ? "…" : "CSV"}</button>
    </div>
  );
}

function ExportTab() {
  const [tables, setTables] = useState(null);
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { listTables().then(setTables).catch(() => setTables([])); }, []);
  const core = (tables || []).filter((t) => t.core);
  const coreRows = core.reduce((a, t) => a + t.rows, 0);
  const shown = (tables || []).filter((t) => (showAll || t.core) && t.name.includes(filter.toLowerCase()));

  return (
    <div>
      <p style={P}>{md("Everything below reads the database **at the moment you click**, so it is always current. Nothing here needs a technical helper. Downloads are recorded in the audit log.")}</p>

      <div className="card">
        <div className="hd"><span className="t">For Google Sheets</span><span className="meta">{tables ? `${core.length} tables · ${coreRows.toLocaleString()} rows` : "…"}</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, margin: "12px 0" }}>
          <Download primary href="/api/handover?what=sheets" title="Download for Google Sheets" desc="One zip with a CSV file per table, a TABLES list explaining each one in plain English, and step-by-step import notes. The core data only — no pings, logs or logins." />
          <Download href="/api/handover?what=sheets&scope=all" title="Same, but every table" desc="Includes the message logs, audit log, tasks, reminders and other everyday clutter. Bigger; only if you want absolutely everything." />
        </div>
        <p style={{ ...P, fontSize: 12.5, color: "var(--ink-2)" }}>{md("**Then in Google Sheets:** *File → Import → Upload*, pick a CSV, choose *Insert new sheet(s)*. Each file becomes one tab. To import the lot in one go, upload the unzipped folder to Google Drive with *Settings → Convert uploads* switched on. Times in a column called `epoch_ms` are a big number; `=A2/86400000 + DATE(1970,1,1)` turns it into a date.")}</p>
      </div>

      <div className="card">
        <div className="hd"><span className="t">For running Meridian elsewhere</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10, margin: "12px 0" }}>
          <Download href="/api/handover?what=db" title="Download the database" desc="A clean, complete copy of meridian.db — every record. This is what the “Run it yourself” guide puts in the data folder. Also opens in the free DB Browser for SQLite." />
          <Download href="/api/handover?what=code" title="Download the code" desc="The website and bot source at the version running right now, as a zip. Same as the GitHub repository, no GitHub account needed." />
        </div>
        <p style={{ ...P, fontSize: 12.5, color: "var(--ink-2)" }}>{md("The nightly compressed backup is also available at `/api/backup`. Keep the database file somewhere safe: it is the only thing that can't be re-downloaded from the internet.")}</p>
      </div>

      <div className="card">
        <div className="hd">
          <span className="t">One table at a time</span>
          <div className="tabs">
            <button className={"tab" + (!showAll ? " on" : "")} onClick={() => setShowAll(false)}>Core</button>
            <button className={"tab" + (showAll ? " on" : "")} onClick={() => setShowAll(true)}>All tables</button>
          </div>
        </div>
        <input className="filter-inp" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tables…" style={{ margin: "10px 0 4px" }} />
        {!tables ? <div className="empty">Loading tables…</div>
          : shown.length === 0 ? <div className="empty">No tables match.</div>
          : shown.map((t) => <TableRow key={t.name} t={t} />)}
      </div>
    </div>
  );
}

export function Handover() {
  const [tab, setTab] = useState("guide");
  const TABS = [["guide", "Run it yourself"], ["export", "Export the data"], ["runbook", "Technical runbook"]];
  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <div className="sub-tabs">{TABS.map(([id, l]) => <button key={id} className={"tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>{l}</button>)}</div>
        {tab !== "export" && <button className="act" onClick={() => window.print()}>Print / save as PDF</button>}
      </div>
      {tab === "guide" && <>
        <p style={{ ...P, marginTop: 0 }}>{md("How to get this exact site and bot running on a computer you control, from nothing — **no server access, no coding**. If you only want the records in a spreadsheet, skip to **Export the data**.")}</p>
        <Sections sections={SELF_HOST_GUIDE} />
      </>}
      {tab === "export" && <ExportTab />}
      {tab === "runbook" && <>
        <p style={{ ...P, marginTop: 0 }}>{md("For a technical helper: moving the **live** server to a new host with its domain, services and Cloudflare tunnel intact. Assumes shell access to both machines.")}</p>
        <Sections sections={RUNBOOK} />
      </>}
    </div>
  );
}
