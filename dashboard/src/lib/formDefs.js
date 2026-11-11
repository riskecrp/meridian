// The hosted intake forms (/forms/<key>): one definition per form, shared by
// the public page (renders the fields) and the server action (validates and
// stores). Pure data and pure functions only — this file is imported by client
// components, so nothing in here may touch the database, Node built-ins or the
// bot.
//
// WHY THE FIELD NAMES LOOK LIKE SHEET HEADERS. The bot's intake
// (bot/formSubmissions.js, bot/factionFeedback.js) reads a submission as
// { question: answer } — the row of a Google Form's response sheet keyed by
// header text — and resolves the thread title and the follow-up contact by
// matching HEADER TEXT against the per-form patterns (`identify()` in
// bot/lib/formIntake.js). A hosted submission is stored in exactly that shape,
// with each field's `name` as the header, so the same thread, card, checklist
// and nudges come out of it unchanged. Renaming a field here therefore means
// checking the patterns below still match it (forms.test.mjs does that).
//
// `identify.title` / `identify.contact` mirror the bot's FORMS entries and
// factionFeedback's COLS (copied, not imported: that module pulls in node-cron
// and the Discord client). forms.test.mjs compares them source-for-source so
// they cannot drift apart silently.

import { str, oneOf } from '../../../shared/validate.js';
import { parseDate, toDateOnly } from '../../../shared/dates.js';

// What the feedback sheet's team column must read for a row to be ours
// (bot/factionFeedback.js TEAM_VALUE; FEEDBACK_TEAM_VALUE overrides it there,
// so a copy with a different value sets both).
export const FEEDBACK_TEAM_VALUE = 'Criminal Faction Management (FM)';

export const FIELD_TYPES = ['text', 'textarea', 'select', 'discord', 'url', 'date', 'fixed'];

// Length caps. SHORT keeps a "field" on one line of the thread's header block
// (bot SHORT_ANSWER_LIMIT is 120; a title part is dropped above 40); LONG is a
// generous essay cap that still fits a handful of Discord messages.
export const LIMITS = { text: 200, discord: 64, url: 300, date: 10, select: 120, textarea: 4000, fixed: 120 };

// Discord usernames are 2–32 characters of lowercase letters, digits, dots and
// underscores; the legacy Name#1234 and display names with spaces or capitals
// are still common in what people type, so be lenient and only refuse the
// clearly wrong (mentions, URLs, nonsense).
export const DISCORD_RE = /^(?!.*(?:https?:|discord\.gg|<@))[^\s<>@][^<>]{0,62}$/i;

