import { run } from './db.js';

/**
 * Background job health, recorded where the dashboard can read it.
 *
 * Every scheduled job should call one of these on every run. The point is not
 * the successes — it is that a job which stops calling ok() is visible, and one
 * that calls fail() repeatedly is visible with the reason attached. Both of
 * Meridian's syncs used to swallow their errors into journald, where nobody
 * looks until something has already gone wrong.
 *
 * Neither of these throws. Recording health must never be the thing that breaks
 * the job whose health is being recorded.
 */

const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/**
 * A run finished cleanly. `detail` is a short human summary of what it did —
 * "42 messages across 6 channels" — which turns the row from a green tick into
 * something you can sanity-check at a glance.
 */
export function recordSyncOk(job, detail = '') {
  try {
    run(
      `INSERT INTO sync_status (job, label, last_run_at, last_ok_at, last_detail, last_error, consecutive_failures, runs, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 0, 1, ?)
       ON CONFLICT(job) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         last_ok_at  = excluded.last_ok_at,
         last_detail = excluded.last_detail,
         -- The error text is kept until a good run replaces it, so a recovered
         -- job does not erase the evidence of why it was failing mid-investigation.
         last_error = '',
         consecutive_failures = 0,
         runs = sync_status.runs + 1,
         updated_at = excluded.updated_at`,
      [job, job, nowStr(), nowStr(), String(detail).slice(0, 300), nowStr()],
    );
  } catch (e) { console.error('[SYNC_STATUS]', job, e.message); }
}

/** A run failed. The counter is what distinguishes a blip from a broken job. */
export function recordSyncFail(job, error) {
  const message = (error?.message || String(error || 'unknown error')).slice(0, 300);
  try {
    run(
      `INSERT INTO sync_status (job, label, last_run_at, last_error, last_error_at, consecutive_failures, runs, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?)
       ON CONFLICT(job) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         last_error = excluded.last_error,
         last_error_at = excluded.last_error_at,
         consecutive_failures = sync_status.consecutive_failures + 1,
         runs = sync_status.runs + 1,
         updated_at = excluded.updated_at`,
      [job, job, nowStr(), message, nowStr(), nowStr()],
    );
  } catch (e) { console.error('[SYNC_STATUS]', job, e.message); }
}
