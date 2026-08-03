"use client";
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../lib/useAuth";
import { getAnnouncementTargets, sendAnnouncement, sendICCommunication, uploadToImgbb, getAnnouncementHistory } from "../../fm/communications/actions.js";

const tierBand = (t) => (t >= 7 ? "hi" : t >= 4 ? "mid" : "lo");
const CH_OPTS = [{ v: "command", l: "Command" }, { v: "faction", l: "Faction-wide" }, { v: "both", l: "Both" }];
const chLabel = (ct) => ct === "faction" ? "Faction-wide" : ct === "both" ? "Command + Faction-wide" : "Command";

function hasChan(t, ct) { return ct === "command" ? !!t.comms_channel_id : ct === "faction" ? !!t.faction_channel_id : (!!t.comms_channel_id || !!t.faction_channel_id); }
function chanSummary(t, ct) {
  const p = [];
  if (ct !== "faction" && t.comms_channel_id) p.push("#" + (t.comms_channel_name || t.comms_channel_id).replace(/^#/, ""));
  if (ct !== "command" && t.faction_channel_id) p.push("#" + (t.faction_channel_name || t.faction_channel_id).replace(/^#/, ""));
  return p.join("  ·  ");
}

/* Shared recipient selector + channel-type toggle */
function Recipients({ targets, ct, setCt, selected, setSelected }) {
  const configurable = useMemo(() => targets.filter(t => hasChan(t, ct)), [targets, ct]);
  const unconfigured = useMemo(() => targets.filter(t => !hasChan(t, ct)), [targets, ct]);
  const allSel = configurable.length > 0 && configurable.every(t => selected.has(t.config_id));
  useEffect(() => { setSelected(prev => new Set([...prev].filter(id => targets.some(t => t.config_id === id && hasChan(t, ct))))); }, [ct]); // prune on narrow
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="hd"><div className="t">Send to</div></div>
        <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-2)", marginTop: 6 }}>
          {CH_OPTS.map(o => <button key={o.v} className="tab" style={{ flex: 1, background: ct === o.v ? "var(--accent)" : "transparent", color: ct === o.v ? "#fff" : "var(--ink-2)" }} onClick={() => setCt(o.v)}>{o.l}</button>)}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink-3)" }}>
          {ct === "command" ? "Leadership command channels only." : ct === "faction" ? "Whole-faction channels — visible to all members." : "Both command and faction-wide channels."}
        </div>
      </div>
      <div className="card">
        <div className="hd"><div className="t">Recipients</div><button className="act" onClick={() => setSelected(allSel ? new Set() : new Set(configurable.map(t => t.config_id)))}>{allSel ? "Deselect all" : "Select all"}</button></div>
        {targets.length === 0 ? <div className="empty">No factions configured.</div> : <>
          {configurable.map(t => {
            const on = selected.has(t.config_id);
            return (
              <div key={t.config_id} onClick={() => toggle(t.config_id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px", margin: "0 -8px", borderBottom: "1px solid var(--line)", cursor: "pointer", background: on ? "var(--accent-bg)" : "transparent", borderRadius: 6 }}>
                <input type="checkbox" checked={on} onChange={() => {}} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-0)" }}>{t.name}</span><span className={`tier ${tierBand(t.tier)}`}>T{t.tier}</span></div>
                  <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1, fontFamily: "var(--v2-mono)" }}>{t.guild_name ? t.guild_name + " · " : ""}{chanSummary(t, ct)}</div>
                </div>
              </div>
            );
          })}
          {unconfigured.length > 0 && <>
            <div style={{ padding: "8px 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>No {chLabel(ct)} channel set</div>
            {unconfigured.map(t => (
              <div key={t.config_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)", opacity: 0.45 }}>
                <input type="checkbox" disabled />
                <div><span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-0)" }}>{t.name}</span> <span className={`tier ${tierBand(t.tier)}`}>T{t.tier}</span><div style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{t.guild_name || "No server name"} · Channel not configured</div></div>
              </div>
            ))}
          </>}
          <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--ink-3)" }}>{selected.size} of {configurable.length} selected{unconfigured.length > 0 ? ` · ${unconfigured.length} without a ${chLabel(ct)} channel` : ""}</div>
        </>}
      </div>
    </div>
  );
}

