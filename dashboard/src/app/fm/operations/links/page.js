"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { getLinks, saveLinks, publishLinks } from "./actions";

let _uid = 0;
const nextId = () => `r${++_uid}`;

function hydrate(sections) {
  return (sections || []).map((s) => ({
    id: nextId(),
    type: s.type === "text" ? "text" : "links",
    heading: s.heading || "",
    ordered: !!s.ordered,
    text: s.text || "",
    links: (s.links || []).map((l) => ({ id: nextId(), label: l.label || "", url: l.url || "" })),
  }));
}

function dehydrate(sections) {
  return sections.map((s) =>
    s.type === "text"
      ? { type: "text", heading: s.heading, text: s.text }
      : { type: "links", heading: s.heading, ordered: s.ordered, links: s.links.map((l) => ({ label: l.label, url: l.url })) }
  );
}

const C = {
  card: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 },
  input: {
    width: "100%", padding: "7px 10px", borderRadius: 6, boxSizing: "border-box",
    border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
    color: "#e2e8f0", fontSize: 13, outline: "none", fontFamily: "inherit",
  },
  iconBtn: {
    fontSize: 11, padding: "3px 7px", borderRadius: 5, cursor: "pointer",
    border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(255,255,255,0.45)",
  },
  accentBtn: {
    fontSize: 12, fontWeight: 700, padding: "7px 16px", borderRadius: 7, cursor: "pointer",
    border: "none", background: "rgba(99,102,241,0.85)", color: "#fff",
  },
  ghostBtn: {
    fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 7, cursor: "pointer",
    border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.55)",
  },
};

function boldMd(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i} style={{ color: "#f1f5f9" }}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>
  );
}

