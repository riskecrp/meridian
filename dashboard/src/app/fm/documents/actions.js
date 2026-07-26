"use server";
import { query, run } from "../../../lib/db.js";
import { logAudit } from "../../../lib/audit.js";
import { sendPing } from "../../../lib/pings.js";
import { requireActor } from "../../../lib/requireActor.js";

export async function getDocuments() {
  const actor = await requireActor(1, {allowEventTeam: true});
  return query(
    "SELECT * FROM documents WHERE level_required <= ? ORDER BY level_required ASC, category, title",
    [actor.level]
  );
}

export async function createDocument(data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const level = parseInt(data.level_required) || 1;
  run("INSERT INTO documents (title, category, content, level_required, created_by, created_by_id) VALUES (?, ?, ?, ?, ?, ?)",
    [data.title, data.category || 'General', data.content, level, actor.name, actor.id]);
  logAudit(actor.id, actor.name, 'CREATE', 'document', null, data.title, `Category: ${data.category}`);
  const baseUrl = process.env.BASE_URL || 'https://ecrpfm.com';
  await sendPing('document.published', `📄 **New Document Published**\n**Title:** ${data.title}\n**Category:** ${data.category || 'General'}\n**Author:** ${actor.name}\n🔗 ${baseUrl}/fm/documents`);
  return { ok: true };
}

export async function updateDocument(id, data) {
  const actor = await requireActor(3, {allowEventTeam: true});
  const level = parseInt(data.level_required) || 1;
  run("UPDATE documents SET title=?, category=?, content=?, level_required=?, updated_at=datetime('now') WHERE id=?",
    [data.title, data.category, data.content, level, id]);
  logAudit(actor.id, actor.name, 'EDIT', 'document', id, data.title, '');
  return { ok: true };
}

export async function deleteDocument(id) {
  const actor = await requireActor(3, {allowEventTeam: true});
  run("DELETE FROM documents WHERE id=?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'document', id, '', '');
  return { ok: true };
}
