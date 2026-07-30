/**
 * Monthly Promotion Review — fires on the 14th at 12:00 UTC
 * Poll result processor  — checks every 5 minutes for closed polls
 */

import cron from 'node-cron';
import { query, queryOne, run } from './lib/db.js';
import { pingChannel, getRole } from './lib/pings.js';
import { logAudit } from './lib/audit.js';

const GUN_CATEGORIES = [
  'Pistol Light', 'Pistol Medium', 'Pistol Heavy',
  'SMG', 'OP SMG',
  'Shotgun', 'Shotgun Auto',
  'Rifle Mk1', 'Rifle Mk2',
  'MG',
];

// ── Discord helpers ────────────────────────────────────────────────────────────

async function discordPost(token, path, body) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Discord POST ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function discordGet(token, path) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Discord GET ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function currentMonthStr() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function threadName() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${y}-${months[now.getUTCMonth()]} Promotion Discussions`;
}

function today() {
  return new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
    .replace(/ /g, '/').toUpperCase();
}

// ── Main review job (14th at 12:00 UTC) ───────────────────────────────────────

async function runPromotionReview(client) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) { console.error('[PROMO] No bot token.'); return; }

  const month = currentMonthStr();
  console.log(`[PROMO] Running promotion review for ${month}`);

  const notes = query(
    `SELECT faction_id, faction_name, status FROM leadership_personal_notes WHERE review_month = ?`,
    [month]
  );

  if (notes.length === 0) {
    console.log('[PROMO] No leadership notes found — skipping.');
    return;
  }

  // Group by faction
  const byFaction = {};
  for (const n of notes) {
    if (!byFaction[n.faction_id]) byFaction[n.faction_id] = { name: n.faction_name, promote: 0, hold: 0, total: 0 };
    byFaction[n.faction_id].total++;
    if (n.status === 'Confirmed Promote') byFaction[n.faction_id].promote++;
    else if (n.status === 'Confirmed Hold') byFaction[n.faction_id].hold++;
  }

  const confirmed = [];
  const discuss   = [];

  for (const [factionId, v] of Object.entries(byFaction)) {
    if (v.total === 0 || v.promote === 0) continue;
    if (v.promote / v.total >= 2 / 3) {
      confirmed.push({ factionId: parseInt(factionId), name: v.name });
    } else {
      discuss.push({ name: v.name, promote: v.promote, hold: v.hold });
    }
  }

  if (confirmed.length === 0 && discuss.length === 0) {
    console.log('[PROMO] No promotions or discussions needed.');
    return;
  }

  // Create thread
  const tName = threadName();
  let thread;
  try {
    const boardChannel = pingChannel('promo.review.thread');
    if (!boardChannel) { console.log('[PROMO] review thread route disabled — skipping'); return; }
    thread = await discordPost(token, `/channels/${boardChannel}/threads`, {
      name: tName,
      auto_archive_duration: 10080,
      type: 11,
    });
    console.log(`[PROMO] Created thread "${tName}" (${thread.id})`);
  } catch (e) {
    console.error('[PROMO] Failed to create thread:', e.message);
    return;
  }

  // Opening ping
  const sections = [];
  if (confirmed.length > 0) sections.push(`**Confirmed Promotions:** ${confirmed.map(f => f.name).join(', ')}`);
  if (discuss.length > 0)   sections.push(`**Needs Discussion:** ${discuss.map(d => `${d.name} (${d.promote} promote / ${d.hold} hold)`).join(', ')}`);

  await discordPost(token, `/channels/${thread.id}/messages`, {
    content: `<@&${getRole('fm_leadership')}> **Promotion Review — ${tName}**\n\n${sections.join('\n')}\n\nWeapon polls for confirmed promotions are below. Polls close in 48 hours.`,
  }).catch(e => console.error('[PROMO] Opening message error:', e.message));

  // Discussion pings
  for (const d of discuss) {
    await discordPost(token, `/channels/${thread.id}/messages`, {
      content: `<@&${getRole('fm_leadership')}> ⚠️ **${d.name}** has a split vote (${d.promote} promote / ${d.hold} hold) — please discuss and reach a decision.`,
    }).catch(e => console.error(`[PROMO] Discussion message error for ${d.name}:`, e.message));
    await new Promise(r => setTimeout(r, 500));
  }

  // Weapon polls for confirmed factions
  for (const faction of confirmed) {
    const factionRow = queryOne("SELECT tier FROM factions WHERE id = ?", [faction.factionId]);
    if (!factionRow) { console.warn(`[PROMO] Faction ${faction.name} not found`); continue; }
    const nextTier = parseInt(factionRow.tier) + 1;

    const authorizedIds = new Set(
      query(`SELECT item_id FROM faction_imports WHERE faction_id = ? AND permitted = 1`, [faction.factionId])
        .map(r => r.item_id)
    );

    const placeholders = GUN_CATEGORIES.map(() => '?').join(',');
    const weapons = query(
      `SELECT id, name, category FROM import_items
       WHERE category IN (${placeholders}) AND CAST(tier AS INTEGER) = ?
       ORDER BY category, name`,
      [...GUN_CATEGORIES, String(nextTier)]
    ).filter(w => !authorizedIds.has(w.id));

    if (weapons.length === 0) {
      await discordPost(token, `/channels/${thread.id}/messages`, {
        content: `**${faction.name} Promotion** — No new Tier ${nextTier} weapons available (all already authorized).`,
      }).catch(() => {});
      continue;
    }

    // Group by category and create one poll per category
    const byCategory = {};
    for (const w of weapons) {
      if (!byCategory[w.category]) byCategory[w.category] = [];
      byCategory[w.category].push(w);
    }

    for (const [category, items] of Object.entries(byCategory)) {
      try {
        const msg = await discordPost(token, `/channels/${thread.id}/messages`, {
          poll: {
            question: { text: `${faction.name} Promotion — ${category}` },
            answers: items.map(w => ({ poll_media: { text: w.name } })),
            allow_multiselect: true,
            duration: 48,
          },
        });

        // Store poll for result processing
        run(
          `INSERT INTO promotion_polls (faction_id, faction_name, next_tier, thread_id, message_id, category, weapon_names, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          [faction.factionId, faction.name, nextTier, thread.id, msg.id, category, JSON.stringify(items.map(w => w.name))]
        );

        console.log(`[PROMO] Poll created: ${faction.name} — ${category} (${items.length} options)`);
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        console.error(`[PROMO] Poll error ${faction.name} ${category}:`, e.message);
      }
    }
  }

  console.log(`[PROMO] Review complete for ${month}.`);
}

