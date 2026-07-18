// Render structured sections to Discord markdown and publish a managed forum
// post in place — one bot-owned thread per key, edited (never re-created) on
// every publish. Overflow past Discord's 2000-char message limit is spread
// across follow-up messages inside the same post and reconciled each time.
import { queryOne, run } from './db.js';

const GUILD_ID = '1457188814916423855'; // [ECRP] Game Affairs / FM guild
const MSG_LIMIT = 1900;                 // leave margin under Discord's 2000

export function renderSection(s) {
  if (!s || !s.heading) return '';
  const head = `# **${s.heading}**`;
  if (s.type === 'text') {
    const body = (s.text || '').trim();
    return body ? `${head}\n${body}` : head;
  }
  const links = Array.isArray(s.links) ? s.links : [];
  const lines = links.map((l, i) => {
    const link = l.url ? `[${l.label}](${l.url})` : l.label;
    return s.ordered ? `${i + 1}. ${link}` : link;
  });
  return lines.length ? `${head}\n${lines.join('\n')}` : head;
}

// Pack sections into <=MSG_LIMIT chunks, keeping whole sections together where
// possible and hard-splitting (by line) only a section too large on its own.
export function renderChunks(sections, limit = MSG_LIMIT) {
  const rendered = (Array.isArray(sections) ? sections : []).map(renderSection).filter(Boolean);
  const chunks = [];
  let cur = '';
  const flush = () => { if (cur) { chunks.push(cur); cur = ''; } };

  for (const sec of rendered) {
    const joined = cur ? `${cur}\n\n${sec}` : sec;
    if (joined.length <= limit) { cur = joined; continue; }
    flush();
    if (sec.length <= limit) { cur = sec; continue; }
    let buf = '';
    for (const line of sec.split('\n')) {
      const p = buf ? `${buf}\n${line}` : line;
      if (p.length <= limit) { buf = p; }
      else { if (buf) chunks.push(buf); buf = line.slice(0, limit); }
    }
    cur = buf;
  }
  flush();
  return chunks.length ? chunks : [' '];
}

async function dapi(method, path, body) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not configured.');
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`Discord rate limited (retry_after=${j.retry_after}s). Try again shortly.`);
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Discord ${method} ${path} → ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// Create (first time) or edit-in-place (every later time) the managed post.
export async function publishManagedPost(key, updatedBy) {
  const row = queryOne('SELECT * FROM managed_forum_posts WHERE key = ?', [key]);
  if (!row) throw new Error(`No managed post '${key}'.`);

  const sections = JSON.parse(row.content_json || '[]');
  const chunks = renderChunks(sections);
  const title = (row.title || 'Untitled').slice(0, 100);

  let threadId = row.thread_id;
  let msgIds = row.message_ids ? JSON.parse(row.message_ids) : [];
  let createdNew = false;

  if (!threadId) {
    const thread = await dapi('POST', `/channels/${row.channel_id}/threads`, {
      name: title,
      auto_archive_duration: 10080,
      message: { content: chunks[0] },
    });
    threadId = thread.id;
    msgIds = [thread.id];
    createdNew = true;
    for (let i = 1; i < chunks.length; i++) {
      const m = await dapi('POST', `/channels/${threadId}/messages`, { content: chunks[i] });
      msgIds.push(m.id);
    }
  } else {
    await dapi('PATCH', `/channels/${threadId}`, { name: title }).catch(() => {});
    for (let i = 0; i < chunks.length; i++) {
      if (msgIds[i]) {
        await dapi('PATCH', `/channels/${threadId}/messages/${msgIds[i]}`, { content: chunks[i] });
      } else {
        const m = await dapi('POST', `/channels/${threadId}/messages`, { content: chunks[i] });
        msgIds[i] = m.id;
      }
    }
    for (let i = chunks.length; i < msgIds.length; i++) {
      await dapi('DELETE', `/channels/${threadId}/messages/${msgIds[i]}`).catch(() => {});
    }
    msgIds = msgIds.slice(0, chunks.length);
  }

  let replacedOld = false;
  if (createdNew && row.replace_thread_id) {
    try { await dapi('DELETE', `/channels/${row.replace_thread_id}`); replacedOld = true; }
    catch (e) { console.error('[forumPosts] could not delete old post:', e.message); }
  }

  run(
    `UPDATE managed_forum_posts
       SET thread_id = ?, message_ids = ?, replace_thread_id = NULL, updated_at = ?, updated_by = ?
     WHERE key = ?`,
    [threadId, JSON.stringify(msgIds), new Date().toISOString(), updatedBy || 'dashboard', key]
  );

  return {
    threadId,
    url: `https://discord.com/channels/${GUILD_ID}/${threadId}`,
    messageCount: msgIds.length,
    createdNew,
    replacedOld,
  };
}
