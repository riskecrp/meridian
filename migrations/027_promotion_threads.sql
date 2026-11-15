-- 027_promotion_threads.sql
-- One row per month's "YYYY-MON Promotion Discussions" thread. Promotions now
-- open their weapon polls as soon as leadership confirms them (not only on the
-- 14th), so the thread can be created by whichever comes first; this records
-- it once, plus whether the 14th's summary message has been posted in it.
CREATE TABLE IF NOT EXISTS promotion_threads (
  month TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  summary_posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Months that already had polls: the thread exists and its summary went out.
INSERT OR IGNORE INTO promotion_threads (month, thread_id, summary_posted_at, created_at)
  SELECT strftime('%Y-%m', created_at), thread_id, MIN(created_at), MIN(created_at)
    FROM promotion_polls GROUP BY strftime('%Y-%m', created_at);
