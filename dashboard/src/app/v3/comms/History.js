"use client";
// Comms › Send history: announcement and IC sends with their per-faction
// delivery reports (L3 sees everything, team leads their own sends), a retry
// for the factions that failed, and the per-faction IC thread (what one
// faction has actually received).
import { useEffect, useState } from "react";
import { getAnnouncementHistory, getFactionICThread, sendAnnouncement, sendICCommunication } from "../../fm/communications/actions.js";
import { Card, Badge, Button, Empty, Field, useAction } from "../ui.js";
import { hasChan } from "./Send.js";

const CH_META = { command: { sub: "Command only", badge: "COMMAND", tone: "info" }, faction: { sub: "Faction-wide only", badge: "FACTION-WIDE", tone: "good" }, both: { sub: "Command + Faction-wide", badge: "BOTH", tone: "accent" } };
const FM_META = { sub: "Faction Management", badge: "FACTION MGMT", tone: "lock" };
// announcement_log timestamps are UTC SQLite strings; show them in the viewer's zone.
export function fmtSent(s) { const d = new Date((s || "").replace(" ", "T") + "Z"); if (Number.isNaN(d.getTime())) return s || ""; return `${String(d.getDate()).padStart(2, "0")}/${d.toLocaleString("en-US", { month: "short" }).toUpperCase()}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }

const KINDS = [["announcement", "Announcements"], ["ic", "IC"], ["thread", "IC by faction"]];

export function History({ auth, targets, presetFaction }) {
  const [kind, setKind] = useState(presetFaction ? "thread" : "announcement");
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const canSeeAll = (auth?.level || 0) >= 3;
  const load = () => {
    if (kind === "thread") return;
    setRows(null); setErr("");
    getAnnouncementHistory(kind).then(h => setRows(h || [])).catch(e => { setErr(e?.message || "Could not load the history."); setRows([]); });
  };
  useEffect(() => { load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <div className="chips">{KINDS.map(([id, l]) => <button key={id} type="button" className={`chip${kind === id ? " on" : ""}`} onClick={() => setKind(id)}>{l}</button>)}</div>
      {kind === "thread" ? <ICThread targets={targets} presetFaction={presetFaction} /> : <>
        {!canSeeAll && <div className="faint tiny">Showing memos you sent.</div>}
        {err && <div className="err">{err}</div>}
        {rows === null ? <div className="skeleton skel-lg" /> : rows.length === 0 ? <Empty title="Nothing sent yet" /> : (
          <Card>{rows.map(r => <HistRow key={r.id} row={r} targets={targets} onRetried={load} />)}</Card>
        )}
      </>}
    </div>
  );
}

// The IC memos one faction has actually received (faction_ic_messages — one
// row per faction per successful send), newest first.
function ICThread({ targets, presetFaction }) {
  const options = [...(targets || [])].sort((a, b) => a.name.localeCompare(b.name));
  const [fid, setFid] = useState(() => (presetFaction && options.some(t => t.faction_id === presetFaction) ? presetFaction : options[0]?.faction_id) || "");
  const [rows, setRows] = useState(null);
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!fid) { setRows([]); return; }
    setRows(null);
    getFactionICThread(fid).then(r => setRows(r || [])).catch(() => setRows([]));
  }, [fid]);
  return (
    <Card title="IC thread" right={
      <Field><select value={fid} onChange={e => setFid(Number(e.target.value) || "")} aria-label="Faction">
        {!options.length && <option value="">No factions configured</option>}
        {options.map(t => <option key={t.faction_id} value={t.faction_id}>{t.name} (T{t.tier})</option>)}
      </select></Field>}>
      {!fid ? <Empty title="Pick a faction" /> : rows === null ? <div className="skeleton skel-md" /> : rows.length === 0 ? <Empty title="No IC memos have reached this faction yet" /> : rows.map(m => (
        <div key={m.id} className="hist hist3">
          <div className="when">{fmtSent(m.created_at)}</div>
          <span className="who">{m.author_name || "—"}</span>
          <div>
            <div className="body">{(m.message || "").trim() || "(image communication — no caption)"}</div>
            {m.link && <div>
              <Button variant="quiet" size="sm" onClick={() => setImg(img === m.id ? null : m.id)}>{img === m.id ? "Hide image" : "View image"}</Button>
              {img === m.id && <div><img className="icimg" src={m.link} alt="IC" onError={e => { e.target.style.display = "none"; }} /><a href={m.link} target="_blank" rel="noreferrer" className="faint tiny">Open original ↗</a></div>}
            </div>}
          </div>
        </div>
      ))}
    </Card>
  );
}

function HistRow({ row, targets, onRetried }) {
  const [exp, setExp] = useState(false);
  const [full, setFull] = useState(false);
  const [img, setImg] = useState(false);
  const [retryMsg, setRetryMsg] = useState("");
  const { run, busy } = useAction();

  // Re-send this message to just the factions whose delivery failed, at the
  // same channel granularity as the original failure. Creates a fresh history
  // row (it IS a new send). The message text and image link are unchanged.
  const isIC = row.kind === "ic";
  const failed = (row.deliveries || []).filter(d => !d.ok && d.channel_type !== "FM Discord");
  const canRetry = failed.length > 0 && (targets || []).length > 0 && (!isIC || row.link);
  const retryFailed = () => {
    if (!window.confirm(`Resend this ${isIC ? "IC communication" : "announcement"} to the ${failed.length} failed faction${failed.length !== 1 ? "s" : ""}?`)) return;
    run(async () => {
      const byCt = { command: new Set(), faction: new Set() };
      let unmatched = 0;
      failed.forEach(d => {
        const t = (targets || []).find(x => x.faction_id === d.faction_id || x.name === d.faction_name);
        if (!t) { unmatched++; return; }
        const ct = d.channel_type === "Faction-wide" ? "faction" : "command";
        if (hasChan(t, ct)) byCt[ct].add(t.config_id); else unmatched++;
      });
      let sent = 0, total = 0; const errs = [];
      for (const ct of ["command", "faction"]) {
        const ids = [...byCt[ct]];
        if (!ids.length) continue;
        const r = isIC
          ? await sendICCommunication(ids, row.link, row.message || "", ct).catch(e => ({ ok: false, error: e?.message || "Send failed" }))
          : await sendAnnouncement(ids, row.message || "", false, ct).catch(e => ({ ok: false, error: e?.message || "Send failed" }));
        sent += r?.sent || 0; total += r?.total || ids.length;
        if (!r?.ok && r?.error) errs.push(r.error);
      }
      const msg = `Resent ${sent}/${total}${unmatched ? ` · ${unmatched} no longer configured` : ""}${errs.length ? ` · ${errs.join("; ")}` : ""}`;
      setRetryMsg(msg);
      onRetried?.();   // a failed resend still writes its own log row
      return sent > 0 ? { ok: true, notice: msg } : { ok: false, error: msg };
    });
  };

  const factionDel = (row.deliveries || []).filter(d => d.channel_type !== "FM Discord");
  const fmOnly = !isIC && factionDel.length === 0 && (row.posted_to_fm || (row.deliveries || []).some(d => d.channel_type === "FM Discord"));
  const meta = fmOnly ? FM_META : (CH_META[row.channel_type] || { sub: row.channel_type, badge: (row.channel_type || "").toUpperCase(), tone: undefined });
  const title = isIC ? "A Message from Meridian" : "A Message from Faction Management";
  const body = (row.message || "").trim();
  const preview = body || (isIC ? "(image communication — no caption)" : "(no text)");
  const allOk = row.total_count > 0 && row.sent_count >= row.total_count;
  const tone = allOk ? "tone-good" : row.sent_count > 0 ? "tone-warn" : "tone-bad";
  const showChan = row.channel_type === "both";
  const lines = (fmOnly && (row.deliveries || []).length === 0) ? [{ id: "fm", faction_name: "Faction Management", channel_type: "FM Discord", ok: row.sent_count > 0, error: "" }] : (row.deliveries || []);
  return (
    <div className="hist">
      <div><div className="when">{fmtSent(row.created_at)}</div><div className="faint tiny">{meta.sub}</div><span className="who">{row.author_name || "—"}</span></div>
      <div>
        <div className="row"><span className="ttl">{title}</span><Badge tone={meta.tone}>{meta.badge}</Badge></div>
        <div className={`body${full ? "" : " clamp2"}`}>{preview}</div>
        {isIC && row.link && <div><Button variant="quiet" size="sm" onClick={() => setImg(v => !v)}>{img ? "Hide image" : "View image"}</Button>{img && <div><img className="icimg" src={row.link} alt="IC" onError={e => { e.target.style.display = "none"; }} /><a href={row.link} target="_blank" rel="noreferrer" className="faint tiny">Open original ↗</a></div>}</div>}
        {body.length > 90 && <button type="button" className="linkbtn" onClick={() => setFull(v => !v)}>{full ? "Show less" : "View full message"}</button>}
      </div>
      <div>
        <button type="button" className={`linkbtn ${tone}`} onClick={() => setExp(v => !v)} aria-expanded={exp}>{exp ? "▼" : "▶"} {row.sent_count}/{row.total_count} sent</button>
        {!fmOnly && !isIC && row.posted_to_fm ? <div className="faint tiny">+ also posted to Faction Management</div> : null}
        {exp && <div className="deliv">{lines.length === 0 ? <span className="faint">No delivery records.</span> : lines.map(d => <div key={d.id} className={d.ok ? "ok" : "ko"}>{d.ok ? "✓" : "✗"} {d.faction_name}{showChan && d.channel_type ? ` (${d.channel_type})` : ""}{!d.ok && d.error ? `: ${d.error}` : ""}</div>)}</div>}
        {canRetry && !retryMsg && <div><Button variant="ghost" size="sm" disabled={busy} onClick={retryFailed}>{busy ? "Resending…" : `Retry failed (${failed.length})`}</Button></div>}
        {retryMsg && <div className={`small ${retryMsg.startsWith("Resent 0/") ? "tone-bad" : "tone-good"}`}>{retryMsg.startsWith("Resent 0/") ? "✗" : "✓"} {retryMsg}</div>}
      </div>
    </div>
  );
}
