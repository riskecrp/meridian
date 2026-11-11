# Meridian Discord bot

The Discord half of Meridian. It shares the SQLite database with the dashboard
(`shared/db.js`, one `better-sqlite3` instance per process) and reads every
channel, role and route from that database (`discord_config`, `discord_roles`,
`ping_routes`), so retargeting a ping or re-creating a role is a dashboard edit,
not a redeploy.

## Running it

```
cd bot && npm install          # discord.js, dotenv, node-cron — better-sqlite3 comes from the repo root
node index.js
```

`index.js` loads **one** `.env` file before anything else: `BOT_ENV_PATH` when
set, otherwise the repo-root `.env` (the same file the dashboard and the systemd
`EnvironmentFile` use). `deploy/meridian-bot.service` is the production unit.

### Environment variables

Every variable the bot reads, with what happens when it is missing. The full
annotated list with current values is in `bot/.env.example`.

| Variable | Used for | When unset |
|---|---|---|
| `DISCORD_BOT_TOKEN` | gateway login, REST posts, DMs | the bot refuses to start |
| `GUILD_ID` | the FM guild: slash-command registration, staff sync, leadership-mention capture, channel links | commands are not registered; FM-guild features are off (logged at boot) |
| `DATABASE_PATH` | the shared SQLite file | `shared/db.js` falls back to `/opt/meridian/data/meridian.db` |
| `BASE_URL` | every dashboard link in a ping (`shared/pings.js` `urls.*`) | `https://ecrpfm.com` |
| `DISCORD_CLIENT_ID` | the "invite the bot" link on the RCF setup checklist | the checklist says to ask for the link |
| `BOT_ENV_PATH` | explicit `.env` location | `../.env` relative to `bot/` |
| `RISK_DISCORD_ID`, `OWNER_IDS` | owners (`shared/owners.js`); owners are L3 everywhere | production defaults in `shared/owners.js` |
| `GA_DISCORD_INVITE` | Game Affairs invite on the RCF checklist | placeholder text |
| `GARAGE_FORM_URL` | Initial Garage Request link on the RCF checklist | plain text, no link |
| `GOOGLE_SHEETS_API_KEY` | read the intake sheets through the Sheets API | CSV export (sheet must be link-viewable) |
| `SHEET_FEEDBACK_ID` / `_GID`, `SHEET_RCF_APPLICATION_ID` / `_GID`, `SHEET_STAFF_APPLICATION_ID` / `_GID`, `SHEET_GARAGE_REQUEST_ID` / `_GID`, `SHEET_CI_APPLICATION_ID` / `_GID` | the five intake sheets (id = URL token, gid = tab, blank gid = first tab) | that intake records "no sheet id configured" in `sync_status` every poll |
| `FEEDBACK_TEAM_VALUE` | the team-column value that makes a feedback row ours | `Criminal Faction Management (FM)` |
| `INTAKE_SOURCE`, `INTAKE_SOURCE_<FORM>` | `both` / `web` / `sheet` — whether an intake reads its Google Sheet, the website form rows, or both | `both` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | `/summarize` | the command says OpenAI is not configured / `gpt-4o-mini` |
| `PROMO_GUN_CATEGORIES` | import categories polled on promotion | the ten weapon categories in `promotionReview.js` |

No Discord id, dashboard URL, sheet id or invite link lives in code.

## Permissions

One gate for everything: `requireStaff(interaction, minLevel, { allowEventTeam,
allowLeadStoryteller })` in `lib/auth.js`, built on `shared/actor.js`
`actorFromDiscord` — the staff roster (`staff.clearance`, `staff.active`),
`dashboard_access` grants, Event Team / Lead Storyteller flags and owners,
exactly as the dashboard's `requireActor`. A Discord role on its own grants
nothing. Refusals are ephemeral replies that say why; every interaction gets a
reply or a deferral.

