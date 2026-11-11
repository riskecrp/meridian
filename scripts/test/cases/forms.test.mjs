// Hosted intake forms (dashboard/src/app/forms): the shared definitions, the
// public submit action (no login, honeypot, validation, per-IP rate limit, text
// hygiene) and the row it writes — which must be the row the bot's sheet poller
// would have written, so bot/lib/formIntake.js identify() and the feedback
// column patterns are checked against the field names here.
import { readFileSync } from 'node:fs';
import { ok, eq, pass, failsWith } from '../lib.mjs';
import { query, queryOne, run } from '../../../shared/db.js';
import { FORM_DEFS, formDef, validateSubmission, cleanText, HONEYPOT_FIELD, FEEDBACK_TEAM_VALUE } from '../../../dashboard/src/lib/formDefs.js';
import { identify, rowPayload, payloadToRow, valueByHeader, intakeSource, sheetPollingEnabled, webIntakeEnabled } from '../../../bot/lib/formIntake.js';

// Public: no session cookie at all.
globalThis.__cookies = {};
const ip = (addr) => { globalThis.__headers = { host: 'localhost:3000', 'x-forwarded-for': `${addr}, 10.0.0.1` }; };
ip('203.0.113.5');
const F = await import('../../../dashboard/src/app/forms/actions.js');
const lastAudit = () => queryOne('SELECT actor_name, action, target_type, target_id, target_label, details FROM site_audit_log ORDER BY id DESC LIMIT 1');
const countRows = (t) => queryOne(`SELECT count(*) n FROM ${t}`).n;

// ── definitions ──
eq(FORM_DEFS.map(f => f.key).join(), 'rcf_application,staff_application,garage_request,ci_application,faction_feedback', 'five forms, bot keys');
for (const d of FORM_DEFS) {
  const names = d.fields.map(f => f.name);
  ok(new Set(names).size === names.length, `${d.key}: field names unique`);
  ok(d.fields.every(f => ['text', 'textarea', 'select', 'discord', 'url', 'date', 'fixed'].includes(f.type)), `${d.key}: known field types`);
  ok(d.fields.filter(f => f.type === 'select').every(f => f.options?.length), `${d.key}: selects have options`);
  if (d.key !== 'faction_feedback') {
    // Every title/contact pattern the bot resolves the thread name and follow-up
    // handle with must hit one of the questions, so a web row identifies like a
    // sheet row (and never falls back to "first short answer").
    for (const re of d.identify.title) ok(names.some(n => re.test(n)), `${d.key}: title pattern ${re} matches a field`);
    ok(names.some(n => d.identify.contact[0].test(n)), `${d.key}: primary contact pattern matches a field`);
  }
}
// The patterns are copies of the bot's; they must not drift.
const { FORMS } = await import('../../../bot/formSubmissions.js');
for (const bf of FORMS) {
  const d = formDef(bf.key);
  eq(d.identify.title.map(String).join('|'), bf.title.map(String).join('|'), `${bf.key}: title patterns equal the bot's`);
  eq(d.identify.contact.map(String).join('|'), bf.contact.map(String).join('|'), `${bf.key}: contact patterns equal the bot's`);
}
{ const src = readFileSync(new URL('../../../bot/factionFeedback.js', import.meta.url), 'utf8');
  const fb = formDef('faction_feedback');
  for (const [k, re] of Object.entries(fb.identify)) ok(src.includes(`${k}: ${re},`), `feedback COLS.${k} = ${re} in bot/factionFeedback.js`);
  ok(src.includes(`'${FEEDBACK_TEAM_VALUE}'`), 'feedback team value equals the bot default');
  // Each column pattern's FIRST non-empty match in field order must be the intended field.
  const header = fb.fields.map(f => f.name); const row = fb.fields.map(f => f.type === 'fixed' ? f.value : 'x');
  const want = { team: 'Which team is this for?', faction: 'Which faction is this feedback about?', character: 'Character name', discord: 'Your Discord username', occurred: 'When did this occur?' };
  for (const [k, re] of Object.entries(fb.identify)) eq(header[valueByHeader(header, row, re).index], want[k], `feedback: ${k} resolves to the right column`); }
pass('definitions');