export const FORM_DEFS = [
  {
    key: 'rcf_application',
    title: 'Recognized Criminal Faction Application',
    short: 'RCF Application',
    prefix: 'RCF',
    intro: 'Apply to have your criminal faction officially recognized by Faction Management. Applications are reviewed by FM Leadership; the faction leader is contacted on Discord with the decision.',
    identify: {
      title: [/^faction name/i, /^faction leader name/i],
      contact: [/leader.*discord|discord.*(username|handle|tag)/i, /discord/i],
    },
    fields: [
      { name: 'Faction Name', label: 'Faction name', type: 'text', required: true },
      { name: 'Faction Leader Name', label: "Faction leader's character name", type: 'text', required: true },
      { name: 'Faction Leader Discord', label: "Faction leader's Discord username", type: 'discord', required: true, help: 'Who we contact with the decision.' },
      { name: 'Faction Discord invite link', label: 'Faction Discord invite link', type: 'url', required: false, help: 'A permanent invite, if the faction has a Discord already.' },
      { name: 'How many active members does the faction have?', label: 'Active members', type: 'select', required: true, options: ['Fewer than 5', '5 to 9', '10 to 14', '15 to 19', '20 or more'] },
      { name: 'How long has the faction been active on the server?', label: 'Time active on the server', type: 'text', required: true },
      { name: 'Faction backstory and concept', label: 'Backstory and concept', type: 'textarea', required: true, help: 'Where the faction came from and what it is about.' },
      { name: 'What does the faction do day to day?', label: 'Day-to-day activity', type: 'textarea', required: true, help: 'Criminal activities, roleplay focus, how members spend their time.' },
      { name: 'Why should this faction be recognized?', label: 'Why recognition', type: 'textarea', required: true },
      { name: 'Anything else Faction Management should know?', label: 'Anything else', type: 'textarea', required: false },
    ],
  },
  {
    key: 'staff_application',
    title: 'Faction Management Staff Application',
    short: 'Staff Application',
    prefix: 'STAFF',
    intro: 'Apply to join the Faction Management team. Applications are read by FM Leadership and you will hear back on Discord.',
    identify: {
      title: [/^staff name|^name$/i],
      contact: [/^discord$/i, /discord/i],
    },
    fields: [
      { name: 'Name', label: 'Name', type: 'text', required: true, help: 'What you go by.' },
      { name: 'Discord', label: 'Discord username', type: 'discord', required: true },
      { name: 'Age', label: 'Age', type: 'text', required: true },
      { name: 'Timezone', label: 'Timezone', type: 'text', required: true },
      { name: 'How long have you played on ECRP?', label: 'Time on ECRP', type: 'text', required: true },
      { name: 'Current and past characters (names and factions)', label: 'Characters', type: 'textarea', required: true },
      { name: 'Previous staff or faction management experience', label: 'Previous experience', type: 'textarea', required: false },
      { name: 'Why do you want to join Faction Management?', label: 'Why Faction Management', type: 'textarea', required: true },
      { name: 'What can you bring to the team?', label: 'What you bring', type: 'textarea', required: true },
      { name: 'Average weekly availability (hours)', label: 'Weekly availability', type: 'text', required: true },
      { name: 'Anything else?', label: 'Anything else', type: 'textarea', required: false },
    ],
  },
  {
    key: 'garage_request',
    title: 'Faction Management Garage Request',
    short: 'Garage Request',
    prefix: 'GAR',
    intro: 'Request a faction garage or vehicles for a recognized faction. Requests are handled by your FM team in Discord.',
    identify: {
      title: [/what faction are you requesting|^faction/i, /what are you requesting/i],
      contact: [/discord/i, /character.?s? name/i],
    },
    fields: [
      { name: 'What faction are you requesting for?', label: 'Faction', type: 'text', required: true },
      { name: 'What are you requesting?', label: 'Request type', type: 'select', required: true, options: ['Initial garage', 'Additional vehicle', 'Vehicle swap', 'Garage move', 'Other'] },
      { name: "Character's name", label: "Your character's name", type: 'text', required: true, help: 'Who the garage or vehicle is issued to.' },
      { name: 'Your Discord username', label: 'Discord username', type: 'discord', required: false, help: 'So the team can reach you with questions.' },
      { name: 'Vehicle(s) requested (name and quantity)', label: 'Vehicles requested', type: 'textarea', required: true },
      { name: 'Garage location (street or coordinates)', label: 'Garage location', type: 'text', required: false },
      { name: 'Reason for the request', label: 'Reason', type: 'textarea', required: true },
      { name: 'Already discussed with an FM team member? Who?', label: 'Discussed with', type: 'text', required: false },
    ],
  },
  {
    key: 'ci_application',
    title: 'CI Application',
    short: 'CI Application',
    prefix: 'CI',
    intro: 'Apply to have your character act as a Confidential Informant against a criminal faction. Everything here stays with Faction Management.',
    identify: {
      title: [/^character name|^name$/i],
      contact: [/what is your discord|discord/i],
    },
    fields: [
      { name: 'Character name', label: 'Character name', type: 'text', required: true },
      { name: 'What is your Discord?', label: 'Discord username', type: 'discord', required: true },
      { name: 'Which faction are you applying to be a CI against?', label: 'Faction', type: 'text', required: true },
      { name: 'How is your character connected to this faction?', label: 'Connection to the faction', type: 'textarea', required: true },
      { name: 'What information can your character provide?', label: 'Information you can provide', type: 'textarea', required: true },
      { name: 'Why does your character want to inform?', label: 'Motive', type: 'textarea', required: true },
      { name: 'Do you understand the in-character risks to your character?', label: 'In-character risks', type: 'select', required: true, options: ['Yes, I understand the risks'] },
      { name: 'Anything else?', label: 'Anything else', type: 'textarea', required: false },
    ],
  },
  {
    key: 'faction_feedback',
    title: 'Faction Feedback',
    short: 'Faction Feedback',
    prefix: 'FB',
    intro: 'Feedback about your roleplay with a criminal faction — good or bad. Faction Management reads every submission and will message you on Discord to confirm it was received.',
    // bot/factionFeedback.js COLS: team, faction, character, discord, occurred.
    // Headers below are chosen so each pattern's FIRST match is the right
    // column (the feedback text must match none of them).
    identify: {
      team: /team|division/i,
      faction: /faction/i,
      character: /character/i,
      discord: /discord/i,
      occurred: /occur|when did/i,
    },
    fields: [
      { name: 'Which team is this for?', label: 'Team', type: 'fixed', value: FEEDBACK_TEAM_VALUE },
      { name: 'Which faction is this feedback about?', label: 'Faction', type: 'text', required: true },
      { name: 'Character name', label: 'Your character name', type: 'text', required: true },
      { name: 'Your Discord username', label: 'Discord username', type: 'discord', required: true, help: 'We message you to confirm the feedback was received.' },
      { name: 'When did this occur?', label: 'When did this occur?', type: 'date', required: true },
      { name: 'What happened? Describe the roleplay and your feedback', label: 'Your feedback', type: 'textarea', required: true, help: 'What happened, who was involved, and what you want Faction Management to know.' },
    ],
  },
];

