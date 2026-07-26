// Plain module, deliberately NOT "use server": a server-actions file may only
// export async functions, so this static metadata cannot live in actions.js.
export const PING_GROUPS = [
  { key: 'tasks',        label: 'Tasks',               blurb: 'Assignment, claims, completions and questions.' },
  { key: 'events',       label: 'Events & Reminders',  blurb: 'Scheduled events and reminder firing.' },
  { key: 'promotions',   label: 'Promotions & Reviews', blurb: 'Tier changes and the monthly review cycle.' },
  { key: 'rp',           label: 'RP Changes',          blurb: 'NPC, HQ and turf change requests.' },
  { key: 'forms',        label: 'Form Submissions',    blurb: 'Applications and feedback arriving from external forms.' },
  { key: 'comms',        label: 'Communications',      blurb: 'Copies of announcements filed in FM channels.' },
  { key: 'storytelling', label: 'Storytelling',        blurb: 'Change log, scene ideas and scene logs.' },
  { key: 'records',      label: 'Records & Reports',   blurb: 'Documents, hours reports and the forum feed.' },
];
