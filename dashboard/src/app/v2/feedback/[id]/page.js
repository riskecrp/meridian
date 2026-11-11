"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/useAuth";
import { getFeedbackItem, getFeedbackDiscussion } from "../../../fm/feedback/actions";
import { FM_GUILD_ID } from "../../../../lib/constants";
import { STATUS_META, FeedbackActions } from "../FeedbackActions.js";

/* One submission: what the player wrote, what the team said in the thread
   (fetched live from Discord), and the same actions as the list. */

const IMG_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
const DISCORD_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];
const URL_RE = /https?:\/\/[^\s<>"')]+/g;

const st = {
  question: { fontWeight: 700, fontSize: 13, color: "var(--ink-0)" },
  answer: { fontSize: 13, color: "var(--ink-1)", whiteSpace: "pre-wrap", marginTop: 4, wordBreak: "break-word", lineHeight: 1.6 },
  link: { color: "var(--accent)", wordBreak: "break-all" },
  note: { fontSize: 11, color: "var(--ink-3)" },
  img: { maxHeight: 240, maxWidth: "100%", borderRadius: 6, border: "1px solid var(--line)", margin: "8px 0", display: "block" },
  meta: { fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" },
};

/** A media link that falls back to a plain link if the image won't load. */
function EvidenceImage({ url, alt }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <a href={url} target="_blank" rel="noopener noreferrer" style={st.link}>{alt || url}</a>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt={alt || "evidence"} loading="lazy" style={st.img} onError={() => setBroken(true)} />
    </a>
  );
}

/**
 * Render an answer with its URLs made useful: direct image links embed as
 * thumbnails, Discord attachment links get a note because they do not load
 * outside Discord, everything else becomes a plain link. Returns React nodes,
 * never an HTML string — JSX escapes player-written text.
 */
function renderAnswer(text) {
  const out = [];
  let pos = 0, key = 0;
  const src = String(text || "");
  for (const m of src.matchAll(URL_RE)) {
    if (m.index > pos) out.push(src.slice(pos, m.index));
    pos = m.index + m[0].length;
    let url = m[0], trailing = "";
    while (url && ".,;:!?)]}'\"".includes(url[url.length - 1])) { trailing = url[url.length - 1] + trailing; url = url.slice(0, -1); }
    const host = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
    const path = url.toLowerCase().split("?")[0].split("#")[0];
    if (DISCORD_HOSTS.some(h => host.includes(h))) {
      out.push(<span key={key++}><a href={url} target="_blank" rel="noopener noreferrer" style={st.link}>{url}</a>{" "}<span style={st.note}>(Discord attachment — paste into Discord to view)</span></span>);
    } else if (IMG_EXT.some(e => path.endsWith(e))) {
      out.push(<EvidenceImage key={key++} url={url} />);
    } else {
      out.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer" style={st.link}>{url}</a>);
    }
    if (trailing) out.push(trailing);
  }
  out.push(src.slice(pos));
  return out;
}

function Attachment({ att }) {
  const isImage = (att.contentType || "").startsWith("image/") || IMG_EXT.some(e => att.url.toLowerCase().split("?")[0].endsWith(e));
  if (isImage) return <EvidenceImage url={att.url} alt={att.filename} />;
  return <div style={st.note}>Attachment: <a href={att.url} target="_blank" rel="noopener noreferrer" style={st.link}>{att.filename}</a></div>;
}

export default function V2FeedbackDetail() {
  const auth = useAuth();
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [discussion, setDiscussion] = useState(null);   // null = still loading
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const row = await getFeedbackItem(Number(id));
      setItem(row); setLoading(false);
      // Second, and not awaited with the first: a round trip to Discord that the submission should not wait behind.
      if (row) setDiscussion(await getFeedbackDiscussion(Number(id)));
    } catch (e) { setErr(e?.message || "Could not load this item."); setLoading(false); }
  };
  useEffect(() => {
    if (auth?.loading || !auth?.id) return;
    if ((auth.level || 0) < 2) { setLoading(false); return; }
    load();
  }, [auth?.id, auth?.loading, auth?.level, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (auth?.loading || loading) return <div className="view" style={{ color: "var(--ink-3)" }}>Loading…</div>;
  if (!auth?.ok) return <div className="view" style={{ color: "var(--ink-3)" }}>Not authorized.</div>;
  if ((auth.level || 0) < 2) return <div className="view"><div className="empty">Faction feedback is worked by team leads and leadership (L2+).</div></div>;
  if (err) return <div className="view"><div className="err">{err}</div></div>;
  if (!item) return <div className="view"><div className="empty">That feedback item doesn&apos;t exist. <Link href="/v2/feedback" style={st.link}>Back to all feedback</Link></div></div>;

  const meta = STATUS_META[item.status] || STATUS_META.new;
  const facts = [
    `Received ${item.received}`,
    `Discord: ${item.discord_username}`,
    item.occurred && `Occurred ${item.occurred}`,
    item.claimed_by_name && `Acknowledged by ${item.claimed_by_name} (${item.claimed_at})`,
    item.concluded_by_name && `${item.status === "completed" ? "Completed" : "Cancelled"} by ${item.concluded_by_name} (${item.concluded_at})`,
    item.due_at && !["completed", "cancelled"].includes(item.status) && `Next reminder ${item.due_at}`,
  ].filter(Boolean);

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow"><Link href="/v2/feedback" style={{ color: "var(--ink-3)" }}>Faction Feedback</Link> · #{item.id}</p>
          <h1>{item.faction} · {item.character_name}</h1>
          <div className="sub" style={{ color: meta.color }}>{meta.dot} {meta.label}</div>
          <div className="sub">{facts.join(" · ")}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {item.thread_id && <a className="act" href={`https://discord.com/channels/${FM_GUILD_ID}/${item.thread_id}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>Open thread ↗</a>}
          <FeedbackActions item={item} onDone={load} />
        </div>
      </div>

      <div className="card">
        <div className="hd"><div className="t">Submission</div></div>
        {item.qa.map(({ question, answer }, i) => (
          <div key={i} style={{ marginTop: 14 }}>
            <div style={st.question}>{question}</div>
            <div style={st.answer}>{renderAnswer(answer)}</div>
          </div>
        ))}
        {!item.qa.length && <div className="empty">No stored submission content.</div>}
      </div>

      <div className="card">
        <div className="hd"><div className="t">Team discussion</div><div className="meta">live from the thread · bot messages hidden</div></div>
        {discussion === null && <div className="empty">Loading discussion from Discord…</div>}
        {discussion !== null && !discussion.length && <div className="empty">No discussion yet (or the thread is unreachable).</div>}
        {discussion?.map((m, i) => (
          <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
            <strong style={{ fontSize: 13 }}>{m.author}</strong>{" "}
            <span style={st.meta}>{m.timestamp} UTC</span>
            {m.content.trim() && <div style={st.answer}>{renderAnswer(m.content)}</div>}
            {m.attachments.map((att, n) => <Attachment key={n} att={att} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
