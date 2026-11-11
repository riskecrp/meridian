"use client";
// Comms › Announcement and IC communication: the two send forms and the
// recipient picker they share. Server actions (fm/communications/actions.js)
// gate at L2 and scope the targets to the actor's team; L3 may also mirror an
// announcement into the FM Discord.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { sendAnnouncement, sendICCommunication, uploadToImgbb } from "../../fm/communications/actions.js";
import { Card, Badge, Button, Empty, useAction } from "../ui.js";

export const CH_OPTS = [{ v: "command", l: "Command" }, { v: "faction", l: "Faction-wide" }, { v: "both", l: "Both" }];
export const chLabel = (ct) => ct === "faction" ? "Faction-wide" : ct === "both" ? "Command + Faction-wide" : "Command";
export function hasChan(t, ct) { return ct === "command" ? !!t.comms_channel_id : ct === "faction" ? !!t.faction_channel_id : (!!t.comms_channel_id || !!t.faction_channel_id); }
const tierTone = (t) => (t >= 7 ? "good" : t >= 4 ? "info" : undefined);
function chanSummary(t, ct) {
  const p = [];
  if (ct !== "faction" && t.comms_channel_id) p.push("#" + (t.comms_channel_name || t.comms_channel_id).replace(/^#/, ""));
  if (ct !== "command" && t.faction_channel_id) p.push("#" + (t.faction_channel_name || t.faction_channel_id).replace(/^#/, ""));
  return p.join("  ·  ");
}

/** Preselect the faction named by ?faction=<id> once the targets are known (only if it has a channel of the chosen type). */
function usePresetFaction(targets, presetFaction, ct, setSelected) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !presetFaction || !targets?.length) return;
    const t = targets.find(x => x.faction_id === presetFaction);
    if (!t) { done.current = true; return; }
    if (hasChan(t, ct)) { setSelected(s => new Set([...s, t.config_id])); done.current = true; }
  }, [targets, presetFaction, ct, setSelected]);
}

