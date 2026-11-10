// Daily DM to the claimer of a claimed, still-open task that was created with
// the "DM reminder" option. Completing (or unclaiming / reassigning) clears
// next_reminder, so a finished task never nags. next_reminder is an ISO
// timestamp; parseDate also reads the epoch strings older rows carry.
import { query, run } from './lib/db.js';
import { pingEnabled, urls } from './lib/pings.js';
import { parseDate } from '../shared/dates.js';

const DAY_MS = 86400000;

export async function runTaskReminders(client, now = Date.now()) {
  if (!pingEnabled('task.reminder.dm')) return 0;
  const tasks = query("SELECT * FROM tasks WHERE status = 'open' AND claimed_by != 'None' AND claimed_by != '' AND next_reminder IS NOT NULL AND next_reminder != ''");
  let sent = 0;
  for (const task of tasks) {
    const due = parseDate(task.next_reminder);
    if (!due || due.getTime() > now) continue;
    try {
      const user = await client.users.fetch(task.claimed_by);
      if (user) {
        await user.send(`**Task Reminder:**\n${task.description}\n\nPlease complete this task, or open it on the dashboard: ${urls.task(task.task_uid)}`);
        sent++;
      }
    } catch (e) { console.log(`[task reminder] Could not DM ${task.claimed_by}: ${e.message}`); }
    run("UPDATE tasks SET next_reminder = ? WHERE id = ?", [new Date(now + DAY_MS).toISOString(), task.id]);
  }
  return sent;
}

export function startTaskReminder(client) {
  setInterval(() => runTaskReminders(client).catch(err => console.error('Task Reminder Error:', err.message)), 3600000);
}
