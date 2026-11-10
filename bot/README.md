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
| `/adddossier`, `/addnote`, `/logscene`, `/feedback` | L1, and the faction must be writable by the actor (team scope via `dashboard/src/lib/access.js`); archived factions refuse writes |
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
| Feedback intake | sheet every 15 min, nudges every 30 min | `feedback_poll`, `feedback_nudge` |
| Form intakes | sheet every 15 min, nudges every 30 min | `form_poll.<form>`, `form_nudge.<form>` |
| Task DM reminders | hourly | — |

Hourly `setInterval` jobs never overlap (a run still in progress skips the tick).

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
