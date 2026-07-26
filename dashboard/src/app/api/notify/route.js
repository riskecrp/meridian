import { NextResponse } from 'next/server';
import { getRole } from '../../../lib/discord.js';
import { sendPing, pingMentions } from '../../../lib/pings.js';
import { run, queryOne } from '../../../lib/db.js';

function _createLeadershipTask(description) {
  const leadershipRoleId = getRole('fm_leadership');
  const uid = Date.now().toString();
  const dt = new Date().toISOString();
  run(
    "INSERT INTO tasks (task_uid, description, target_id, target_type, claimed_by, created_by_id, created_by_name, created_at, notify_creator) VALUES (?, ?, ?, 'Role', 'None', '', 'System', ?, 0)",
    [uid, description, leadershipRoleId, dt]
  );
}

// Destination channel and the role pinged for each form are configured per route
// in ping_routes (Admin › Pings › Form Submissions), not hardcoded here.
const FORM_CONFIGS = {
  rcf_application: {
    title: 'Recognized Criminal Faction Application',
    color: 3447003,
    route: 'form.rcf_application',
    build: ({ factionName, sheetUrl }) => ({
      description: `A Recognized Criminal Faction Application has been received from **${factionName}**!\n[View the response sheet here](${sheetUrl})`,
    }),
  },
  staff_application: {
    title: 'Faction Management Staff Application',
    color: 15158332,
    route: 'form.staff_application',
    build: ({ applicantName, sheetUrl }) => ({
      description: `A Faction Management Staff Application has been received from **${applicantName}**!\n[View the response sheet here](${sheetUrl})`,
    }),
  },
  garage_request: {
    title: 'Faction Management Garage Request',
    color: 3547003,
    route: 'form.garage_request',
    build: ({ factionName, requestType, sheetUrl }) => ({
      description: `A **${requestType}** Request has been received from **${factionName}**!\n[View the response sheet here](${sheetUrl})`,
    }),
  },
  ci_application: {
    title: 'New CI Application',
    color: 9807270,
    route: 'form.ci_application',
    build: ({ applicantName, sheetUrl }) => ({
      description: `A New CI Application has been received from **${applicantName}**.\n[View the response sheet here](${sheetUrl})`,
    }),
  },
};

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

  // All other forms
  const config = FORM_CONFIGS[formType];
  if (!config) {
    return NextResponse.json({ error: 'Unknown formType.' }, { status: 400 });
  }

  const { description } = config.build(body);
  const embed = { title: config.title, description, color: config.color };
  await sendPing(config.route, null, { embeds: [embed] });
  if (_pingsLeadership(config.route)) {
    _createLeadershipTask(description);
  }
  return NextResponse.json({ ok: true });
}
