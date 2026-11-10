"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { sendPing, getPingRoute, urls } from "../../../lib/pings.js";
import { requireActor, getActor } from "../../../lib/requireActor.js";
import { str, docLevel, fail } from "../../../../../shared/validate.js";

/*
 * Documents (policy 5): level_required is a GATE. Both shells (/fm/documents
 * and /v2/story?tab=docs) list through getDocuments(), which returns only the
 * documents the actor's clearance allows:
 *   L1..L3           level_required <= clearance
 *   Lead Storyteller level-1 documents (read-only)
 *   Event Team       level-1 documents, or more when they also hold clearance (read-only)
 * Create / edit / delete are L3 only — no Event Team boost.
 */

const MAX_TITLE = 200;
const MAX_CATEGORY = 80;

function authError(code, message) { const e = new Error(message); e.code = code; return e; }

// The clearance used to filter the catalogue. Flags never raise it above 1.
async function readerLevel() {
  const actor = await getActor();
  if (!actor) throw authError('AUTH_REQUIRED', 'Not authenticated');
  const level = Math.max(actor.level, (actor.isEventTeam || actor.isLeadStoryteller) ? 1 : 0);
  if (level < 1) throw authError('AUTH_INSUFFICIENT', 'Insufficient clearance (need L1, have L0)');
  return level;
}

export async function getDocuments() {
  const level = await readerLevel();
  return query(
    "SELECT * FROM documents WHERE level_required <= ? ORDER BY level_required ASC, category, title",
    [level]
  );
}

// One document by id, or null when it does not exist or sits above the reader's level.
export async function getDocument(id) {
  const level = await readerLevel();
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId < 1) return null;
  return queryOne("SELECT * FROM documents WHERE id = ? AND level_required <= ?", [docId, level]) || null;
}

function cleanDoc(data, existing = null) {
  const d = data && typeof data === 'object' ? data : {};
  const title = 'title' in d || !existing ? str(d.title, { max: MAX_TITLE }) : existing.title;
  const category = 'category' in d || !existing ? (str(d.category, { max: MAX_CATEGORY }) || 'General') : existing.category;
  const content = 'content' in d || !existing ? (typeof d.content === 'string' ? d.content : '') : existing.content;
  const level = 'level_required' in d || !existing ? docLevel(d.level_required) : docLevel(existing.level_required);
  return { title, category, content, level };
}

// Publish ping. Level-1 documents go to the general document.published route.
// Anything above level 1 is for leads/leadership only, so it takes the route's
// leadership (alt) branch — and is NOT announced at all when no alt channel is
// configured, so a restricted title never reaches the general channel.
async function announce(doc) {
  const route = getPingRoute('document.published');
  if (!route) return false;
  const restricted = doc.level >= 2;
  if (restricted && !route.alt_channel_id) return false;
  const who = doc.level >= 3 ? 'Leadership (L3)' : doc.level === 2 ? 'Team Leads & Leadership (L2+)' : 'All FM staff';
  const text = `📄 **New Document Published**\n**Title:** ${doc.title}\n**Category:** ${doc.category}\n**Visible to:** ${who}\n**Author:** ${doc.author}\n🔗 ${urls.documents(doc.title)}`;
  return sendPing('document.published', text, { alt: restricted });
}

export async function createDocument(data) {
  const actor = await requireActor(3);
  const doc = cleanDoc(data);
  if (!doc.title) return fail('Title is required.');
  const info = run("INSERT INTO documents (title, category, content, level_required, created_by, created_by_id) VALUES (?, ?, ?, ?, ?, ?)",
    [doc.title, doc.category, doc.content, doc.level, actor.name, actor.id]);
  const id = Number(info.lastInsertRowid);
  logAudit(actor.id, actor.name, 'CREATE', 'document', id, doc.title, `Category: ${doc.category} · Level: ${doc.level}`);
  const pinged = await announce({ ...doc, author: actor.name });
  return { ok: true, id, pinged };
}

export async function updateDocument(id, data) {
  const actor = await requireActor(3);
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId < 1) return fail('Invalid document id.');
  const existing = queryOne("SELECT * FROM documents WHERE id = ?", [docId]);
  if (!existing) return fail('Document not found.');
  const doc = cleanDoc(data, existing);
  if (!doc.title) return fail('Title is required.');
  run("UPDATE documents SET title=?, category=?, content=?, level_required=?, updated_at=datetime('now') WHERE id=?",
    [doc.title, doc.category, doc.content, doc.level, docId]);
  const changes = [];
  if (doc.title !== existing.title) changes.push(`title "${existing.title}" → "${doc.title}"`);
  if (doc.category !== existing.category) changes.push(`category ${existing.category} → ${doc.category}`);
  if (doc.level !== Number(existing.level_required)) changes.push(`level ${existing.level_required} → ${doc.level}`);
  if (doc.content !== existing.content) changes.push('content edited');
  logAudit(actor.id, actor.name, 'EDIT', 'document', docId, doc.title, changes.join('; ') || 'no change');
  return { ok: true, id: docId };
}

export async function deleteDocument(id) {
  const actor = await requireActor(3);
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId < 1) return fail('Invalid document id.');
  const existing = queryOne("SELECT id, title, category, level_required FROM documents WHERE id = ?", [docId]);
  if (!existing) return fail('Document not found.');
  run("DELETE FROM documents WHERE id=?", [docId]);
  logAudit(actor.id, actor.name, 'DELETE', 'document', docId, existing.title, `Category: ${existing.category} · Level: ${existing.level_required}`);
  return { ok: true, id: docId };
}
