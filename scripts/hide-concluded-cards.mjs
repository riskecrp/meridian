/**
 * Backfill for the thread-card cleanup: remove the THREAD_CREATED cards of
 * intake threads that are already concluded.
 *
 * Works off Discord rather than the database on purpose — the card is only stale
 * if the THREAD's CURRENT NAME says the item is finished, and that is true even
 * for threads whose database row was since removed. Dry run unless --apply.
 */
import { discordFetch, hideThreadCard } from '/opt/meridian/bot/lib/formIntake.js';

const APPLY = process.argv.includes('--apply');

// Scoped to form-submissions by owner's call 2026-08-02 — the fm-feedback cards
// stay. Add channels back here to sweep them.
const CHANNELS = [
  ['form-submissions', '1457571102019555463'],
];

const CONCLUDED = ['[Completed]', '[Rejected]', '[Cancelled]'];

let found = 0, removed = 0;

for (const [label, channelId] of CHANNELS) {
  console.log(`\n=== #${label} ===`);

  // Page back through the channel body collecting every thread card.
  const cards = [];
  let before = null;
  for (;;) {
    const path = `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`;
    const page = await discordFetch('GET', path);
    if (!page?.length) break;
    for (const m of page) if (m.type === 18) cards.push(m);
    before = page[page.length - 1].id;
    if (page.length < 100) break;
  }
  console.log(`${cards.length} thread card(s) in the channel body`);

  for (const card of cards) {
    // The card's own content is the name AS OF CREATION, so ask the thread.
    const thread = await discordFetch('GET', `/channels/${card.id}`).catch(() => null);
    // An orphan — the thread was deleted and the card left behind. It opens
    // nothing, so it is clutter by definition and goes with the concluded ones.
    if (!thread) {
      found++;
      console.log(`  ${APPLY ? 'REMOVE' : 'would'}  ${JSON.stringify(card.content)}   (orphan — thread deleted)`);
      if (APPLY) {
        const ok = await hideThreadCard(card.id, channelId, 'BACKFILL');
        if (ok) removed++;
        await new Promise((r) => setTimeout(r, 400));
      }
      continue;
    }
    const done = CONCLUDED.some((t) => thread.name.startsWith(t));
    const archived = !!thread.thread_metadata?.archived;
    if (!done) {
      console.log(`  keep    ${thread.name}`);
      continue;
    }
    found++;
    console.log(`  ${APPLY ? 'REMOVE' : 'would'}  ${thread.name}   (archived: ${archived})`);
    if (APPLY) {
      const ok = await hideThreadCard(card.id, channelId, 'BACKFILL');
      if (ok) removed++;
      await new Promise((r) => setTimeout(r, 400)); // stay well under the rate limit
    }
  }
}

console.log(`\n${APPLY ? `removed ${removed}/${found} card(s)` : `${found} card(s) would be removed — re-run with --apply`}`);
