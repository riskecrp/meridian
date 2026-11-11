// Background-job health, judged from sync_status (written by syncStatus.js on
// every run of every job). Pure: it depends on shared/db.js only, so the
// dashboard's /api/health route imports it unchanged and both surfaces agree
// on what "late" and "failing" mean.
//
//   late     no successful run for more than LATE_FACTOR × the job's own
//            cadence (expected_every_minutes; 0 = not judged). A job that has
//            never succeeded is measured from its last attempt, or from the row
//            itself, so a seeded job that never started shows up too.
//   failing  FAILING_AFTER or more failures in a row, whatever the cadence.
//   ok       everything else.
import { query, run } from '../../shared/db.js';
import { parseDate } from '../../shared/dates.js';

export const LATE_FACTOR = 3;
export const FAILING_AFTER = 3;

const ms = (v) => parseDate(v)?.getTime() ?? null;

/** Classify one sync_status row. Exported for tests; healthReport() is the usual entry. */
export function classifyJob(row, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const lastOk = ms(row.last_ok_at);
  const ref = lastOk ?? ms(row.last_run_at) ?? ms(row.updated_at);
  const ageMinutes = ref == null ? null : Math.max(0, Math.round((nowMs - ref) / 60000));
  const cadence = Number(row.expected_every_minutes) || 0;
  let status = 'ok';
  if (Number(row.consecutive_failures) >= FAILING_AFTER) status = 'failing';
  else if (cadence > 0 && (ageMinutes == null || ageMinutes > cadence * LATE_FACTOR)) status = 'late';
  return {
    job: row.job,
    label: row.label || row.job,
    status,
    lastOk: row.last_ok_at || null,
    lastError: row.last_error || '',
    ageMinutes,
    expectedEveryMinutes: cadence,
    consecutiveFailures: Number(row.consecutive_failures) || 0,
  };
}

/**
 * { ok, jobs: [{ job, label, status: 'ok'|'late'|'failing', lastOk, lastError, ageMinutes }] }
 * `ok` is false when any job is late or failing. Never throws: a database
 * problem is reported as a single failing pseudo-job so the caller can still
 * answer (and the health endpoint still returns 503).
 */
export function healthReport({ now = Date.now() } = {}) {
  let rows;
  try { rows = query('SELECT * FROM sync_status ORDER BY job'); }
  catch (e) { return { ok: false, jobs: [{ job: 'sync_status', label: 'Job health table', status: 'failing', lastOk: null, lastError: e.message, ageMinutes: null }] }; }
  const jobs = rows.map(r => classifyJob(r, now));
  return { ok: jobs.every(j => j.status === 'ok'), jobs, checkedAt: new Date(now instanceof Date ? now.getTime() : now).toISOString() };
}

/**
 * Make sure a job's sync_status row exists with its label and cadence, so a job
 * that has never run is visible and judged from day one. Never throws.
 */
export function registerJob(job, label, expectedEveryMinutes = 0) {
  try {
    run("INSERT OR IGNORE INTO sync_status (job, label, expected_every_minutes) VALUES (?, ?, ?)", [job, label, expectedEveryMinutes]);
    run("UPDATE sync_status SET label = ?, expected_every_minutes = ? WHERE job = ?", [label, expectedEveryMinutes, job]);
  } catch (e) { console.error('[HEALTH] registerJob', job, e.message); }
}

/**
 * Compare a report with the previously seen state and return the alerts worth
 * sending: a job that turned late/failing, or one that recovered. `state` is a
 * Map(job → status) the caller keeps between runs; it is updated in place.
 * Jobs seen for the first time alert only when they are not ok.
 */
export function diffHealth(state, report) {
  const alerts = [];
  for (const j of report.jobs) {
    const prev = state.get(j.job);
    if (prev === j.status) continue;
    state.set(j.job, j.status);
    if (j.status !== 'ok') alerts.push({ kind: j.status, job: j });
    else if (prev && prev !== 'ok') alerts.push({ kind: 'recovered', job: j });
  }
  for (const job of [...state.keys()]) if (!report.jobs.some(j => j.job === job)) state.delete(job);
  return alerts;
}
