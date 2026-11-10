// The bot's ONLY database entry point: a re-export of shared/db.js, so the bot
// and the dashboard share one better-sqlite3 instance and one connection per
// process (DATABASE_PATH from the environment). Nothing under bot/ may import
// better-sqlite3 directly — a second native instance in the same process cannot
// see this one's locks and deletes the WAL under it (audit BOT-1).
export { getDb, query, queryOne, run, transaction } from '../../shared/db.js';