export const FORM_KEYS = FORM_DEFS.map((f) => f.key);
export const formDef = (key) => FORM_DEFS.find((f) => f.key === key) || null;

// The hidden field a browser never fills in. Anything in it is a bot.
export const HONEYPOT_FIELD = 'website';

// ── Text hygiene ───────────────────────────────────────────────────────────────
//
// Everything a submitter types ends up in a Discord thread. The bot already
// posts with `allowed_mentions: { parse: [] }`, so a typed mention cannot ping;
// this strips the markup anyway so the thread does not fill with `<@&…>` noise,
// and removes code fences, which would otherwise swallow the bot's own
// formatting of the card.
export function cleanText(v) {
  return String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<@[!&]?\d+>|<#\d+>/g, '[mention removed]')
    .replace(/@(everyone|here)\b/gi, '$1')
    .replace(/```+[^\n`]*/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

/**
 * Validate and normalise a submission against a definition.
 *
 * Returns { ok: true, clean } where `clean` is { [field.name]: value } in field
 * order (a fixed field carries its fixed value, an empty optional field an empty
 * string), or { ok: false, errors: { [field.name]: message }, error } — `error`
 * is the first message, for callers that want one line.
 */
export function validateSubmission(def, values) {
  const src = values && typeof values === 'object' ? values : {};
  const errors = {};
  const clean = {};
  for (const f of def.fields) {
    const label = f.label || f.name;
    if (f.type === 'fixed') { clean[f.name] = f.value; continue; }
    let v = cleanText(str(src[f.name], { max: LIMITS[f.type] || LIMITS.text }));
    if (!v) {
      if (f.required) errors[f.name] = `${label} is required.`;
      clean[f.name] = '';
      continue;
    }
    switch (f.type) {
      case 'select':
        if (oneOf(v, f.options || []) === null) errors[f.name] = `${label}: choose one of the options.`;
        break;
      case 'discord':
        if (!DISCORD_RE.test(v)) errors[f.name] = `${label}: enter a Discord username (not a mention or a link).`;
        break;
      case 'url':
        if (!/^https?:\/\/\S+$/i.test(v)) errors[f.name] = `${label}: enter a full link starting with https://.`;
        break;
      case 'date': {
        const d = parseDate(v);
        if (!d || d.getTime() > Date.now() + 86400000) errors[f.name] = `${label}: enter a date (not in the future).`;
        else v = toDateOnly(d);
        break;
      }
      default:
        break;
    }
    clean[f.name] = v;
  }
  const names = Object.keys(errors);
  if (names.length) return { ok: false, errors, error: errors[names[0]] };
  return { ok: true, clean };
}
