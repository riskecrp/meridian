'use server';
import { requireActor } from '../../../../lib/requireActor.js';
import { queryOne, run } from '../../../../lib/db.js';
import { publishManagedPost } from '../../../../lib/forumPosts.js';

// Leadership only (L3) — matches the Operations section gating.
const LEVEL = 3;

function cleanUrl(u) {
  const s = String(u || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return s.slice(0, 500);
}

function sanitizeSections(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).map((s) => {
    const heading = String(s?.heading ?? '').trim().slice(0, 120);
    if (s?.type === 'text') {
      return { type: 'text', heading, text: String(s?.text ?? '').slice(0, 2000) };
    }
    const links = (Array.isArray(s?.links) ? s.links : []).slice(0, 60).map((l) => ({
      label: String(l?.label ?? '').trim().slice(0, 200),
      url: cleanUrl(l?.url),
    })).filter((l) => l.label || l.url);
    return { type: 'links', heading, ordered: !!s?.ordered, links };
  }).filter((s) => s.heading || (s.type === 'text' ? s.text : s.links.length));
}

const GUILD_ID = '1457188814916423855';

export async function getLinks() {
  await requireActor(LEVEL);
  const row = queryOne("SELECT * FROM managed_forum_posts WHERE key = 'important_links'");
  return {
    title: row?.title || 'Important Links',
    sections: row?.content_json ? JSON.parse(row.content_json) : [],
    published: !!row?.thread_id,
    postUrl: row?.thread_id ? `https://discord.com/channels/${GUILD_ID}/${row.thread_id}` : null,
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

export async function saveLinks(title, sections) {
  const actor = await requireActor(LEVEL);
  const clean = sanitizeSections(sections);
  const t = (String(title ?? '').trim().slice(0, 100)) || 'Important Links';
  run(
    `UPDATE managed_forum_posts SET title = ?, content_json = ?, updated_at = ?, updated_by = ?
     WHERE key = 'important_links'`,
    [t, JSON.stringify(clean), new Date().toISOString(), actor.name]
  );
  return { ok: true };
}

export async function publishLinks(title, sections) {
  const actor = await requireActor(LEVEL);
  await saveLinks(title, sections);
  try {
    const res = await publishManagedPost('important_links', actor.name);
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
