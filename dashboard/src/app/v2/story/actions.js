"use server";
// Library › Peds. Catalogue of every GTA V ped model — name, joaat hash,
// preview image and tags — seeded by migrations/011_peds.sql (regenerate with
// scripts/build-peds.mjs). Reading is open to everyone in the Library (incl.
// Event Team and Lead Storytellers); tag curation is L2 like the rest of the
// Library's reference content (Event Team is read-only here — policy 4).
//
// The catalogue is 1,100+ rows, so reads are paged server-side: one page of
// 48 peds per request, filtered in SQL. Tag counts and categories are computed
// once per catalogue version and cached in-process.
//
// NOTE: "use server" files may only export async functions — a plain exported
// const builds fine and then throws at action-invoke time.
import { query, queryOne, run } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";
import { logAudit } from "../../../lib/audit.js";
import { str, toInt, fail } from "../../../../../shared/validate.js";

const PAGE_SIZE = 48;
const MAX_PAGE_SIZE = 96;
const COLS = `id, model_name, display_name, hash, hash_hex, category, ped_type, gender, age, dlc,
              image, image_source, props, components, tags, tags_curated, notes, updated_at, updated_by`;

const parseTags = (row) => {
  let tags = [];
  try { tags = JSON.parse(row.tags || "[]"); } catch { tags = []; }
  return { ...row, tags: Array.isArray(tags) ? tags.map(String) : [] };
};

// Facets (categories + tag counts) over the whole catalogue, cached per
// catalogue version (row count + latest edit) so a request costs one small query.
let facetCache = null;
function facets() {
  const sig = queryOne("SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM peds");
  const key = `${sig?.n || 0}|${sig?.u || ''}`;
  if (facetCache && facetCache.key === key) return facetCache.value;
  const categories = query("SELECT DISTINCT category FROM peds WHERE category IS NOT NULL AND category != '' ORDER BY category").map(r => r.category);
  const counts = new Map();
  query("SELECT tags FROM peds").forEach(r => parseTags(r).tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const tagCounts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const value = { categories, tagCounts, total: sig?.n || 0, withImage: queryOne("SELECT COUNT(*) AS n FROM peds WHERE image IS NOT NULL AND image != ''")?.n || 0 };
  facetCache = { key, value };
  return value;
}

/**
 * One page of the ped catalogue.
 * @param {{q?:string, category?:string, tags?:string[], imageOnly?:boolean, page?:number, per?:number}} opts
 * @returns {{rows, page, pages, per, total, matched, categories, tagCounts, withImage}}
 */
export async function getPedsPage(opts = {}) {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  const o = opts && typeof opts === 'object' ? opts : {};
  const q = str(o.q, { max: 80 }).toLowerCase();
  const category = str(o.category, { max: 80 });
  const tags = [...new Set((Array.isArray(o.tags) ? o.tags : []).map(t => str(t, { max: 40 }).toLowerCase()).filter(Boolean))].slice(0, 10);
  const imageOnly = !!o.imageOnly;
  const per = toInt(o.per, { min: 1, max: MAX_PAGE_SIZE, def: PAGE_SIZE });

  const where = [];
  const params = [];
  if (category) { where.push("category = ?"); params.push(category); }
  if (imageOnly) where.push("image IS NOT NULL AND image != ''");
  for (const t of tags) { where.push("EXISTS (SELECT 1 FROM json_each(peds.tags) WHERE value = ?)"); params.push(t); }
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, c => `\\${c}`)}%`;
    where.push(`(model_name LIKE ? ESCAPE '\\' OR LOWER(COALESCE(display_name,'')) LIKE ? ESCAPE '\\' OR CAST(hash AS TEXT) = ? OR LOWER(hash_hex) = ?
      OR LOWER(COALESCE(category,'')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(notes,'')) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM json_each(peds.tags) WHERE value LIKE ? ESCAPE '\\'))`);
    params.push(like, like, q, q, like, like, like);
  }
  const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const matched = queryOne(`SELECT COUNT(*) AS n FROM peds${sql}`, params)?.n || 0;
  const pages = Math.max(1, Math.ceil(matched / per));
  const page = Math.min(toInt(o.page, { min: 1, def: 1 }), pages);
  const rows = query(`SELECT ${COLS} FROM peds${sql} ORDER BY model_name LIMIT ? OFFSET ?`, [...params, per, (page - 1) * per]).map(parseTags);
  return { rows, page, pages, per, matched, ...facets() };
}

// Tags are free text on purpose — staff know their own shorthand. Saving marks
// the row curated so a catalogue refresh (build-peds.mjs) leaves it alone.
export async function updatePedTags(id, tags, notes) {
  const actor = await requireActor(2);
  const pid = toInt(id, { min: 1 });
  const ped = pid ? queryOne("SELECT id, model_name FROM peds WHERE id = ?", [pid]) : null;
  if (!ped) return fail("Ped not found");
  if (tags != null && !Array.isArray(tags)) return fail("Tags must be a list");
  const clean = [...new Set((tags || [])
    .filter(t => typeof t === 'string' || typeof t === 'number')
    .map(t => String(t).trim().toLowerCase().replace(/\s+/g, " "))
    .filter(t => t && t.length <= 40))].sort();
  const note = str(notes, { max: 1000 }) || null;
  run("UPDATE peds SET tags = ?, tags_curated = 1, notes = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
    [JSON.stringify(clean), note, actor.name, pid]);
  facetCache = null;
  logAudit(actor.id, actor.name, "UPDATE", "peds", pid, ped.model_name, `tags: ${clean.join(", ") || "(none)"}`);
  return { ok: true, tags: clean };
}
