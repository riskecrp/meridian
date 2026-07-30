"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/useAuth";
import { getFeedbackItem, getFeedbackDiscussion } from "../actions";
import { ui } from "../../../../lib/ui.js";

// One submission: what the player wrote, and what the team said about it in the
// thread. The thread half is fetched live from Discord rather than mirrored —
// see fetchChannelMessages in lib/discord.js.

const GUILD_ID = "1457188814916423855";

const STATUS_LABELS = {
  new: "Pending Acknowledgement",
  claimed: "Pending Review",
  completed: "Completed",
  cancelled: "Cancelled",
};

const IMG_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
const DISCORD_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];
const URL_RE = /https?:\/\/[^\s<>"')]+/g;

const st = {
  ...ui,
  card: { padding:'16px 18px' },
  h3: { margin:'0 0 6px', fontSize:13, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.12em', color:'var(--fg-3)' },
  question: { fontWeight:700, fontSize:13, color:'var(--fg-0)' },
  answer: { fontSize:13, color:'var(--fg-2)', whiteSpace:'pre-wrap', marginTop:4, wordBreak:'break-word' },
  link: { color:'var(--accent)', wordBreak:'break-all' },
  note: { fontSize:11, color:'var(--fg-4)' },
  img: { maxHeight:240, maxWidth:'100%', borderRadius:6, border:'1px solid var(--border)', margin:'8px 0', display:'block' },
  meta: { fontSize:11, color:'var(--fg-4)', fontFamily:'var(--font-mono)' },
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
 * outside Discord, everything else becomes a plain link.
 *
 * Returns React nodes, not an HTML string — JSX escapes its children, so
 * player-written text cannot inject markup here. (The Python original had to
 * escape by hand for exactly this reason.)
 */
function renderAnswer(text) {
  const out = [];
  let pos = 0, key = 0;
  const src = String(text || "");
  for (const m of src.matchAll(URL_RE)) {
    if (m.index > pos) out.push(src.slice(pos, m.index));
    pos = m.index + m[0].length;

    // Don't swallow sentence punctuation that happens to follow a URL.
    let url = m[0], trailing = "";
    while (url && ".,;:!?)]}'\"".includes(url[url.length - 1])) {
      trailing = url[url.length - 1] + trailing;
      url = url.slice(0, -1);
    }
    const host = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
    const path = url.toLowerCase().split("?")[0].split("#")[0];

    if (DISCORD_HOSTS.some(h => host.includes(h))) {
      out.push(
        <span key={key++}>
          <a href={url} target="_blank" rel="noopener noreferrer" style={st.link}>{url}</a>{" "}
          <span style={st.note}>(Discord attachment — paste into Discord to view, these don&apos;t open outside it)</span>
        </span>,
      );
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
  const isImage = (att.contentType || "").startsWith("image/")
    || IMG_EXT.some(e => att.url.toLowerCase().split("?")[0].endsWith(e));
  if (isImage) return <EvidenceImage url={att.url} alt={att.filename} />;
  return (
    <div style={st.note}>
      Attachment: <a href={att.url} target="_blank" rel="noopener noreferrer" style={st.link}>{att.filename}</a>
    </div>
  );
}

export default function FeedbackDetailPage() {
  const auth = useAuth();
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [discussion, setDiscussion] = useState(null);   // null = still loading
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading || auth.level < 2) return;
    (async () => {
      const row = await getFeedbackItem(Number(id));
      setItem(row);
      setLoading(false);
      // Second, and not awaited with the first: this one is a round trip to
      // Discord, and the submission should not wait behind it.
      if (row) setDiscussion(await getFeedbackDiscussion(Number(id)));
    })();
  }, [auth.loading, auth.level, id]);

  if (auth.loading || loading) return <div className="p-10 text-sm animate-pulse" style={{ color:'var(--accent)' }}>Loading...</div>;
  if (auth.level < 2) return <div className="p-10" style={{ color:'var(--red)' }}>Access denied.</div>;
  if (!item) return (
    <div className="p-10" style={{ color:'var(--fg-3)' }}>
      That feedback item doesn&apos;t exist. <Link href="/fm/feedback" style={st.link}>Back to all feedback</Link>
    </div>
  );

  const parts = [
    `Received ${item.created_at}`,
    `Discord: ${item.discord_username}`,
    `Status: ${STATUS_LABELS[item.status] || item.status}`,
    item.claimed_by_name && `Acknowledged by ${item.claimed_by_name} (${item.claimed_at})`,
    item.concluded_by_name && `${item.status === 'completed' ? 'Completed' : 'Cancelled'} by ${item.concluded_by_name} (${item.concluded_at})`,
  ].filter(Boolean);

  return (
    <div className="page-shell">
      <div className="page-hdr" style={{ background:'linear-gradient(180deg,rgba(231,76,60,0.04) 0%,transparent 100%)' }}>
        <div className="accent-bar" style={{ background:'linear-gradient(90deg,var(--red) 0%,transparent 60%)' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <div className="page-hdr-tag" style={{ color:'var(--red)' }}>Faction Feedback / #{item.id}</div>
            <h1>{item.faction} · {item.character_name}</h1>
            <div className="page-hdr-sub">{parts.join(' · ')}</div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:4 }}>
            <Link href="/fm/feedback" style={st.btnGhost}>← All feedback</Link>
            {item.thread_id && (
              <a href={`https://discord.com/channels/${GUILD_ID}/${item.thread_id}`} target="_blank" rel="noopener noreferrer" style={st.btnGhost}>
                Open thread ↗
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="page-body scr" style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div className="sec-card" style={st.card}>
          <h3 style={st.h3}>Submission</h3>
          {item.qa.map(({ question, answer }, i) => (
            <div key={i} style={{ marginTop:14 }}>
              <div style={st.question}>{question}</div>
              <div style={st.answer}>{renderAnswer(answer)}</div>
            </div>
          ))}
          {!item.qa.length && <div style={st.note}>No stored submission content.</div>}
        </div>

        <div className="sec-card" style={st.card}>
          <h3 style={st.h3}>Team discussion</h3>
          {discussion === null && <div style={st.note}>Loading discussion from Discord…</div>}
          {discussion !== null && !discussion.length && (
            <div style={st.note}>No discussion yet (or the thread is unreachable).</div>
          )}
          {discussion?.map((m, i) => (
            <div key={i} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
              <strong style={{ fontSize:13 }}>{m.author}</strong>{" "}
              <span style={st.meta}>{m.timestamp} UTC</span>
              {m.content.trim() && <div style={st.answer}>{renderAnswer(m.content)}</div>}
              {m.attachments.map((att, n) => <Attachment key={n} att={att} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