function Result({ r }) {
  if (!r) return null;
  return (
    <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: r.ok ? "var(--good-bg)" : "var(--rose-bg)", border: `1px solid ${r.ok ? "color-mix(in srgb,var(--good) 30%,transparent)" : "color-mix(in srgb,var(--rose) 30%,transparent)"}` }}>
      {r.ok ? <>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--good)" }}>
          {r.total > 0 && `✓ Sent to ${r.sent} of ${r.total} ${r.channelLabel || ""} channel${r.total !== 1 ? "s" : ""}`}
          {r.postedToFM && `${r.total > 0 ? " · " : "✓ "}Posted in FM Discord`}
          {r.link !== undefined && r.total > 0 ? " · link copied to FM IC channel" : ""}
        </div>
        {r.failed?.length > 0 && <div style={{ fontSize: 11, color: "var(--rose)", marginTop: 3 }}>Failed: {r.failed.map(f => `${f.name} (${f.reason || f.status})`).join(", ")}</div>}
      </> : <div style={{ fontSize: 12.5, color: "var(--rose)" }}>✗ {r.error}</div>}
    </div>
  );
}

export default function V2CommsPage() {
  return <Suspense fallback={<div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>}><V2Comms /></Suspense>;
}

const COMMS_TABS = ["announce", "ic", "history"];

function V2Comms() {
  const auth = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const isL3 = (auth?.level || 0) >= 3;
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const tabParam = sp.get("tab");
  const tab = COMMS_TABS.includes(tabParam) ? tabParam : "announce";
  const setTab = (id) => router.replace(`/v2/comms${id === "announce" ? "" : `?tab=${id}`}`, { scroll: false });

  useEffect(() => { if (!auth?.loading && (auth?.level >= 1 || auth?.isLeadStoryteller)) getAnnouncementTargets().then(t => { setTargets(t || []); setLoading(false); }); }, [auth?.loading]);
  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;

  return (
    <div className="view">
      <div className="page-head">
        <div><p className="eyebrow">Communications</p><h1>Comms</h1><div className="sub">Broadcast to faction Discords, and see what was delivered.</div></div>
      </div>
      <div className="hub-tabs">
        {[["announce", "Announcement"], ["ic", "IC Communication"], ["history", "History"]].map(([v, l]) => <button key={v} className={`hub-tab${tab === v ? " on" : ""}`} onClick={() => setTab(v)}>{l}</button>)}
      </div>
      {tab === "announce" && <Announce targets={targets} isL3={isL3} />}
      {tab === "ic" && <IC targets={targets} />}
      {tab === "history" && <History auth={auth} />}
    </div>
  );
}

function Announce({ targets, isL3 }) {
  const [ct, setCt] = useState("command");
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage] = useState("");
  const [postToFM, setPostToFM] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const canSend = message.trim() && (selected.size > 0 || (isL3 && postToFM));
  const send = async () => { setSending(true); setResult(null); const r = await sendAnnouncement([...selected], message, postToFM, ct); setSending(false); setResult(r); if (r.ok) { setMessage(""); setSelected(new Set()); setPostToFM(false); } };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 32, alignItems: "start" }}>
      <div>
        <div className="card"><div className="hd"><div className="t">Message</div></div>
          <div className="codeblock" style={{ color: "var(--ink-1)", marginBottom: 10 }}><b style={{ color: "var(--ink-0)" }}>A Message from Faction Management</b>{message.trim() ? `\n\n${message.trim()}` : "\n\nYour message will appear here…"}</div>
          <textarea className="filter-inp" rows={8} placeholder="Type your announcement…" value={message} onChange={e => setMessage(e.target.value)} />
          {isL3 && <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12.5, color: "var(--ink-1)" }}><input type="checkbox" checked={postToFM} onChange={e => setPostToFM(e.target.checked)} /> Also post in FM Discord <span style={{ color: "var(--ink-3)", fontSize: 11 }}>— pings @Faction Management</span></label>}
          <div style={{ marginTop: 12 }}>
            <button className="btn" disabled={sending || !canSend} onClick={send} style={{ opacity: sending || !canSend ? 0.45 : 1 }}>
              {sending ? "Sending…" : (() => { const p = [selected.size > 0 && `${selected.size} faction${selected.size !== 1 ? "s" : ""} · ${chLabel(ct)}`, postToFM && "FM Discord"].filter(Boolean); return p.length ? `Send → ${p.join("  +  ")}` : "Send"; })()}
            </button>
          </div>
          <Result r={result} />
        </div>
      </div>
      <Recipients targets={targets} ct={ct} setCt={setCt} selected={selected} setSelected={setSelected} />
    </div>
  );
}