// ── Poll result processor ──────────────────────────────────────────────────────

async function processClosedPolls() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  // Find unprocessed polls created more than 48 hours ago
  const closedPolls = query(`
    SELECT * FROM promotion_polls
    WHERE processed = 0
      AND datetime(created_at, '+48 hours') <= datetime('now')
    ORDER BY faction_id, id
  `);

  if (closedPolls.length === 0) return;
  console.log(`[PROMO] Processing ${closedPolls.length} closed poll(s)`);

  // Group by faction
  const byFaction = {};
  for (const p of closedPolls) {
    if (!byFaction[p.faction_id]) byFaction[p.faction_id] = { name: p.faction_name, nextTier: p.next_tier, threadId: p.thread_id, polls: [] };
    byFaction[p.faction_id].polls.push(p);
  }

  for (const [factionId, data] of Object.entries(byFaction)) {
    const approvedWeapons = [];
    let fetchErrors = 0;

    // Fetch results for each poll
    for (const poll of data.polls) {
      try {
        const msg = await discordGet(token, `/channels/${data.threadId}/messages/${poll.message_id}`);
        const answers     = msg.poll?.answers || [];
        const answerCounts = msg.poll?.results?.answer_counts || [];
        const weapons     = JSON.parse(poll.weapon_names);

        for (const ac of answerCounts) {
          if (ac.count > 0) {
            // answer id is 1-indexed, match to answers array
            const answer = answers.find(a => a.answer_id === ac.id);
            const weaponName = answer?.poll_media?.text || weapons[ac.id - 1];
            if (weaponName) approvedWeapons.push(weaponName);
          }
        }

        run("UPDATE promotion_polls SET processed = 1 WHERE id = ?", [poll.id]);
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.error(`[PROMO] Error fetching poll ${poll.message_id}:`, e.message);
        run("UPDATE promotion_polls SET processed = 1 WHERE id = ?", [poll.id]);
        fetchErrors++;
      }
    }

    // If every poll fetch failed, the messages were deleted — skip notification.
    if (fetchErrors === data.polls.length) {
      console.log(`[PROMO] All polls for ${data.name} were unreachable (deleted/archived) — skipping notification.`);
      continue;
    }

    if (approvedWeapons.length === 0) {
      await discordPost(token, `/channels/${data.threadId}/messages`, {
        content: `⚠️ **${data.name}** — No weapon votes were cast. Please review and stage the promotion manually.`,
      }).catch(() => {});

      // Still create a task so it surfaces on the dashboard
      try {
        const uid = Date.now().toString() + Math.floor(Math.random() * 1000);
        run(`INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, created_at, notify_creator)
             VALUES (?, ?, ?, 'Role', 'None', 'promotion-bot', 'Promotion Bot', ?, 0)`,
          [uid, `${data.name} — Promote to Tier ${data.nextTier}\n\nNo weapon votes were recorded. Please review poll results and stage the promotion manually in the Factions dashboard.`, getRole('fm_leadership'), today()]);
        logAudit('', 'Promotion Bot', 'CREATE', 'task', uid, `${data.name} — promote to Tier ${data.nextTier}`, 'no weapon votes recorded; needs manual review');
      } catch {}
      continue;
    }

    // ── Create FM Leadership task with approved imports ─────────────────────────
    try {
      const uid = Date.now().toString() + Math.floor(Math.random() * 1000);
      const taskDesc = [
        `${data.name} — Stage Promotion to Tier ${data.nextTier}`,
        ``,
        `Weapon polls have closed. Approved imports:`,
        ...approvedWeapons.map(w => `• ${w}`),
        ``,
        `Stage the promotion in the Factions dashboard with these imports. This will notify Team Leads to schedule the RP.`,
      ].join('\n');
      run(`INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, created_at, notify_creator)
           VALUES (?, ?, ?, 'Role', 'None', 'promotion-bot', 'Promotion Bot', ?, 0)`,
        [uid, taskDesc, getRole('fm_leadership'), today()]);
      logAudit('', 'Promotion Bot', 'CREATE', 'task', uid, `${data.name} — stage promotion to Tier ${data.nextTier}`, `${approvedWeapons.length} imports approved by poll`);
      console.log(`[PROMO] Task created for ${data.name} promotion`);
    } catch (e) {
      console.error(`[PROMO] Error creating task for ${data.name}:`, e.message);
    }

    // ── Summary in thread ───────────────────────────────────────────────────────
    await discordPost(token, `/channels/${data.threadId}/messages`, {
      content: [
        `<@&${getRole('fm_leadership')}> ✅ **${data.name}** — Polls closed`,
        `**Approved imports (${approvedWeapons.length}):** ${approvedWeapons.join(', ')}`,
        `A task has been created for FM Leadership to stage the promotion. Team Leads will be notified once it is staged.`,
      ].join('\n'),
    }).catch(e => console.error(`[PROMO] Thread summary error for ${data.name}:`, e.message));

    await new Promise(r => setTimeout(r, 800));
  }
}

// ── Exports ────────────────────────────────────────────────────────────────────

export function startPromotionReview(client) {
  // Main review — 14th of each month at 12:00 UTC
  cron.schedule('0 12 14 * *', () => {
    runPromotionReview(client).catch(e => console.error('[PROMO] Uncaught error:', e.message));
  }, { timezone: 'UTC' });

  // Poll result processor — every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    processClosedPolls().catch(e => console.error('[PROMO RESULTS] Uncaught error:', e.message));
  }, { timezone: 'UTC' });

  console.log('[PROMO] Promotion review scheduled — 14th at 12:00 UTC. Result processor running every 5 minutes.');
}
