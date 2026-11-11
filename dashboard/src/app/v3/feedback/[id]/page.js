"use client";
// /v3/feedback/[id] — one submission: what the player wrote, what the team said
// in the thread (fetched live from Discord), and the same actions as the list.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../lib/useAuth.js";
import { getFeedbackItem, getFeedbackDiscussion } from "../../../fm/feedback/actions.js";
import { FM_GUILD_ID } from "../../../../lib/constants.js";
import { PageHeader, Card, Empty, Restricted } from "../../ui.js";
import { StatusBadge, FeedbackActions } from "../FeedbackActions.js";

const IMG_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
const DISCORD_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];
const URL_RE = /https?:\/\/[^\s<>"')]+/g;

/** A media link that falls back to a plain link if the image won't load. */
function EvidenceImage({ url, alt }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <a href={url} target="_blank" rel="noopener noreferrer">{alt || url}</a>;
  return <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={alt || "evidence"} loading="lazy" className="evidence" onError={() => setBroken(true)} /></a>;
}

/**
 * Render an answer with its URLs made useful: direct image links embed as
 * thumbnails, Discord attachment links get a note because they do not load
 * outside Discord, everything else becomes a plain link. React nodes, never an
 * HTML string — JSX escapes player-written text.
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
      out.push(<span key={key++}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a> <span className="faint tiny">(Discord attachment — paste into Discord to view)</span></span>);
    } else if (IMG_EXT.some(e => path.endsWith(e))) {
      out.push(<EvidenceImage key={key++} url={url} />);
    } else {
      out.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer">{url}</a>);
    }
    if (trailing) out.push(trailing);
  }
  out.push(src.slice(pos));
  return out;
}

function Attachment({ att }) {
  const isImage = (att.contentType || "").startsWith("image/") || IMG_EXT.some(e => att.url.toLowerCase().split("?")[0].endsWith(e));
  if (isImage) return <EvidenceImage url={att.url} alt={att.filename} />;
  return <div className="faint tiny">Attachment: <a href={att.url} target="_blank" rel="noopener noreferrer">{att.filename}</a></div>;
}

export default function FeedbackDetail() {
  const auth = useAuth();
  const { id } = useParams();
  const [item, setItem] = useState(undefined);        // undefined = loading, null = not found
  const [discussion, setDiscussion] = useState(null); // null = still loading
  const [err, setErr] = useState("");
  const canUse = !!auth?.ok && (auth.level || 0) >= 2;

  const load = async () => {
    try {
      const row = await getFeedbackItem(Number(id));
      setItem(row || null);
      // Second, and not awaited with the first: a round trip to Discord that the submission should not wait behind.
      if (row) setDiscussion(await getFeedbackDiscussion(Number(id)).catch(() => []));
    } catch (e) { setErr(e?.message || "Could not load this item."); setItem(null); }
  };
  useEffect(() => { if (!auth?.loading && canUse) load(); }, [auth?.loading, canUse, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = <Link href="/v3/comms?tab=feedback" className="muted">Community feedback</Link>;
  if (auth?.loading || (canUse && item === undefined && !err)) return <><PageHeader eyebrow="Comms" title="Feedback item" /><div className="skeleton skel-lg" /></>;
  if (!canUse) return <><PageHeader eyebrow="Comms" title="Feedback item" /><Restricted>Faction feedback is worked by team leads and leadership (L2+).</Restricted></>;
  if (err) return <><PageHeader eyebrow={back} title="Feedback item" /><div className="err">{err}</div></>;
  if (!item) return <><PageHeader eyebrow={back} title="Feedback item" /><Empty title="That feedback item doesn’t exist"><Link href="/v3/comms?tab=feedback">Back to all feedback</Link></Empty></>;

  const facts = [
    `Received ${item.received}`,
    `Discord: ${item.discord_username}`,
    item.occurred && `Occurred ${item.occurred}`,
    item.claimed_by_name && `Acknowledged by ${item.claimed_by_name} (${item.claimed_at})`,
    item.concluded_by_name && `${item.status === "completed" ? "Completed" : "Cancelled"} by ${item.concluded_by_name} (${item.concluded_at})`,
    item.due_at && !["completed", "cancelled"].includes(item.status) && `Next reminder ${item.due_at}`,
  ].filter(Boolean);

  return (
    <>
      <PageHeader eyebrow={<>{back} · #{item.id}</>} title={`${item.faction} · ${item.character_name}`}
        sub={<><StatusBadge status={item.status} /><div className="facts">{facts.map(f => <span key={f}>{f}</span>)}</div></>}
        actions={<>
          {item.thread_id && <a className="btn ghost sm" href={`https://discord.com/channels/${FM_GUILD_ID}/${item.thread_id}`} target="_blank" rel="noopener noreferrer">Open thread ↗</a>}
          <FeedbackActions item={item} onDone={load} />
        </>} />
      <div className="stack">
        <Card title="Submission">
          {item.qa.map(({ question, answer }, i) => (
            <div key={i} className="qa"><div className="q">{question}</div><div className="a">{renderAnswer(answer)}</div></div>
          ))}
          {!item.qa.length && <Empty title="No stored submission content" />}
        </Card>
        <Card title="Team discussion" right={<span className="faint tiny">live from the thread · bot messages hidden</span>}>
          {discussion === null && <div className="skeleton skel-md" />}
          {discussion !== null && !discussion.length && <Empty title="No discussion yet">…or the thread is unreachable.</Empty>}
          {discussion?.map((m, i) => (
            <div key={i} className="msg">
              <span className="au">{m.author}</span> <span className="mono tiny faint">{m.timestamp} UTC</span>
              {m.content.trim() && <div className="a">{renderAnswer(m.content)}</div>}
              {m.attachments.map((att, n) => <Attachment key={n} att={att} />)}
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
