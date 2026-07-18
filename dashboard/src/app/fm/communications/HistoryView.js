"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import { getAnnouncementHistory } from "./actions";

// How each send is designated in the UI.
const CHANNEL_META = {
  command: { sub: "Command only",           badge: "COMMAND",       color: "#60a5fa" },
  faction: { sub: "Faction-wide only",      badge: "FACTION-WIDE",  color: "#4ade80" },
  both:    { sub: "Command + Faction-wide", badge: "BOTH",          color: "#a78bfa" },
};
const FM_META = { sub: "Faction Management", badge: "FACTION MGMT", color: "#a07ef5" };
function chanMeta(ct) { return CHANNEL_META[ct] || { sub: ct, badge: (ct || "").toUpperCase(), color: "#94a3b8" }; }

function fmtSent(created_at) {
  // Stored as UTC "YYYY-MM-DD HH:MM:SS" — parse as UTC, render in viewer's local time.
  const d = new Date((created_at || "").replace(" ", "T") + "Z");
  if (isNaN(d)) return created_at || "";
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const hm  = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${day}/${mon}/${d.getFullYear()} ${hm}`;
}

export default function HistoryView({ kind }) {
  const auth = useAuth();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading || (auth.level < 1 && !auth.isLeadStoryteller)) return;
    getAnnouncementHistory(kind).then(h => { setRows(h || []); setLoading(false); }).catch(() => setLoading(false));
  }, [auth.loading, auth.level, kind]);

  if (auth.loading || loading) {
    return <div style={{ padding: 40, color: "var(--fg-4)", fontSize: 13 }}>Loading…</div>;
  }

  const canSeeAll = auth.level >= 3 || auth.isLeadStoryteller;

  return (
    <div>
      {!canSeeAll && (
        <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 8 }}>Showing memos you sent.</div>
      )}
      <div style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-1)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "160px 90px 1fr 300px", gap: 16, padding: "11px 20px",
          borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          letterSpacing: "0.08em", color: "var(--fg-4)" }}>
          <div>Sent</div><div>By</div><div>Message</div><div>Deliveries</div>
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: "var(--fg-4)", fontStyle: "italic" }}>
            Nothing sent yet.
          </div>
        ) : rows.map((r, i) => <HistoryRow key={r.id} row={r} first={i === 0} />)}
      </div>
    </div>
  );
}

function HistoryRow({ row, first }) {
  const [expanded, setExpanded] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [showImg, setShowImg]   = useState(false);
  const isIC = row.kind === "ic";

  // A send with no faction recipients that still posted to the FM Discord is an
  // announcement TO Faction Management — designate it distinctly from a faction memo.
  const factionDeliveries = row.deliveries.filter(d => d.channel_type !== "FM Discord");
  const fmOnly = !isIC && factionDeliveries.length === 0 && (row.posted_to_fm || row.deliveries.some(d => d.channel_type === "FM Discord"));
  const meta = fmOnly ? FM_META : chanMeta(row.channel_type);

  const title  = isIC ? "A Message from Meridian" : "A Message from Faction Management";
  const body   = (row.message || "").trim();
  const preview = body || (isIC ? "(image communication — no caption)" : "(no text)");
  const allOk  = row.total_count > 0 && row.sent_count >= row.total_count;
  const showChan = row.channel_type === "both";

  // Backfilled FM-only sends have no delivery rows — synthesize a single line.
  const deliveryLines = (fmOnly && row.deliveries.length === 0)
    ? [{ id: "fm", faction_name: "Faction Management", channel_type: "FM Discord", ok: row.sent_count > 0, error: "" }]
    : row.deliveries;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px 90px 1fr 300px", gap: 16, padding: "16px 20px",
      borderTop: first ? "none" : "1px solid var(--border)", alignItems: "start" }}>

      {/* Sent */}
      <div>
        <div style={{ fontSize: 12, color: "var(--fg-1)", fontWeight: 500 }}>{fmtSent(row.created_at)}</div>
        <div style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 2 }}>{meta.sub}</div>
      </div>

      {/* By */}
      <div style={{ fontSize: 12, color: "var(--fg-2)", wordBreak: "break-word" }}>{row.author_name || "—"}</div>

      {/* Message */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-0)" }}>{title}</span>
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, letterSpacing: "0.04em",
            background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30`, fontFamily: "var(--font-mono)" }}>
            {meta.badge}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.5, whiteSpace: "pre-wrap",
          ...(showFull ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>
          {preview}
        </div>
        {isIC && row.link && (
          <div style={{ marginTop: 4 }}>
            <button onClick={() => setShowImg(v => !v)} style={{ fontSize: 11, color: "var(--accent)",
              background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              {showImg ? "Hide image" : "View image"}
            </button>
            {showImg && (
              <div style={{ marginTop: 6 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={row.link} alt="IC communication" onError={e => { e.target.style.display = "none"; }}
                  style={{ display: "block", maxWidth: "100%", maxHeight: 320, borderRadius: 8, border: "1px solid var(--border)" }} />
                <a href={row.link} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 4, fontSize: 10, color: "var(--fg-4)" }}>Open original ↗</a>
              </div>
            )}
          </div>
        )}
        {body.length > 90 && (
          <button onClick={() => setShowFull(v => !v)} style={{ display: "block", marginTop: 4, fontSize: 11,
            color: "var(--accent)", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
            {showFull ? "Show less" : "View full message"}
          </button>
        )}
      </div>

      {/* Deliveries */}
      <div>
        <button onClick={() => setExpanded(v => !v)} style={{ display: "flex", alignItems: "center", gap: 6,
          fontSize: 12, fontWeight: 700, background: "none", border: "none", padding: 0, cursor: "pointer",
          color: allOk ? "#34d399" : (row.sent_count > 0 ? "#fbbf24" : "var(--red)") }}>
          <span style={{ fontSize: 9 }}>{expanded ? "▼" : "▶"}</span>
          {row.sent_count}/{row.total_count} sent
        </button>
        {/* Faction sends that also pinged FM: note it without counting it as a delivery. */}
        {!fmOnly && !isIC && row.posted_to_fm ? (
          <div style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 3 }}>+ also posted to Faction Management</div>
        ) : null}
        {expanded && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {deliveryLines.length === 0 && <span style={{ fontSize: 11, color: "var(--fg-4)" }}>No delivery records.</span>}
            {deliveryLines.map(d => (
              <div key={d.id} style={{ fontSize: 11, lineHeight: 1.4, color: d.ok ? "#4ade80" : "#f87171" }}>
                {d.ok ? "✓" : "✗"} {d.faction_name}
                {showChan && d.channel_type ? ` (${d.channel_type})` : ""}
                {!d.ok && d.error ? `: ${d.error}` : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