function IC({ targets }) {
  const [ct, setCt] = useState("command");
  const [selected, setSelected] = useState(new Set());
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const processFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) { setUploadErr("Please select an image file."); return; }
    setUploading(true); setUploadErr(""); setLink("");
    const reader = new FileReader();
    reader.onload = async (e) => { const b64 = e.target.result.split(",")[1]; const res = await uploadToImgbb(b64, file.name); setUploading(false); if (res.ok) setLink(res.url); else setUploadErr(res.error || "Upload failed."); };
    reader.readAsDataURL(file);
  }, []);
  const send = async () => { setSending(true); setResult(null); const r = await sendICCommunication([...selected], link, message, ct); setSending(false); setResult(r); if (r.ok && r.sent > 0) { setLink(""); setMessage(""); setSelected(new Set()); } };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 32, alignItems: "start" }}>
      <div>
        <div className="card">
          <div className="hd"><div className="t">Image <span style={{ color: "var(--rose)" }}>*</span></div></div>
          <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processFile(f); }} onClick={() => !uploading && fileRef.current?.click()}
            style={{ padding: "20px 16px", borderRadius: 8, textAlign: "center", cursor: uploading ? "wait" : "pointer", border: `2px dashed ${dragging ? "var(--accent)" : "var(--line-2)"}`, background: dragging ? "var(--accent-bg)" : "var(--panel-2)", marginTop: 6 }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ""; }} />
            {uploading ? <div style={{ fontSize: 13, color: "var(--accent)" }}>Uploading to imgbb…</div> : link ? <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>✓ Uploaded — click or drop to replace</div> : <div><div style={{ fontSize: 13, color: "var(--ink-1)" }}>Drop image here or <span style={{ color: "var(--accent)", fontWeight: 600 }}>click to browse</span></div><div style={{ fontSize: 11, color: "var(--ink-3)" }}>PNG, JPG, GIF, WEBP</div></div>}
          </div>
          {uploadErr && <div className="err" style={{ marginTop: 6 }}>✗ {uploadErr}</div>}
          {link && <div style={{ marginTop: 8, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line)", position: "relative", maxHeight: 220, display: "flex", justifyContent: "center" }}>
            <img src={link} alt="Preview" onError={e => e.target.style.display = "none"} style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain" }} />
            <button className="act" style={{ position: "absolute", top: 6, right: 6 }} onClick={e => { e.stopPropagation(); setLink(""); }}>Remove</button>
          </div>}
        </div>
        <div className="card">
          <div className="hd"><div className="t">Message <span style={{ color: "var(--ink-3)", fontWeight: 400, textTransform: "none" }}>(optional)</span></div></div>
          <textarea className="filter-inp" rows={4} placeholder="Optional accompanying message…" value={message} onChange={e => setMessage(e.target.value)} style={{ marginTop: 6 }} />
          <div className="codeblock" style={{ color: "var(--ink-1)", marginTop: 10 }}><b style={{ color: "var(--ink-0)" }}>A Message from Meridian</b>{message.trim() ? `\n\n${message.trim()}` : ""}{link.trim() ? "\n\n[image renders here]" : "\n\nPaste a link above to attach an image"}</div>
          <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 6 }}>FM IC channel receives: link only</div>
          <div style={{ marginTop: 12 }}><button className="btn" disabled={sending || !link.trim() || !selected.size} onClick={send} style={{ opacity: sending || !link.trim() || !selected.size ? 0.45 : 1 }}>{sending ? "Sending…" : `Send → ${selected.size} faction${selected.size !== 1 ? "s" : ""} · ${chLabel(ct)}`}</button></div>
          <Result r={result} />
        </div>
      </div>
      <Recipients targets={targets} ct={ct} setCt={setCt} selected={selected} setSelected={setSelected} />
    </div>
  );
}