// ── validation (pure) ──
{ const d = formDef('garage_request');
  const v = validateSubmission(d, {}); ok(!v.ok && /Faction is required/.test(v.error) && Object.keys(v.errors).length === 5, 'required fields reported'); }
{ const d = formDef('rcf_application');
  const base = { 'Faction Name': 'The Reapers', 'Faction Leader Name': 'Jay', 'Faction Leader Discord': 'jay_leader', 'How many active members does the faction have?': '10 to 14', 'How long has the faction been active on the server?': '3 months', 'Faction backstory and concept': 'Long story', 'What does the faction do day to day?': 'Things', 'Why should this faction be recognized?': 'Because' };
  ok(validateSubmission(d, base).ok, 'valid rcf');
  ok(/choose one/.test(validateSubmission(d, { ...base, 'How many active members does the faction have?': '7' }).error), 'select must be an option');
  ok(/Discord username/.test(validateSubmission(d, { ...base, 'Faction Leader Discord': '<@123456789012345678>' }).error), 'mention is not a discord handle');
  ok(/Discord username/.test(validateSubmission(d, { ...base, 'Faction Leader Discord': 'https://discord.gg/abc' }).error), 'link is not a discord handle');
  ok(/https:\/\//.test(validateSubmission(d, { ...base, 'Faction Discord invite link': 'discord.gg/abc' }).error), 'url needs a scheme');
  ok(validateSubmission(d, { ...base, 'Faction Discord invite link': 'https://discord.gg/abc' }).ok, 'url ok');
  const clean = validateSubmission(d, base).clean; eq(Object.keys(clean).join('|'), d.fields.map(f => f.name).join('|'), 'clean keeps every field in form order'); eq(clean['Anything else Faction Management should know?'], '', 'optional blank stays empty string'); }
{ const d = formDef('faction_feedback'); const base = { 'Which faction is this feedback about?': 'The Vanguard', 'Character name': 'Tyrone', 'Your Discord username': 'ty.rone', 'When did this occur?': '2026-11-02', 'What happened? Describe the roleplay and your feedback': 'A thing' };
  ok(validateSubmission(d, base).ok && validateSubmission(d, base).clean['Which team is this for?'] === FEEDBACK_TEAM_VALUE, 'fixed team value injected, not taken from input');
  ok(validateSubmission(d, { ...base, 'Which team is this for?': 'Legal Faction Management (LFM)' }).clean['Which team is this for?'] === FEEDBACK_TEAM_VALUE, 'fixed field ignores client value');
  ok(/not in the future/.test(validateSubmission(d, { ...base, 'When did this occur?': '2999-01-01' }).error), 'future date refused');
  ok(/not in the future/.test(validateSubmission(d, { ...base, 'When did this occur?': 'yesterday-ish' }).error), 'unparseable date refused');
  eq(validateSubmission(d, { ...base, 'When did this occur?': '02/NOV/2026' }).clean['When did this occur?'], '2026-11-02', 'legacy date normalised to ISO'); }
eq(cleanText('hi <@123456789012345678> <@&1> <#2> @everyone @here ```js\ncode``` done'), 'hi [mention removed] [mention removed] [mention removed] everyone here \ncode done', 'mentions and fences stripped');
pass('validation');

// ── submit: refusals write nothing ──
const before = { fs: countRows('form_submissions'), fb: countRows('faction_feedback'), audit: countRows('site_audit_log') };
await failsWith(() => F.submitPublicForm('nope', {}), /Unknown form/, 'unknown form');
{ const r = await F.submitPublicForm('garage_request', { 'What faction are you requesting for?': 'V' }); ok(!r.ok && r.errors && r.errors['What are you requesting?'] && /required/.test(r.error), 'server validation returns per-field errors'); }
{ const r = await F.submitPublicForm('garage_request', { 'What faction are you requesting for?': 'V', 'What are you requesting?': 'Initial garage', "Character's name": 'Marcus', 'Vehicle(s) requested (name and quantity)': 'Sultan x1', 'Reason for the request': 'need' }, { [HONEYPOT_FIELD]: 'http://spam' });
  ok(r.ok && /^GAR-/.test(r.reference) && r.dropped, 'honeypot: pretends success'); }
ok(countRows('form_submissions') === before.fs && countRows('faction_feedback') === before.fb && countRows('site_audit_log') === before.audit, 'refused and honeypot submissions write no rows');
pass('refusals');

// ── submit: the row the bot expects ──
const rcf = { 'Faction Name': 'The Reapers', 'Faction Leader Name': 'Jay', 'Faction Leader Discord': 'jay_leader', 'Faction Discord invite link': 'https://discord.gg/reapers', 'How many active members does the faction have?': '10 to 14', 'How long has the faction been active on the server?': '3 months', 'Faction backstory and concept': 'Long story <@&900000000000000001> @everyone', 'What does the faction do day to day?': '```\nrobbing\n```', 'Why should this faction be recognized?': 'Because' };
{ const r = await F.submitPublicForm('rcf_application', rcf); ok(r.ok && /^RCF-[0-9A-F]{8}$/.test(r.reference), 'rcf accepted with a reference');
  const row = queryOne("SELECT * FROM form_submissions WHERE form_key='rcf_application' ORDER BY id DESC LIMIT 1");
  eq(row.source, 'web', 'source web'); eq(row.status, 'new', 'status new'); ok(row.thread_id === null && row.ack_message_id === null, 'no thread yet'); ok(row.sheet_row < 0, 'negative sheet_row'); eq(row.row_key, 'web:' + r.reference.slice(4), 'row_key carries the reference'); ok(/^\d{4}-\d\d-\d\dT.*Z$/.test(row.submitted_at), 'submitted_at ISO'); ok(row.due_at && row.due_at > row.created_at, 'first nudge due later'); eq(row.submitter_ip_hash.length, 40, 'ip hashed');
  const payload = JSON.parse(row.payload); eq(Object.keys(payload).join('|'), ['Timestamp', ...formDef('rcf_application').fields.map(f => f.name)].join('|'), 'payload keyed like a sheet row, Timestamp first');
  eq(payload.Timestamp, row.submitted_at, 'payload Timestamp = submitted_at'); ok(!/<@&|@everyone|```/.test(row.payload) && /\[mention removed\] everyone/.test(payload['Faction backstory and concept']) && payload['What does the faction do day to day?'] === 'robbing', 'mentions and fences stripped before storage');
  // title/contact are what the bot's identify() gives for this payload, and the
  // same as the sheet path gives for the same answers (invite link never a contact).
  const { header, row: cells } = payloadToRow(row.payload); const idn = identify(FORMS[0], header, cells);
  eq(row.title, 'The Reapers · Jay', 'title like the sheet path'); eq(row.contact, 'jay_leader', 'contact = leader discord'); eq(`${idn.title}|${idn.contact}`, `${row.title}|${row.contact}`, 'identify() agrees with the stored title/contact');
  eq(JSON.stringify(rowPayload(header, cells)), row.payload, 'payload round-trips through the bot helpers');
  const a = lastAudit(); ok(a.action === 'CREATE' && a.target_type === 'form_submission' && a.target_id === String(row.id) && /Website form/.test(a.actor_name) && a.details.includes(r.reference), 'audited with the record id'); }
{ const g = { 'What faction are you requesting for?': 'The Vanguard', 'What are you requesting?': 'Initial garage', "Character's name": 'Marcus Vane', 'Vehicle(s) requested (name and quantity)': 'Sultan x1', 'Reason for the request': 'First garage' };
  const r = await F.submitPublicForm('garage_request', g); const row = queryOne("SELECT title, contact FROM form_submissions WHERE form_key='garage_request' ORDER BY id DESC LIMIT 1");
  ok(r.ok && row.title === 'The Vanguard · Initial garage' && row.contact === 'Marcus Vane', 'garage: no discord → character is the contact');
  const r2 = await F.submitPublicForm('garage_request', { ...g, 'Your Discord username': 'marcus.v' }); ok(r2.ok && queryOne("SELECT contact FROM form_submissions WHERE form_key='garage_request' ORDER BY id DESC LIMIT 1").contact === 'marcus.v', 'garage: discord given → it is the contact'); }
{ const r = await F.submitPublicForm('staff_application', { Name: 'Bob', Discord: 'bob_b', Age: '24', Timezone: 'CET', 'How long have you played on ECRP?': '2 years', 'Current and past characters (names and factions)': 'Bobby / Kings', 'Why do you want to join Faction Management?': 'Help', 'What can you bring to the team?': 'Time', 'Average weekly availability (hours)': '10' });
  const row = queryOne("SELECT title, contact FROM form_submissions WHERE form_key='staff_application' ORDER BY id DESC LIMIT 1"); ok(r.ok && row.title === 'Bob' && row.contact === 'bob_b', 'staff: name/discord'); }
{ const r = await F.submitPublicForm('ci_application', { 'Character name': 'Snitch', 'What is your Discord?': 'snitch99', 'Which faction are you applying to be a CI against?': 'Los Santos Kings', 'How is your character connected to this faction?': 'Cousin', 'What information can your character provide?': 'Lots', 'Why does your character want to inform?': 'Revenge', 'Do you understand the in-character risks to your character?': 'Yes, I understand the risks' });
  const row = queryOne("SELECT title, contact FROM form_submissions WHERE form_key='ci_application' ORDER BY id DESC LIMIT 1"); ok(r.ok && row.title === 'Snitch' && row.contact === 'snitch99', 'ci: character/discord'); }
{ const r = await F.submitPublicForm('faction_feedback', { 'Which faction is this feedback about?': 'The Vanguard', 'Character name': 'Tyrone', 'Your Discord username': 'ty.rone', 'When did this occur?': '2026-11-02', 'What happened? Describe the roleplay and your feedback': 'He did a thing <@&1>' });
  ok(r.ok && /^FB-/.test(r.reference), 'feedback accepted');
  const row = queryOne('SELECT * FROM faction_feedback ORDER BY id DESC LIMIT 1'); const p = JSON.parse(row.payload);
  ok(row.source === 'web' && row.status === 'new' && row.thread_id === null && row.sheet_row < 0 && row.row_key === 'web:' + r.reference.slice(3), 'feedback row shape');
  eq(`${row.faction}|${row.character_name}|${row.discord_username}|${row.occurred}`, 'The Vanguard|Tyrone|ty.rone|2026-11-02', 'feedback identity columns resolved by header');
  eq(p['Which team is this for?'], FEEDBACK_TEAM_VALUE, 'payload carries the team column the sheet poller filters on'); ok(/\[mention removed\]/.test(p['What happened? Describe the roleplay and your feedback']), 'feedback text cleaned');
  const a = lastAudit(); ok(a.target_type === 'feedback' && a.target_id === String(row.id), 'feedback audited'); }
pass('rows');

// ── rate limit: 3 per form per hour per address ──
const ci = { 'Character name': 'Again', 'What is your Discord?': 'again1', 'Which faction are you applying to be a CI against?': 'X', 'How is your character connected to this faction?': 'Y', 'What information can your character provide?': 'Z', 'Why does your character want to inform?': 'W', 'Do you understand the in-character risks to your character?': 'Yes, I understand the risks' };
ip('198.51.100.9');
{ for (let i = 0; i < 3; i++) ok((await F.submitPublicForm('ci_application', ci)).ok, `ci #${i + 1} from a fresh address ok`);
  await failsWith(() => F.submitPublicForm('ci_application', ci), /Too many submissions/, '4th ci in an hour refused');
  ok((await F.submitPublicForm('staff_application', { Name: 'Other', Discord: 'other', Age: '30', Timezone: 'UTC', 'How long have you played on ECRP?': '1y', 'Current and past characters (names and factions)': '-', 'Why do you want to join Faction Management?': 'x', 'What can you bring to the team?': 'y', 'Average weekly availability (hours)': '5' })).ok, 'another form from the same address is counted separately');
  const hashes = query("SELECT DISTINCT submitter_ip_hash h FROM form_submissions WHERE form_key='ci_application' AND source='web'"); eq(hashes.length, 2, 'two addresses → two hashes, none equal to the raw ip'); ok(hashes.every(x => !/198\.51|203\.0/.test(x.h)), 'hash does not contain the address');
  ip('198.51.100.10'); ok((await F.submitPublicForm('ci_application', ci)).ok, 'a different address is not limited');
  run("UPDATE form_submissions SET created_at = datetime('now','-2 hours') WHERE form_key='ci_application' AND source='web'"); ip('198.51.100.9'); ok((await F.submitPublicForm('ci_application', ci)).ok, 'the window is one hour'); }
{ const fb = { 'Which faction is this feedback about?': 'K', 'Character name': 'C', 'Your Discord username': 'd.d', 'When did this occur?': '2026-11-01', 'What happened? Describe the roleplay and your feedback': 't' };
  ip('192.0.2.1'); for (let i = 0; i < 3; i++) ok((await F.submitPublicForm('faction_feedback', fb)).ok, `feedback #${i + 1} ok`); await failsWith(() => F.submitPublicForm('faction_feedback', fb), /Too many/, 'feedback rate limited too'); }
pass('rate limit');

// ── INTAKE_SOURCE helpers ──
{ delete process.env.INTAKE_SOURCE; delete process.env.INTAKE_SOURCE_GARAGE_REQUEST;
  ok(intakeSource('garage_request') === 'both' && sheetPollingEnabled('garage_request') && webIntakeEnabled('garage_request'), 'default both');
  process.env.INTAKE_SOURCE = 'web'; ok(!sheetPollingEnabled('garage_request') && webIntakeEnabled('feedback'), 'web: sheet off everywhere');
  process.env.INTAKE_SOURCE_GARAGE_REQUEST = 'sheet'; ok(sheetPollingEnabled('garage_request') && !webIntakeEnabled('garage_request') && !sheetPollingEnabled('ci_application'), 'per-form override wins');
  process.env.INTAKE_SOURCE = 'bogus'; delete process.env.INTAKE_SOURCE_GARAGE_REQUEST; eq(intakeSource('garage_request'), 'both', 'unknown value reads as both'); delete process.env.INTAKE_SOURCE; }
pass('intake source');