export default function ImportantLinksPage() {
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Important Links");
  const [sections, setSections] = useState([]);
  const [postUrl, setPostUrl] = useState(null);
  const [isPublished, setIsPublished] = useState(false);
  const [meta, setMeta] = useState({ updatedAt: null, updatedBy: null });
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState(null);

  const canAccess = !auth.loading && auth.level >= 3;

  useEffect(() => {
    if (!canAccess) { setLoading(false); return; }
    getLinks().then((d) => {
      setTitle(d.title);
      setSections(hydrate(d.sections));
      setPostUrl(d.postUrl);
      setIsPublished(d.published);
      setMeta({ updatedAt: d.updatedAt, updatedBy: d.updatedBy });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [canAccess]);

  const patchSection = (i, patch) => setSections((s) => s.map((sec, idx) => (idx === i ? { ...sec, ...patch } : sec)));
  const moveSection = (i, dir) => setSections((s) => { const j = i + dir; if (j < 0 || j >= s.length) return s; const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const removeSection = (i) => setSections((s) => s.filter((_, idx) => idx !== i));
  const addSection = (type) => setSections((s) => [...s, type === "text"
    ? { id: nextId(), type: "text", heading: "New Section", text: "" }
    : { id: nextId(), type: "links", heading: "New Section", ordered: false, links: [{ id: nextId(), label: "", url: "" }] }]);

  const patchLink = (si, li, patch) => setSections((s) => s.map((sec, idx) => idx !== si ? sec : { ...sec, links: sec.links.map((l, j) => (j === li ? { ...l, ...patch } : l)) }));
  const moveLink = (si, li, dir) => setSections((s) => s.map((sec, idx) => { if (idx !== si) return sec; const j = li + dir; if (j < 0 || j >= sec.links.length) return sec; const n = [...sec.links]; [n[li], n[j]] = [n[j], n[li]]; return { ...sec, links: n }; }));
  const removeLink = (si, li) => setSections((s) => s.map((sec, idx) => idx !== si ? sec : { ...sec, links: sec.links.filter((_, j) => j !== li) }));
  const addLink = (si) => setSections((s) => s.map((sec, idx) => idx !== si ? sec : { ...sec, links: [...sec.links, { id: nextId(), label: "", url: "" }] }));

  const payload = useMemo(() => dehydrate(sections), [sections]);

  const doSave = async () => {
    setBusy("save"); setStatus(null);
    try { await saveLinks(title, payload); setStatus({ ok: true, msg: "Draft saved." }); }
    catch (e) { setStatus({ ok: false, msg: e.message || "Save failed." }); }
    setBusy("");
  };

  const doPublish = async () => {
    setBusy("publish"); setStatus(null);
    try {
      const res = await publishLinks(title, payload);
      if (res.ok) {
        setPostUrl(res.url); setIsPublished(true);
        setStatus({ ok: true, msg: res.createdNew
          ? `Published — created the post${res.replacedOld ? " and removed the old one" : ""}.`
          : `Updated the post in place (${res.messageCount} message${res.messageCount !== 1 ? "s" : ""}).` });
      } else { setStatus({ ok: false, msg: res.error || "Publish failed." }); }
    } catch (e) { setStatus({ ok: false, msg: e.message || "Publish failed." }); }
    setBusy("");
  };

  if (auth.loading || loading) return <div style={{ padding: "60px 24px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Loading…</div>;
  if (!canAccess) return <div style={{ padding: "60px 24px", textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Leadership access (L3) required.</div>;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "8px 4px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em", margin: 0 }}>Important Links</h1>
        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999, fontFamily: "JetBrains Mono, monospace",
          background: isPublished ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.12)",
          color: isPublished ? "#34d399" : "#f59e0b", border: `1px solid ${isPublished ? "rgba(52,211,153,0.3)" : "rgba(245,158,11,0.3)"}` }}>
          {isPublished ? "live" : "not published"}
        </span>
        {postUrl && <a href={postUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#818cf8", textDecoration: "none", fontWeight: 600 }}>View post ↗</a>}
      </div>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", margin: "0 0 20px", lineHeight: 1.6 }}>
        One bot-managed Discord post in #fm-useful-links-and-information, edited in place — publishing never creates a new post.
        {meta.updatedAt && <> Last updated {new Date(meta.updatedAt).toLocaleString()}{meta.updatedBy ? ` by ${meta.updatedBy}` : ""}.</>}
      </p>

      <div style={{ ...C.card, padding: 14, marginBottom: 16 }}>
        <label style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", display: "block", marginBottom: 6 }}>Post Title (Discord thread name)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} style={C.input} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {sections.map((sec, si) => (
          <div key={sec.id} style={{ ...C.card, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, fontFamily: "JetBrains Mono, monospace",
                color: sec.type === "text" ? "#fbbf24" : "#818cf8",
                background: sec.type === "text" ? "rgba(245,158,11,0.1)" : "rgba(99,102,241,0.12)",
                border: `1px solid ${sec.type === "text" ? "rgba(245,158,11,0.3)" : "rgba(99,102,241,0.3)"}` }}>
                {sec.type === "text" ? "TEXT" : "LINKS"}
              </span>
              <input value={sec.heading} onChange={(e) => patchSection(si, { heading: e.target.value })} placeholder="Section heading" maxLength={120} style={{ ...C.input, fontWeight: 700, fontSize: 14 }} />
              <button title="Move up" onClick={() => moveSection(si, -1)} style={C.iconBtn}>↑</button>
              <button title="Move down" onClick={() => moveSection(si, 1)} style={C.iconBtn}>↓</button>
              <button title="Delete section" onClick={() => removeSection(si)} style={{ ...C.iconBtn, color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}>✕</button>
            </div>

            {sec.type === "text" ? (
              <textarea value={sec.text} onChange={(e) => patchSection(si, { text: e.target.value })} rows={5} placeholder="Markdown text — **bold**, bullet lines, etc."
                style={{ ...C.input, resize: "vertical", lineHeight: 1.6, fontFamily: "JetBrains Mono, monospace", fontSize: 12 }} />
            ) : (
              <>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={sec.ordered} onChange={(e) => patchSection(si, { ordered: e.target.checked })} /> Numbered list
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sec.links.map((l, li) => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", width: 16, textAlign: "right", fontFamily: "JetBrains Mono, monospace" }}>{sec.ordered ? `${li + 1}.` : "•"}</span>
                      <input value={l.label} onChange={(e) => patchLink(si, li, { label: e.target.value })} placeholder="Label" maxLength={200} style={{ ...C.input, flex: "0 0 38%" }} />
                      <input value={l.url} onChange={(e) => patchLink(si, li, { url: e.target.value })} placeholder="https://…" maxLength={500} style={{ ...C.input, flex: 1 }} />
                      <button title="Move up" onClick={() => moveLink(si, li, -1)} style={C.iconBtn}>↑</button>
                      <button title="Move down" onClick={() => moveLink(si, li, 1)} style={C.iconBtn}>↓</button>
                      <button title="Remove link" onClick={() => removeLink(si, li)} style={{ ...C.iconBtn, color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}>✕</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => addLink(si)} style={{ ...C.ghostBtn, marginTop: 8, fontSize: 11, padding: "4px 10px" }}>+ Add link</button>
              </>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={() => addSection("links")} style={C.ghostBtn}>+ Links section</button>
        <button onClick={() => addSection("text")} style={C.ghostBtn}>+ Text section</button>
      </div>

      <div style={{ ...C.card, padding: 18, marginTop: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>Discord Preview</div>
        {sections.length === 0 && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>Nothing yet.</div>}
        {sections.map((sec) => (
          <div key={sec.id} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#f1f5f9", marginBottom: 6 }}>{sec.heading}</div>
            {sec.type === "text" ? (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{boldMd(sec.text)}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {sec.links.map((l, li) => (
                  <div key={l.id} style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                    {sec.ordered && <span style={{ color: "rgba(255,255,255,0.4)" }}>{li + 1}. </span>}
                    {l.url ? <a href={l.url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>{l.label || l.url}</a> : <span>{l.label}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ position: "sticky", bottom: 0, marginTop: 24, padding: "14px 0", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        background: "linear-gradient(0deg, var(--bg-0, #0a0a0f) 60%, transparent)" }}>
        <button onClick={doPublish} disabled={!!busy} style={{ ...C.accentBtn, opacity: busy ? 0.5 : 1 }}>
          {busy === "publish" ? "Publishing…" : (isPublished ? "Update Discord post" : "Publish to Discord")}
        </button>
        <button onClick={doSave} disabled={!!busy} style={{ ...C.ghostBtn, opacity: busy ? 0.5 : 1 }}>
          {busy === "save" ? "Saving…" : "Save draft"}
        </button>
        {status && <span style={{ fontSize: 12, fontWeight: 600, color: status.ok ? "#34d399" : "#f87171" }}>{status.ok ? "✓ " : "⚠ "}{status.msg}</span>}
      </div>
    </div>
  );
}
