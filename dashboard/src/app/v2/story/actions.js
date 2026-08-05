"use server";
// Library › Peds. Catalogue of every GTA V ped model — name, joaat hash,
// preview image and tags — seeded by migrations/011_peds.sql (regenerate with
// scripts/build-peds.mjs). Reading is open to all staff; tag curation matches
// the rest of the Library's reference content (L2 / Event Team).
//
// NOTE: "use server" files may only export async functions — a plain exported
// const builds fine and then throws at action-invoke time.
import { query, queryOne, run } from "../../../lib/db.js";
import { requireActor } from "../../../lib/requireActor.js";
import { logAudit } from "../../../lib/audit.js";

const parseTags = (row) => {
  let tags = [];
  try { tags = JSON.parse(row.tags || "[]"); } catch { tags = []; }
  return { ...row, tags: Array.isArray(tags) ? tags : [] };
};

export async function getPeds() {
  await requireActor(1, { allowEventTeam: true, allowLeadStoryteller: true });
  return query(`SELECT id, model_name, display_name, hash, hash_hex, category, ped_type,
                       gender, age, dlc, image, props, components, tags, tags_curated,
                       notes, updated_at, updated_by
                FROM peds ORDER BY model_name`).map(parseTags);
}

// Tags are free text on purpose — staff know their own shorthand. Saving marks
// the row curated so a catalogue refresh (build-peds.mjs) leaves it alone.
export async function updatePedTags(id, tags, notes) {
  const actor = await requireActor(2, { allowEventTeam: true });
  const ped = queryOne("SELECT id, model_name FROM peds WHERE id = ?", [id]);
  if (!ped) return { ok: false, error: "Ped not found" };
  const clean = [...new Set((tags || [])
    .map(t => String(t).trim().toLowerCase().replace(/\s+/g, " "))
    .filter(t => t && t.length <= 40))].sort();
  run("UPDATE peds SET tags = ?, tags_curated = 1, notes = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?",
    [JSON.stringify(clean), (notes || "").trim() || null, actor.name, id]);
  logAudit(actor.id, actor.name, "UPDATE", "peds", id, ped.model_name, `tags: ${clean.join(", ") || "(none)"}`);
  return { ok: true, tags: clean };
}
