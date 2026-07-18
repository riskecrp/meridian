import { query, run } from './lib/db.js';

export function startTaskReminder(client) {
  setInterval(async () => {
    try {
      const tasks = query("SELECT * FROM tasks WHERE claimed_by != 'None' AND next_reminder IS NOT NULL AND next_reminder != ''");
      const now = Date.now();
      for (const task of tasks) {
        if (parseInt(task.next_reminder) <= now) {
          try {
            const user = await client.users.fetch(task.claimed_by);
            if (user) await user.send(`**Task Reminder:**\n${task.description}\n\nPlease complete this task or visit the dashboard to manage it.`);
          } catch (e) { console.log(`Could not DM ${task.claimed_by}`); }
          const newTime = (now + 86400000).toString();
          run("UPDATE tasks SET next_reminder = ? WHERE id = ?", [newTime, task.id]);
        }
      }
    } catch (err) { console.error("Task Reminder Error:", err.message); }
  }, 3600000);
}
