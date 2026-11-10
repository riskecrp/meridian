import { NextResponse } from 'next/server';
import { getRole } from '../../../lib/discord.js';
import { sendPing, pingMentions } from '../../../lib/pings.js';
import { createTask } from '../../../../../shared/tasks.js';
import { str } from '../../../../../shared/validate.js';

// Inbound form notifications (Google Apps Script on form submit). Every call
// must carry the shared secret in x-notify-secret; a deployment without
// NOTIFY_SECRET accepts nothing.

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

// The response sheet the feedback embed links to. Overridable so a copy of the
// dashboard pointed at another form does not advertise the production sheet.
const FEEDBACK_SHEET_URL = process.env.NOTIFY_FEEDBACK_SHEET_URL
  || 'https://docs.google.com/spreadsheets/d/1T6d-I_P1Gvr1nyJctk0-LM3xlXEBUNCi3CMM2MWrUoQ/edit?gid=1222111670#gid=1222111670';

// The actor the shared task lifecycle records for tasks raised by an inbound form.
const SYSTEM_ACTOR = { id: '', name: 'System', level: 3, rank: 'System', teamId: '', teamName: '', isEventTeam: false, isLeadStoryteller: false, isOwner: false, source: 'site' };

// A form raises a Leadership task only when FM Leadership is actually among the
// roles the route pings — so retargeting a form's mention retargets its follow-up.
function _pingsLeadership(route) {
  const leadershipId = getRole('fm_leadership');
  if (!leadershipId) return false; // '' would match every string
  return pingMentions(route).includes(leadershipId);
}

export async function POST(req) {
  const expected = process.env.NOTIFY_SECRET;
  const secret = req.headers.get('x-notify-secret');
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const formType = str(body.formType, { max: 60 });

  // Faction Feedback — conditional role based on department
  if (formType === 'faction_feedback') {
    const department = str(body.department, { max: 80 });
    // Form text is never allowed to mention anyone (an entry name of "<@&…>" must not ping that role).
    const entryName = str(body.entryName, { max: 120 }).replace(/<@[!&]?\d+>/g, '').replace(/@(everyone|here)/gi, '@\u200b$1').trim();
    const mapping = FEEDBACK_DEPT_MAP[department];
    if (!mapping) return NextResponse.json({ error: 'Unknown department.' }, { status: 400 });
    if (!entryName) return NextResponse.json({ error: 'entryName is required.' }, { status: 400 });
    const embed = {
      title: 'New Faction Feedback Form Received',
      description: `You've received a new submission for **${entryName}**.\n[View the response sheet here](${FEEDBACK_SHEET_URL})`,
      color: mapping.color,
      timestamp: new Date().toISOString(),
    };
    await sendPing(mapping.route, null, { embeds: [embed] });
    let task = null;
    if (_pingsLeadership(mapping.route)) {
      // Through the shared lifecycle: a real uid, ISO date, audit row, Claim/Done buttons.
      const r = await createTask(SYSTEM_ACTOR, { desc: `Faction Feedback — ${entryName}`, targetType: 'Role', targetId: getRole('fm_leadership') }, { via: 'api/notify' });
      if (r.ok) task = r.uid; else console.error('[notify] leadership task not created:', r.error);
    }
    return NextResponse.json({ ok: true, ...(task ? { task } : {}) });
  }

  // Taken in by the bot from the response sheet instead — nothing to do here.
  if (POLLED_FORMS.has(formType)) {
    return NextResponse.json({ ok: true, handled_by: 'sheet poller' });
  }

  return NextResponse.json({ error: 'Unknown formType.' }, { status: 400 });
}
