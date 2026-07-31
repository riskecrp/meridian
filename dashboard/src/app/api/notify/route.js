import { NextResponse } from 'next/server';
import { getRole } from '../../../lib/discord.js';
import { sendPing, pingMentions } from '../../../lib/pings.js';
import { run } from '../../../lib/db.js';

function _createLeadershipTask(description) {
  const leadershipRoleId = getRole('fm_leadership');
  const uid = Date.now().toString();
  const dt = new Date().toISOString();
  run(
    "INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, created_at, notify_creator) VALUES (?, ?, ?, 'Role', 'None', '', 'System', ?, 0)",
    [uid, description, leadershipRoleId, dt]
  );
}

// Forms the bot now takes in itself, by polling their response sheets and opening
// a thread per submission (bot/formSubmissions.js).
//
// Their Apps Scripts still POST here on submit and there is no reason to stop
// them: the push arrives with only a name and a link, so it cannot open the
// thread, and answering it with an error would only turn every submission into a
// failure notice in somebody's Google account. It is acknowledged and dropped.
//
// This is also where the auto-created Leadership task for these forms went. The
// thread replaced it — it carries the answers, the ping and the workflow, where
// the task carried a sentence and a link.
const POLLED_FORMS = new Set([
  'rcf_application',
  'staff_application',
  'garage_request',
  'ci_application',
]);

const FEEDBACK_DEPT_MAP = {
  'Legal Faction Management (LFM)':   { route: 'form.faction_feedback.lfm', color: 3066993  },
  'Criminal Faction Management (FM)': { route: 'form.faction_feedback.fm',  color: 15158332 },
};

// A form raises a Leadership task only when FM Leadership is actually among the
// roles the route pings — so retargeting a form's mention retargets its follow-up.
function _pingsLeadership(route) {
  const leadershipId = getRole('fm_leadership');
  if (!leadershipId) return false; // '' would match every string
  return pingMentions(route).includes(leadershipId);
}

export async function POST(req) {
  const secret = req.headers.get('x-notify-secret');
  if (!secret || secret !== process.env.NOTIFY_SECRET) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const { formType } = body;

  // Faction Feedback — conditional role based on department
  if (formType === 'faction_feedback') {
    const { department, entryName } = body;
    const mapping = FEEDBACK_DEPT_MAP[department];
    if (!mapping) {
      return NextResponse.json({ error: 'Unknown department.' }, { status: 400 });
    }
    const embed = {
      title: 'New Faction Feedback Form Received',
      description: `You've received a new submission for **${entryName}**.\n[View the response sheet here](https://docs.google.com/spreadsheets/d/1T6d-I_P1Gvr1nyJctk0-LM3xlXEBUNCi3CMM2MWrUoQ/edit?gid=1222111670#gid=1222111670)`,
      color: mapping.color,
      timestamp: new Date().toISOString(),
    };
    await sendPing(mapping.route, null, { embeds: [embed] });
    if (_pingsLeadership(mapping.route)) {
      _createLeadershipTask(`Faction Feedback — ${entryName}`);
    }
    return NextResponse.json({ ok: true });
  }

  // Taken in by the bot from the response sheet instead — nothing to do here.
  if (POLLED_FORMS.has(formType)) {
    return NextResponse.json({ ok: true, handled_by: 'sheet poller' });
  }

  return NextResponse.json({ error: 'Unknown formType.' }, { status: 400 });
}
