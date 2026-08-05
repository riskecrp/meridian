#!/usr/bin/env node
// Builds the Library › Peds catalogue: one seed SQL file + the preview images.
//
// SOURCES (wiki.rage.mp/wiki/Peds is the reference everyone links to, but it sits
// behind a Cloudflare bot challenge that 403s every server-side fetch — page, raw
// wikitext and images alike. These two carry the same data, machine-readable):
//   1. DurtyFree/gta-v-data-dumps peds.json — model name, joaat hash, ped type,
//      DLC pack and the game's own English display name.
//   2. docs.fivem.net ped-models doc — the category grouping (Ambient male,
//      Scenario female, Animals, …) and a preview image per model.
// Union of the two; hashes for models missing from the dump are computed locally.
//
// Usage:  node scripts/build-peds.mjs [--no-images]
// Writes: migrations/011_peds.sql, dashboard/public/peds/<model>.webp
// Re-running is safe: images already on disk are skipped, and the SQL is
// INSERT OR IGNORE + an UPDATE that leaves curated tags (tags_curated=1) alone.

import { writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMG_DIR = path.join(ROOT, "dashboard/public/peds");
const OUT_SQL = path.join(ROOT, "migrations/011_peds.sql");
const DUMP_URL = "https://raw.githubusercontent.com/DurtyFree/gta-v-data-dumps/master/peds.json";
const DOC_URL = "https://raw.githubusercontent.com/citizenfx/fivem-docs/master/content/docs/game-references/ped-models.md";
const IMG_BASE = "https://docs.fivem.net/peds";
const doImages = !process.argv.includes("--no-images");

/* ── joaat, for models the dump doesn't carry ── */
function joaat(str) {
  let h = 0;
  for (const ch of str.toLowerCase()) {
    h = (h + ch.charCodeAt(0)) >>> 0;
    h = (h + (h << 10)) >>> 0;
    h = (h ^ (h >>> 6)) >>> 0;
  }
  h = (h + (h << 3)) >>> 0;
  h = (h ^ (h >>> 11)) >>> 0;
  h = (h + (h << 15)) >>> 0;
  return h >>> 0;
}

/* ── Tag vocabulary ──────────────────────────────────────────────────────────
   Matched against the model name's descriptive part AND the English display
   name. Deliberately conservative: a ped that matches nothing still gets its
   structural tags (category / gender / age), and staff can curate from there. */
const THEME = [
  // places & scenes
  [["airworker", "airhostess", "airport", "pilot", "aircrew"], ["airport"]],
  [["beach", "baywatch", "lifeguard", "swimmer", "surfer"], ["beach"]],
  [["bevhills", "beverly", "golfer", "yoga", "tennis", "vinewood", "milton"], ["vinewood", "wealthy"]],
  [["downtown", "ktown", "korean town"], ["downtown"]],
  [["soucent", "socenlat", "south central"], ["south central"]],
  [["eastsa", "east los"], ["east los santos"]],
  [["salton", "hillbilly", "cntrybar", "country", "rurmeth", "farmer", "rancher"], ["rural"]],
  [["skidrow", "tramp", "hobo", "vagrant", "homeless"], ["skid row"]],
  [["paparazzi", "movprem", "movspace", "movalien", "movie", "actor", "director"], ["movie"]],
  [["casino", "croupier", "gambler"], ["casino"]],
  [["dockwork", "docks", "longshoreman", "stevedore"], ["docks"]],
  [["sweatshop", "factory", "prod", "assembly"], ["factory"]],
  [["motel", "hotel", "bellboy", "concierge"], ["hotel"]],
  [["prison", "prisguard", "prisoner", "inmate"], ["prison"]],
  [["hospital", "autopsy", "morgue"], ["hospital"]],
  [["church", "priest", "preacher", "strpreach", "nun"], ["religion"]],
  [["school", "student", "teacher", "professor"], ["education"]],
  [["train", "lsmetro", "metro", "conductor", "subway"], ["transit"]],
  [["gunclub", "ammucity", "ammudrop", "shooting range"], ["firearms"]],
  [["strip", "stripper", "hooker", "prostitute", "tranvest", "escort"], ["nightlife", "adult"]],
  [["bouncer", "bartender", "barman", "waiter", "waitress", "busboy", "linecook", "chef", "cook", "sommelier", "hostess"], ["hospitality"]],
  [["shop_high", "shop_low", "shop_mask", "shopkeep", "clerk", "cashier", "salesman", "vendor", "strvend", "retail"], ["retail"]],
  // jobs & services
  [["cop", "hwaycop", "sheriff", "snowcop", "trooper", "police", "officer", "detective", "swat", "fib", "ranger", "marshal"], ["law enforcement"]],
  [["paramedic", "doctor", "nurse", "surgeon", "medic", "scrubs"], ["medical"]],
  [["fireman", "firefighter", "fire"], ["fire service"]],
  [["marine", "army", "soldier", "milita", "blackops", "military", "sniper"], ["military"]],
  [["security", "prolsec", "highsec", "chemsec", "devinsec", "fibsec", "armoured", "guard", "bodyguard", "pescort"], ["security"]],
  [["construct", "builder", "roadwork", "surveyor", "welder", "scaffold"], ["construction"]],
  [["mechanic", "xmech", "autoshop", "tow", "valet", "carwash"], ["motoring"]],
  [["gardener", "gard", "landscap", "groundskeeper"], ["groundskeeping"]],
  [["janitor", "winclean", "cleaner", "garbage", "trash", "sanitation", "maid"], ["maintenance"]],
  [["trucker", "postal", "ups", "courier", "delivery", "gentransport", "driver", "taxi", "cabbie", "chauffeur", "busdriver"], ["transport"]],
  [["dealer", "hustler", "pusher"], ["drugs"]],
  [["scientist", "labtech", "chemist"], ["science"]],
  [["banker", "business", "bankman", "executive", "lawyer", "accountant", "estate", "realtor"], ["business"]],
  [["reporter", "anchor", "journalist", "camera", "grip", "gaffer", "soundman"], ["media"]],
  [["hairdress", "barber", "beautician", "tattoo", "stylist"], ["personal care"]],
  [["miner", "oil", "rig", "roughneck"], ["industry"]],
  [["fisher", "fishing", "sailor", "boat", "captain", "deckhand"], ["maritime"]],
  [["mariachi", "busker", "musician", "dj", "singer", "rapper", "drummer"], ["music"]],
  [["clown", "mime", "mascot", "entertainer", "magician", "juggler"], ["entertainer"]],
  [["migrant", "labour", "labor", "day labourer"], ["labour"]],
  // look & lifestyle
  [["hipster", "beard", "indie"], ["hipster"]],
  [["tourist", "visitor", "hiker", "camper", "backpacker"], ["tourist"]],
  [["bodybuild", "muscl", "stmuscl", "gym", "trainer", "athlete", "jogger", "runner", "cyclist", "skater", "boxer"], ["fitness"]],
  [["fatlatin", "fatwhite", "fatbla", "fatcult", "obese"], ["heavyset"]],
  [["cult", "fatcult", "hippy", "hippie", "protester", "activist"], ["counterculture"]],
  [["punk", "strpunk", "goth", "metal"], ["punk"]],
  [["biker", "lost", "chopper", "motorcycl"], ["biker"]],
  [["junkie", "meth", "crackhead", "addict", "drunk", "alcoholic"], ["addiction"]],
  [["bride", "groom", "wedding", "party", "clubber", "partygoer"], ["party"]],
  [["kid", "child", "boy", "girl", "teen"], ["youth"]],
  [["zombie", "alien", "ghost", "clown", "monster", "impotent", "creature"], ["costume"]],
  [["santa", "xmas", "christmas", "snowman", "halloween", "bunny"], ["holiday"]],
  [["diver", "scuba", "wetsuit", "juggalo", "parachut", "skydiv"], ["outdoor"]],
  // gangs / crews
  [["balla"], ["gang", "ballas"]],
  [["famca", "famdnf", "famfor", "families"], ["gang", "families"]],
  [["vagos", "mexgoon", "mexboss", "mexlabor", "mexthug"], ["gang", "vagos"]],
  [["azteca"], ["gang", "aztecas"]],
  [["salva", "marabunta"], ["gang", "marabunta"]],
  [["korean", "korlieut", "korboss"], ["gang", "korean mob"]],
  [["armgoon", "armboss", "armlieut", "armenian"], ["gang", "armenian mob"]],
  [["chigoon", "chiboss", "chin", "triad"], ["gang", "triads"]],
  [["lost"], ["gang", "the lost"]],
  [["cartel", "colombian"], ["gang", "cartel"]],
  [["mafia", "mob", "gambetti"], ["gang", "mafia"]],
  [["robber", "thief", "burglar", "criminal", "gunman", "goon", "thug", "enforcer", "hitman"], ["criminal"]],
  // (animals need no keyword row — the "animal" tag comes from the ped type,
  //  and ANIMAL_KIND below names the species.)
];
const ANIMAL_KIND = {
  boar: "boar", chimp: "chimp", chop: "dog", cow: "cow", coyote: "coyote", cat: "cat", deer: "deer",
  fish: "fish", hen: "chicken", husky: "dog", shepherd: "dog", humpback: "whale", killerwhale: "whale",
  mtlion: "mountain lion", pig: "pig", poodle: "dog", pug: "dog", rabbit: "rabbit", rat: "rat",
  retriever: "dog", rottweiler: "dog", seagull: "bird", sharkham: "shark", sharktiger: "shark",
  crow: "bird", pigeon: "bird", westy: "dog", dolphin: "dolphin", stingray: "stingray", panther: "panther",
  cormorant: "bird", chickenhawk: "bird", cougar: "mountain lion",
};

const AGE = { y: "young", m: "middle-aged", o: "old" };
const PREFIX = {
  a: "ambient", s: "scenario", g: "gang", u: "unique", ig: "story", cs: "cutscene",
  csb: "cutscene", mp: "multiplayer", hc: "heist crew", player: "player",
};

function deriveTags({ model, display, category, pedType, dlc }) {
  const tags = new Set();
  const parts = model.split("_");
  const isAnimal = model.startsWith("a_c_") || pedType === "animal";

  // structural: where the model comes from
  const prefixTag = PREFIX[parts[0]];
  if (prefixTag) tags.add(prefixTag);
  if (isAnimal) { tags.add("animal"); tags.delete("ambient"); }
  if (model.startsWith("mp_")) tags.add("multiplayer");
  if (category) {
    const c = category.toLowerCase();
    if (c.includes("story")) tags.add("story");
    if (c.includes("cutscene")) tags.add("cutscene");
    if (c.includes("multiplayer")) tags.add("multiplayer");
  }
  // DlcName covers base-game patch packs too ("patchday3ng"); only the mp* packs
  // are actual DLC content, so only those earn the tag.
  if (dlc && dlc.startsWith("mp")) tags.add("dlc");

  // Gender: the naming convention is the reliable signal (the dump's
  // PoseMatcherName says "male" for plainly female peds), ped type is the
  // fallback for named story peds, which carry no gender token.
  let gender = null;
  if (!isAnimal) {
    if (["a", "s", "g", "u", "mp"].includes(parts[0]) && ["f", "m"].includes(parts[1])) gender = parts[1] === "f" ? "female" : "male";
    else if (pedType === "civfemale") gender = "female";
    else if (pedType === "civmale") gender = "male";
    if (gender) tags.add(gender);
  }
  let age = null;
  if (["a", "s", "g", "u"].includes(parts[0]) && AGE[parts[2]]) { age = AGE[parts[2]]; tags.add(age); }

  // ped type → the obvious professional tags the naming doesn't always spell out
  const pt = (pedType || "").toLowerCase();
  if (pt === "cop" || pt === "swat") tags.add("law enforcement");
  if (pt === "medic") tags.add("medical");
  if (pt === "fireman") tags.add("fire service");
  if (pt === "army") tags.add("military");
  if (pt.startsWith("gang_")) tags.add("gang");

  // Theme keywords, over the model name's own tokens plus the display name.
  // Short keywords must BE a token — substring matching on them is how
  // "Boardwalker" ends up tagged as a boar. Long ones may match inside a
  // compound fragment ("ballaeast", "paramedic"), which is the point.
  const words = `${model} ${display || ""}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const blob = words.join(" ");
  for (const [needles, out] of THEME) {
    const hit = needles.some(n => n.length >= 5 ? blob.includes(n) : words.includes(n));
    if (hit) out.forEach(t => tags.add(t));
  }
  if (isAnimal) {
    // Longest match only, on the species part of the name: "pigeon" is a bird,
    // not a pig.
    const species = parts.slice(2).join("_") || model;
    const hit = Object.keys(ANIMAL_KIND).filter(n => species.includes(n)).sort((a, b) => b.length - a.length)[0];
    if (hit) tags.add(ANIMAL_KIND[hit]);
  }
  return { tags: [...tags].sort(), gender, age };
}

/* ── sources ── */
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

function parseDoc(md) {
  // Setext headings ("Ambient female" + "-----") separate the category blocks.
  const out = new Map();
  const lines = md.split("\n");
  let category = null;
  for (let i = 0; i < lines.length; i++) {
    if (/^-{3,}\s*$/.test(lines[i]) && lines[i - 1]?.trim() && !lines[i - 1].includes("<")) {
      category = lines[i - 1].trim();
      continue;
    }
    const m = lines[i].match(/<strong>([a-z0-9_]+)<\/strong>(?:<br>(\d+) props?)?(?:<br>(\d+) components?)?/i);
    if (m) out.set(m[1].toLowerCase(), { category, props: m[2] ? +m[2] : null, components: m[3] ? +m[3] : null });
  }
  return out;
}

/* ── images ── */
async function fetchImages(models) {
  await mkdir(IMG_DIR, { recursive: true });
  const have = new Set((await readdir(IMG_DIR).catch(() => [])).map(f => f.replace(/\.webp$/, "")));
  const todo = models.filter(m => !have.has(m));
  const ok = new Set(have);
  let done = 0, missing = 0;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const model = queue.shift();
      try {
        const r = await fetch(`${IMG_BASE}/${model}.webp`);
        if (r.ok && (r.headers.get("content-type") || "").includes("image")) {
          await writeFile(path.join(IMG_DIR, `${model}.webp`), Buffer.from(await r.arrayBuffer()));
          ok.add(model);
        } else missing++;
      } catch { missing++; }
      if (++done % 100 === 0) process.stdout.write(`  images ${done}/${todo.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`  images: ${ok.size} on disk, ${missing} with no preview available`);
  return ok;
}

const q = (v) => v == null || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

/* ── main ── */
const [dump, doc] = await Promise.all([getJSON(DUMP_URL), getText(DOC_URL)]);
const docModels = parseDoc(doc);
console.log(`sources: ${dump.length} peds in the data dump, ${docModels.size} in the FiveM doc`);

const byModel = new Map();
for (const p of dump) {
  const model = p.Name.toLowerCase();
  if (model.startsWith("slod_")) continue; // LOD placeholders, not spawnable peds
  byModel.set(model, {
    model,
    display: p.TranslatedDirectorName?.English || null,
    hash: p.Hash >>> 0,
    hex: p.HexHash || "0x" + (p.Hash >>> 0).toString(16).toUpperCase().padStart(8, "0"),
    // Case is inconsistent in the dump (civmale / CIVFEMALE / Animal).
    pedType: (p.Pedtype || "").toLowerCase() || null,
    dlc: p.DlcName || null,
  });
}
for (const [model] of docModels) {
  if (!byModel.has(model)) {
    const h = joaat(model);
    byModel.set(model, { model, display: null, hash: h, hex: "0x" + h.toString(16).toUpperCase().padStart(8, "0"), pedType: null, dlc: null });
  }
}

const rows = [...byModel.values()].map(p => {
  const d = docModels.get(p.model) || {};
  const { tags, gender, age } = deriveTags({ ...p, category: d.category });
  return { ...p, category: d.category || null, props: d.props ?? null, components: d.components ?? null, tags, gender, age };
}).sort((a, b) => a.model.localeCompare(b.model));

const withImage = doImages ? await fetchImages(rows.map(r => r.model)) : new Set(
  (await readdir(IMG_DIR).catch(() => [])).map(f => f.replace(/\.webp$/, ""))
);
rows.forEach(r => { r.image = withImage.has(r.model) ? `${r.model}.webp` : null; });

const sql = [];
sql.push("-- Library › Peds catalogue. GENERATED by scripts/build-peds.mjs — do not hand-edit.");
sql.push(`-- ${rows.length} peds · ${rows.filter(r => r.image).length} with a preview image.`);
sql.push("-- Sources: DurtyFree/gta-v-data-dumps peds.json + docs.fivem.net ped models.");
sql.push(`CREATE TABLE IF NOT EXISTS peds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  hash INTEGER NOT NULL,
  hash_hex TEXT NOT NULL,
  category TEXT,
  ped_type TEXT,
  gender TEXT,
  age TEXT,
  dlc TEXT,
  image TEXT,
  props INTEGER,
  components INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  tags_curated INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT,
  updated_by TEXT
);`);
sql.push("CREATE INDEX IF NOT EXISTS idx_peds_model ON peds(model_name);");
for (const r of rows) {
  const vals = [q(r.model), q(r.display), r.hash, q(r.hex), q(r.category), q(r.pedType), q(r.gender), q(r.age), q(r.dlc), q(r.image), r.props ?? "NULL", r.components ?? "NULL", q(JSON.stringify(r.tags))];
  sql.push(`INSERT OR IGNORE INTO peds (model_name, display_name, hash, hash_hex, category, ped_type, gender, age, dlc, image, props, components, tags) VALUES (${vals.join(", ")});`);
  // Refresh facts on a re-run, but never trample tags a human has curated.
  sql.push(`UPDATE peds SET display_name=${q(r.display)}, hash=${r.hash}, hash_hex=${q(r.hex)}, category=${q(r.category)}, ped_type=${q(r.pedType)}, gender=${q(r.gender)}, age=${q(r.age)}, dlc=${q(r.dlc)}, image=${q(r.image)}, props=${r.props ?? "NULL"}, components=${r.components ?? "NULL"}, tags=CASE WHEN tags_curated=1 THEN tags ELSE ${q(JSON.stringify(r.tags))} END WHERE model_name=${q(r.model)};`);
}
await writeFile(OUT_SQL, sql.join("\n") + "\n");

const tagCount = new Map();
rows.forEach(r => r.tags.forEach(t => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
console.log(`wrote ${path.relative(ROOT, OUT_SQL)}: ${rows.length} peds, ${rows.filter(r => r.image).length} with images, ${tagCount.size} distinct tags`);
console.log("top tags:", [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, n]) => `${t}(${n})`).join(" "));
const untagged = rows.filter(r => r.tags.length <= 1);
if (untagged.length) console.log(`thin tagging on ${untagged.length}: ${untagged.slice(0, 12).map(r => r.model).join(", ")}${untagged.length > 12 ? "…" : ""}`);
