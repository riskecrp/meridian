'use server';
import { requireActor } from '../../../../lib/requireActor.js';
import { queryOne, run } from '../../../../lib/db.js';
import { logAudit } from '../../../../lib/audit.js';
import { publishManagedPost, threadUrl } from '../../../../lib/forumPosts.js';
import { nowIso } from '../../../../../../shared/dates.js';
import { str } from '../../../../../../shared/validate.js';

// Leadership only (L3) — the post is FM policy, not a scene asset (policy 4).
const LEVEL = 3;
const KEY = 'important_links';

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

function summarize(sections) {
  const links = sections.reduce((n, s) => n + (s.type === 'links' ? s.links.length : 0), 0);
  return `${sections.length} section${sections.length === 1 ? '' : 's'}, ${links} link${links === 1 ? '' : 's'}`;
}

export async function getLinks() {
  await requireActor(LEVEL);
  const row = queryOne("SELECT * FROM managed_forum_posts WHERE key = ?", [KEY]);
  // The destination is whatever the row says; label it from discord_config
  // when a configured channel matches so the UI never has to guess a name.
  const cfg = row?.channel_id ? queryOne("SELECT key FROM discord_config WHERE channel_id = ?", [row.channel_id]) : null;
  let sections = [];
  try { sections = row?.content_json ? JSON.parse(row.content_json) : []; } catch { sections = []; }
  return {
    title: row?.title || 'Important Links',
    sections,
    published: !!row?.thread_id,
    postUrl: row?.thread_id ? threadUrl(row.thread_id) : null,
    channelId: row?.channel_id || '',
    channelLabel: cfg?.key || (row?.channel_id ? `channel ${row.channel_id}` : 'no channel configured'),
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

export async function saveLinks(title, sections) {
  const actor = await requireActor(LEVEL);
  const row = queryOne("SELECT key FROM managed_forum_posts WHERE key = ?", [KEY]);
  if (!row) return { ok: false, error: `No managed post '${KEY}' is configured.` };
  const clean = sanitizeSections(sections);
  const t = str(title, { max: 100 }) || 'Important Links';
  run(
    `UPDATE managed_forum_posts SET title = ?, content_json = ?, updated_at = ?, updated_by = ? WHERE key = ?`,
    [t, JSON.stringify(clean), nowIso(), actor.name, KEY]
  );
  logAudit(actor.id, actor.name, 'EDIT', 'managed_forum_post', KEY, t, `Draft saved: ${summarize(clean)}`);
  return { ok: true, sections: clean.length };
}

export async function publishLinks(title, sections) {
  const actor = await requireActor(LEVEL);
  const saved = await saveLinks(title, sections);
  if (!saved.ok) return saved;
  try {
    const res = await publishManagedPost(KEY, actor.name);
    logAudit(actor.id, actor.name, 'PUBLISH', 'managed_forum_post', KEY, str(title, { max: 100 }) || 'Important Links',
      `${res.createdNew ? 'Created' : 'Updated'} Discord thread ${res.threadId} (${res.messageCount} message${res.messageCount === 1 ? '' : 's'})${res.replacedOld ? ', old post removed' : ''}`);
    return { ok: true, ...res };
  } catch (e) {
    logAudit(actor.id, actor.name, 'PUBLISH', 'managed_forum_post', KEY, str(title, { max: 100 }) || 'Important Links', `FAILED: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