| Surface | Minimum |
|---|---|
| `/adddossier`, `/addnote`, `/logscene`, `/feedback` | L1, and the faction must be writable by the actor (team scope via `shared/access.js`); archived factions refuse writes |
| `/getnotes`, `/factioninfo`, `/imports`, `/scenecount`, `/matrix teams|team|staff` | L1 or Lead Storyteller (read) |
| `/reminder`, `/summarize` | L1 |
| `/autodelete`, `/triggerword` | L3 |
| `/todo`, task buttons (`tsk:*`), DM commands | see `taskButtons.js` / `dmHandler.js` (shared/tasks.js rules) |
| RP-change buttons `rpc:approve|deny|exec` | L3 (`shared/rpChanges.js`) |
| `rpc:done` | the requester or L3 |
| Feedback intake buttons `fbk:*` | L2 |
| Form intake buttons `frm:*` and the reject modal | L3 (covers Game Affairs Management) |
| Reminder `snooze_*` / `dismiss`, task Q&A answer | L1 |

Faction options accept an id or a name: exact match first, then a single
case-insensitive partial match; an ambiguous name is refused with the candidates.

## What runs when

| Job | Schedule | Health row (`sync_status.job`) |
|---|---|---|
| Reminders (`scheduler.js`) | every minute | `reminders` — undeliverable reminders are kept (retried for 24 h, then `FAILED`), never deleted |
| Session prune (`scheduler.js`) | hourly at :15 | `housekeeping` |
| Channel purge / reminder purge | hourly (:00 / :30) + startup | `channel_purge`, `reminder_purge` |
| Recurring reminders | every minute, fires ≥ 18:00 UTC on `ping_day` | `recurring_reminders` — a month counts as sent only after the ping was delivered |
| Forum sync | hourly | `forum_sync` — a muted route or unreachable channel is a recorded failure |
| Conversation sync | hourly | `conversation_sync` |
| Promotion review | 14th 12:00 UTC; poll results every 5 min | `promotion_review`, `promotion_polls` |
| Feedback intake | website rows every minute, sheet every 15 min, nudges every 30 min | `feedback_web`, `feedback_poll`, `feedback_nudge` |
| Form intakes | website rows every minute, sheet every 15 min, nudges every 30 min | `form_web.<form>`, `form_poll.<form>`, `form_nudge.<form>` |
| Task DM reminders | hourly | — |
| Weekly leadership digest (`lib/digest.js`) | Monday 09:00 UTC | `leadership_digest` |
| Verify-in-game nudge (`lib/digest.js`) | hourly at :05 | `rp_verify_nudge` |
| Review vote nudge (`lib/digest.js`) | 12th 10:00 UTC | `review_vote_nudge` |
| Job health alert (`scheduler.js healthAlertTick`) | every 30 min + 60 s after start | `ops_health` |

Hourly `setInterval` jobs never overlap (a run still in progress skips the tick).

### Leadership nudges (read-only)

Started by `startScheduler` → `startLeadershipJobs`. None of them changes
workflow state: they list and remind, and leadership acts on the dashboard.
Each has a ping route that mutes it from the dashboard (Admin → Pings); a muted
job records "muted" in `sync_status` and sends nothing.

- **Weekly digest** (route `leadership.digest`): one embed, grouped by kind,
  of everything waiting on leadership for more than 7 days — PENDING RP
  requests, RP_DONE awaiting execution, EXECUTED but unverified (48 h rule),
  confirmed reviews this month without feedback sent, PENDING deletion
  requests, unanswered questions on open tasks, unclaimed tasks targeting the
  FM Leadership / Game Affairs roles, staged promotions. Every line carries the
  age in days and a dashboard link; "Nothing is waiting" when empty.
  `buildDigest({ now, olderThanDays, verifyHours })` returns the grouped data.