const CH_META = { command: { sub: "Command only", badge: "COMMAND", color: "var(--sky)" }, faction: { sub: "Faction-wide only", badge: "FACTION-WIDE", color: "var(--good)" }, both: { sub: "Command + Faction-wide", badge: "BOTH", color: "var(--accent)" } };
const FM_META = { sub: "Faction Management", badge: "FACTION MGMT", color: "var(--lock)" };
function fmtSent(s) { const d = new Date((s || "").replace(" ", "T") + "Z"); if (isNaN(d)) return s || ""; return `${String(d.getDate()).padStart(2, "0")}/${d.toLocaleString("en-US", { month: "short" }).toUpperCase()}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }

function History({ auth }) {
  const [kind, setKind] = useState("announcement");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const canSeeAll = auth.level >= 3 || auth.isLeadStoryteller;
  useEffect(() => { setLoading(true); getAnnouncementHistory(kind).then(h => { setRows(h || []); setLoading(false); }).catch(() => setLoading(false)); }, [kind]);
  return (
    <>
      <div className="sub-tabs" style={{ marginBottom: 14 }}>
        <button className={`tab${kind === "announcement" ? " on" : ""}`} onClick={() => setKind("announcement")}>Announcements</button>
        <button className={`tab${kind === "ic" ? " on" : ""}`} onClick={() => setKind("ic")}>IC</button>
      </div>
      {!canSeeAll && <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 8 }}>Showing memos you sent.</div>}
      {loading ? <div className="empty">Loading…</div> : rows.length === 0 ? <div className="empty">Nothing sent yet.</div> : (
        <div className="card">{rows.map(r => <HistRow key={r.id} row={r} />)}</div>
      )}
    </>
  );
}

function HistRow({ row }) {
  const [exp, setExp] = useState(false);
  const [full, setFull] = useState(false);
  const [img, setImg] = useState(false);
  const isIC = row.kind === "ic";
  const factionDel = (row.deliveries || []).filter(d => d.channel_type !== "FM Discord");
  const fmOnly = !isIC && factionDel.length === 0 && (row.posted_to_fm || (row.deliveries || []).some(d => d.channel_type === "FM Discord"));
  const meta = fmOnly ? FM_META : (CH_META[row.channel_type] || { sub: row.channel_type, badge: (row.channel_type || "").toUpperCase(), color: "var(--ink-2)" });
  const title = isIC ? "A Message from Meridian" : "A Message from Faction Management";
  const body = (row.message || "").trim();
  const preview = body || (isIC ? "(image communication — no caption)" : "(no text)");
  const allOk = row.total_count > 0 && row.sent_count >= row.total_count;
  const showChan = row.channel_type === "both";
  const lines = (fmOnly && (row.deliveries || []).length === 0) ? [{ id: "fm", faction_name: "Faction Management", channel_type: "FM Discord", ok: row.sent_count > 0, error: "" }] : (row.deliveries || []);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 80px 1fr 260px", gap: 14, padding: "14px 0", borderBottom: "1px solid var(--line)", alignItems: "start" }}>
      <div><div style={{ fontSize: 12, color: "var(--ink-1)", fontWeight: 500 }}>{fmtSent(row.created_at)}</div><div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>{meta.sub}</div></div>
      <div style={{ fontSize: 12, color: "var(--ink-2)", wordBreak: "break-word" }}>{row.author_name || "—"}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-0)" }}>{title}</span>
          <span className="chip" style={{ background: `color-mix(in srgb, ${meta.color} 15%, transparent)`, color: meta.color }}>{meta.badge}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.5, whiteSpace: "pre-wrap", ...(full ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }) }}>{preview}</div>
        {isIC && row.link && <div style={{ marginTop: 4 }}><button className="act" style={{ padding: "2px 8px" }} onClick={() => setImg(v => !v)}>{img ? "Hide image" : "View image"}</button>{img && <div style={{ marginTop: 6 }}><img src={row.link} alt="IC" onError={e => e.target.style.display = "none"} style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8, border: "1px solid var(--line)" }} /><a href={row.link} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 4, fontSize: 10, color: "var(--ink-3)" }}>Open original ↗</a></div>}</div>}
        {body.length > 90 && <button className="act" style={{ padding: 0, background: "none", border: "none", color: "var(--accent)", marginTop: 4 }} onClick={() => setFull(v => !v)}>{full ? "Show less" : "View full message"}</button>}
      </div>
      <div>
        <button onClick={() => setExp(v => !v)} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, background: "none", border: "none", padding: 0, cursor: "pointer", color: allOk ? "var(--good)" : row.sent_count > 0 ? "var(--amber)" : "var(--rose)" }}><span style={{ fontSize: 9 }}>{exp ? "▼" : "▶"}</span>{row.sent_count}/{row.total_count} sent</button>
        {!fmOnly && !isIC && row.posted_to_fm ? <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 3 }}>+ also posted to Faction Management</div> : null}
        {exp && <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>{lines.length === 0 ? <span style={{ fontSize: 11, color: "var(--ink-3)" }}>No delivery records.</span> : lines.map(d => <div key={d.id} style={{ fontSize: 11, color: d.ok ? "var(--good)" : "var(--rose)" }}>{d.ok ? "✓" : "✗"} {d.faction_name}{showChan && d.channel_type ? ` (${d.channel_type})` : ""}{!d.ok && d.error ? `: ${d.error}` : ""}</div>)}</div>}
      </div>
    </div>
  );
}