/* Shared recipient selector + channel-type toggle */
export function Recipients({ targets, ct, setCt, selected, setSelected, isL3 }) {
  const configurable = useMemo(() => targets.filter(t => hasChan(t, ct)), [targets, ct]);
  const unconfigured = useMemo(() => targets.filter(t => !hasChan(t, ct)), [targets, ct]);
  const allSel = configurable.length > 0 && configurable.every(t => selected.has(t.config_id));
  // Narrowing the channel type drops recipients that no longer qualify.
  useEffect(() => { setSelected(prev => new Set([...prev].filter(id => targets.some(t => t.config_id === id && hasChan(t, ct))))); }, [ct]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="stack">
      <Card title="Send to">
        <div className="seg" role="radiogroup">
          {CH_OPTS.map(o => <button key={o.v} type="button" role="radio" aria-checked={ct === o.v} className={ct === o.v ? "on" : ""} onClick={() => setCt(o.v)}>{o.l}</button>)}
        </div>
        <div className="faint tiny">{ct === "command" ? "Leadership command channels only." : ct === "faction" ? "Whole-faction channels — visible to all members." : "Both command and faction-wide channels."}</div>
      </Card>
      <Card title="Recipients" right={configurable.length > 0 && <Button variant="quiet" size="sm" onClick={() => setSelected(allSel ? new Set() : new Set(configurable.map(t => t.config_id)))}>{allSel ? "Deselect all" : "Select all"}</Button>}>
        {targets.length === 0 ? <Empty title="No factions configured">Nothing you can message has a Discord server set up yet.</Empty> : <>
          {configurable.map(t => {
            const on = selected.has(t.config_id);
            return (
              <label key={t.config_id} className={`recip${on ? " on" : ""}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(t.config_id)} />
                <div>
                  <div className="nm">{t.name} <Badge tone={tierTone(t.tier)}>T{t.tier}</Badge></div>
                  <div className="ch">{t.guild_name ? t.guild_name + " · " : ""}{chanSummary(t, ct)}</div>
                </div>
              </label>
            );
          })}
          {unconfigured.length > 0 && <>
            <div className="row spread"><span className="lbl">No {chLabel(ct)} channel set</span>{isL3 && <Link href="/v3/settings?tab=discord" className="tiny">Fix in Discord &amp; access →</Link>}</div>
            {unconfigured.map(t => (
              <div key={t.config_id} className="recip off">
                <input type="checkbox" disabled />
                <div><div className="nm">{t.name} <Badge>T{t.tier}</Badge></div><div className="ch">{t.guild_name || "No server name"} · Channel not configured</div></div>
              </div>
            ))}
          </>}
          <div className="faint tiny">{selected.size} of {configurable.length} selected{unconfigured.length > 0 ? ` · ${unconfigured.length} without a ${chLabel(ct)} channel` : ""}</div>
        </>}
      </Card>
    </div>
  );
}

// Outcome box. ok means at least one delivery landed; a send where nothing was
// delivered comes back ok:false with the per-faction reasons, and is shown red.
export function Result({ r, ic = false }) {
  if (!r) return null;
  const mirrorNote = r.mirrored ? (ic ? " · filed in the FM IC log" : r.postedToFM ? " · posted in FM Discord" : " · copied to the FM log") : "";
  return (
    <div className={r.ok ? "notice" : "err"}>
      <b>{r.ok ? (r.fmOnly ? "✓ Posted in FM Discord" : `✓ Sent to ${r.sent} of ${r.total} ${r.channelLabel || ""} channel${r.total !== 1 ? "s" : ""}${mirrorNote}`) : `✗ ${r.error}`}</b>
      {r.failed?.length > 0 && <div className="small">Failed: {r.failed.map(f => `${f.name} (${f.reason || f.error || f.status})`).join(", ")}</div>}
    </div>
  );
}

export function Announce({ targets, isL3, presetFaction }) {
  const [ct, setCt] = useState("command");
  const [selected, setSelected] = useState(() => new Set());
  const [message, setMessage] = useState("");
  const [postToFM, setPostToFM] = useState(false);
  const [result, setResult] = useState(null);
  const { run, busy } = useAction();
  usePresetFaction(targets, presetFaction, ct, setSelected);
  const canSend = message.trim() && (selected.size > 0 || (isL3 && postToFM));
  const send = () => run(async () => { setResult(null); const r = await sendAnnouncement([...selected], message, postToFM, ct); setResult(r); return r; },
    { onDone: () => { setMessage(""); setSelected(new Set()); setPostToFM(false); } });
  const label = (() => { const p = [selected.size > 0 && `${selected.size} faction${selected.size !== 1 ? "s" : ""} · ${chLabel(ct)}`, postToFM && "FM Discord"].filter(Boolean); return p.length ? `Send → ${p.join("  +  ")}` : "Send"; })();
  return (
    <div className="grid two">
      <Card title="Message">
        <div className="stack">
          <div className="preview"><b>A Message from Faction Management</b>{message.trim() ? `\n\n${message.trim()}` : "\n\nYour message will appear here…"}</div>
          <div className="field"><textarea rows={8} placeholder="Type your announcement…" value={message} onChange={e => setMessage(e.target.value)} /></div>
          {isL3 && <label className="check"><input type="checkbox" checked={postToFM} onChange={e => setPostToFM(e.target.checked)} /> Also post in FM Discord <span className="faint tiny">— pings @Faction Management</span></label>}
          <div className="faint tiny">Every send is copied to the FM announcements log with its delivery report.</div>
          <div className="row"><Button disabled={busy || !canSend} onClick={send}>{busy ? "Sending…" : label}</Button></div>
          <Result r={result} />
        </div>
      </Card>
      <Recipients targets={targets} ct={ct} setCt={setCt} selected={selected} setSelected={setSelected} isL3={isL3} />
    </div>
  );
}

export function IC({ targets, isL3, presetFaction }) {
  const [ct, setCt] = useState("command");
  const [selected, setSelected] = useState(() => new Set());
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);
  const { run, busy } = useAction();
  usePresetFaction(targets, presetFaction, ct, setSelected);

  const processFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) { setUploadErr("Please select an image file."); return; }
    setUploading(true); setUploadErr(""); setLink("");
    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = String(e.target.result).split(",")[1];
      run(async () => { const res = await uploadToImgbb(b64, file.name); if (res?.ok) setLink(res.url); else setUploadErr(res?.error || "Upload failed."); return res; })
        .finally(() => setUploading(false));
    };
    reader.onerror = () => { setUploading(false); setUploadErr("Could not read that file."); };
    reader.readAsDataURL(file);
  }, [run]);
  const send = () => run(async () => { setResult(null); const r = await sendICCommunication([...selected], link, message, ct); setResult(r); return r; },
    { onDone: (r) => { if (r?.sent > 0) { setLink(""); setMessage(""); setSelected(new Set()); } } });

  return (
    <div className="grid two">
      <div className="stack">
        <Card title={<>Image <span className="tone-bad">*</span></>}>
          <div className={`dropzone${dragging ? " on" : ""}${uploading ? " busy" : ""}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processFile(f); }}
            onClick={() => !uploading && fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ""; }} />
            {uploading ? <div className="tone-good">Uploading to imgbb…</div>
              : link ? <div className="muted">✓ Uploaded — click or drop to replace</div>
              : <div>Drop image here or <b className="tone-good">click to browse</b><div className="d">PNG, JPG, GIF, WEBP</div></div>}
          </div>
          {uploadErr && <div className="err">✗ {uploadErr}</div>}
          {link && <div className="imgprev"><img src={link} alt="Preview" onError={e => { e.target.style.display = "none"; }} /><button type="button" className="btn ghost sm rm" onClick={() => setLink("")}>Remove</button></div>}
        </Card>
        <Card title={<>Message <span className="faint">(optional)</span></>}>
          <div className="stack">
            <div className="field"><textarea rows={4} placeholder="Optional accompanying message…" value={message} onChange={e => setMessage(e.target.value)} /></div>
            <div className="preview"><b>A Message from Meridian</b>{message.trim() ? `\n\n${message.trim()}` : ""}{link.trim() ? "\n\n[image renders here]" : "\n\nUpload an image above to attach it"}</div>
            <div className="faint tiny">FM IC log channel receives: the image, the caption and which factions it reached or failed.</div>
            <div className="row"><Button disabled={busy || !link.trim() || !selected.size} onClick={send}>{busy ? "Sending…" : `Send → ${selected.size} faction${selected.size !== 1 ? "s" : ""} · ${chLabel(ct)}`}</Button></div>
            <Result r={result} ic />
          </div>
        </Card>
      </div>
      <Recipients targets={targets} ct={ct} setCt={setCt} selected={selected} setSelected={setSelected} isL3={isL3} />
    </div>
  );
}