- **Verify-in-game nudge** (route `rp.verify_nudge`): an EXECUTED request
  with `verified_at NULL` whose `resolved_at` is older than 48 h is sent to its
  requester (DM first, the route's channel with a mention as fallback) with a
  link to Leadership → Queue, then `verify_nudged_at` is stamped so the next
  nudge waits another 48 h. That stamp is the only write any of these jobs make.
- **Review vote nudge** (route `review.vote_nudge`): on the 12th every active
  L3 who has no `leadership_personal_notes` row for a faction reviewed this
  month gets one message (DM first, channel fallback with a mention) listing
  the factions still to vote on, before the tally on the 14th.
- **Job health** (route `ops.health`): every `sync_status` row with a cadence
  is judged by `lib/health.js` — *late* when no successful run for more than
  3× `expected_every_minutes` (a job that never succeeded is measured from its
  last attempt or the row itself), *failing* at 3 or more failures in a row.
  Alerts are posted on **state change only** (an in-memory map per process),
  and a job that comes back is announced once as recovered. The dashboard's
  `GET /api/health` uses the same module: 200 when every job is ok, 503
  otherwise; job details are included only for an authenticated L3.

### Promotion review (policy 7)

One `leadership_personal_notes` row per L3 per faction per month is that
leader's vote. On the 14th the tally derives `faction_reviews.status`
(`Confirmed Promote|Hold|Demote|Remove` at two thirds, else `Pending
Discussion`) and writes it back; Promote opens one 48-hour weapon poll per
category in the month's thread, Demote and Remove raise an FM Leadership task
immediately (`shared/tasks.js createTask`, actor `Meridian`). Poll results are
read from Discord's `is_finalized`/`expiry`; a poll that cannot be fetched is
retried, not counted as empty. Re-running the review in the same month creates
nothing twice.

### RP changes (policy 8)

`rpButtons.js` only resolves the actor and calls `shared/rpChanges.js`
(`approveRPChange`, `denyRPChange`, `markRPDone`, `executeRPChange`), so the
order PENDING → APPROVED → RP_DONE → EXECUTED, the world-record rewrites and the
audit rows are identical to the dashboard. Requester notices go by DM through
the gateway client (`lib/notify.js` registers it with `setRequesterNotifier`)
and fall back to the `rp.requester` route's channel.

### Intakes

Each response sheet is read through the Sheets API when
`GOOGLE_SHEETS_API_KEY` is set, otherwise as a CSV export. Columns are found by
header text, so questions can be added or reordered. A response is identified
by its timestamp (plus its order among same-second responses) and recorded in
`sheet_rows_seen`, so deleting or reordering sheet rows neither re-posts old
submissions nor hides new ones; `sheet_row` on a record is informational. The
`row_key` columns and the `sheet_rows_seen` table are created on first use if
a migration has not added them yet. A decision-form application (RCF) cannot be
completed until it has been accepted.

#### Hosted forms (website submissions)

The dashboard serves the same five forms publicly at `/forms` and
`/forms/<key>` (`dashboard/src/app/forms`, field definitions in
`dashboard/src/lib/formDefs.js`, no login). A submission is written straight
into `form_submissions` / `faction_feedback` with `source = 'web'`,
`thread_id NULL`, `sheet_row = -<epoch ms>`, `row_key = 'web:<reference>'` and
the same `{ question: answer }` payload a sheet row carries, the field names
being the sheet headers the bot's `identify()` / column patterns expect. The
bot then posts every row with `thread_id NULL` through the same code path as a
new sheet row (`postWebRows` / `postWebFeedback`): at the start of every
15-minute poll and from a one-minute job (which only takes rows that have not
failed before), then fills in `thread_id`. The card footer says which source a
submission came from. A website row that cannot be posted (route without a
channel) is recorded in the failures table and `sync_status` and retried every
poll; it is never skipped, since there is no sheet to fall back to.

`INTAKE_SOURCE` = `both` (default) | `web` | `sheet` says which sources an
intake listens to; `INTAKE_SOURCE_<FORM>` (`RCF_APPLICATION`,
`STAFF_APPLICATION`, `GARAGE_REQUEST`, `CI_APPLICATION`, `FEEDBACK`) overrides
it per form. `web` turns that form's sheet polling off (recorded in
`sync_status` as a state, not a failure) once its Google Form is retired;
`sheet` ignores website rows. The dashboard's rate limit (3 submissions per
form per hour per address, stored as a salted hash in `submitter_ip_hash`) uses
`NOTIFY_SECRET`, falling back to the session secret.

### Staff sync

In the FM guild the base role (`fm_team_guide`) makes someone staff; rank
roles set the rank and `shared/clearance.js clearanceForRank` sets the
clearance. A removed rank role lowers the clearance, a removed base role or
leaving the guild sets `staff.active = 0` (rows are never deleted), and giving
the role back reactivates the same row.

## Testing without Discord

Every module imports under Node with `DATABASE_PATH` pointed at a copy of the
database and `fetch` stubbed; the harness and scripts used for the repair live
in the repair scratchpad (`tests/bot/fix/*.mjs`). `scripts/smoke.mjs` at the
repo root checks syntax and that every module and command loads.
