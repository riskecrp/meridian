# Meridian

Meridian is the Faction Management team's ops hub: the dashboard at
https://ecrpfm.com plus the FM Discord bot. Everything the team tracks —
factions, members, reviews, tasks, scenes, hours, announcements — lives in
**one database file**. This repo contains all the code, and this page explains
how to get at the data or take over the whole system, **without needing access
to the server it currently runs on**.

## The three pieces

1. **This repo** — all the code for the website and the Discord bot. If you can
   read this, you already have it.
2. **The database** — a single file, `meridian.db`. This is the team's actual
   information. It is *not* in the repo. A fresh backup copy
   (`meridian-<date>.db.gz`) is made automatically every night, and you can
   download the latest one yourself, any time, at:

   **https://ecrpfm.com/api/backup**

   Log in to the dashboard first (it's for leadership-level accounts; there is
   no link to it anywhere on the site — just this URL). It's a small file and
   it contains everything.
3. **The secrets** — the bot's Discord login and similar keys, in a `.env` file
   that is *not* in the repo (there's a `.env.example` showing what goes in it).
   These are tied to the current setup. If you take Meridian elsewhere you
   create your own — see "Running Meridian yourself" below.

With a copy of 1 and 2, you can do everything on this page on your own
computer. Nothing requires a login to the current server.

**The easiest starting point is inside the dashboard: Admin → Handover.**
It has one-click downloads (a CSV bundle ready for Google Sheets, the database
file, and the code as a zip — no GitHub account needed), a plain-English
walkthrough for running Meridian on your own computer, and the technical
server-migration runbook. This README is the same information for whoever
only has the repo.

## Getting the data into Google Sheets

The database is standard **SQLite** — a very common, open format. The path to
Sheets is: turn tables into CSV files, then import those into a spreadsheet.

**No-coding route:** install the free app **DB Browser for SQLite**
(https://sqlitebrowser.org), unzip the backup (double-click the `.gz`, or
`gunzip meridian-<date>.db.gz`), and open the `.db` file. You can browse every
table like a spreadsheet, and export any of them via
*File → Export → Table(s) as CSV*.

**Command-line route:** with the repo and the backup on the same machine:

```
gunzip meridian-2026-08-05.db.gz
DATABASE_PATH=./meridian-2026-08-05.db ./scripts/export-csv.sh
```

That writes one CSV per table into `data/exports/<today>/`. By default it
exports the tables people usually want (factions, members, reviews, staff,
tasks, scenes, hours, money logs). Add `--list` to see every table name,
`--all` to export all of them, or name specific tables.

**Then, in Google Sheets:** open a spreadsheet, *File → Import → Upload*, pick
a CSV, choose *Insert new sheet(s)*. Each CSV becomes one tab. (Or upload the
whole export folder to Google Drive with *Settings → Convert uploads* switched
on — each CSV becomes its own spreadsheet.)

One quirk: date columns like `created_at` are in UTC, and event times in a
column called `epoch_ms` are stored as a big number (milliseconds since 1970).
To turn that number into a real date in Sheets:
`=A2/86400000 + DATE(1970,1,1)`, then format the cell as a date.

## Running Meridian yourself

If you'd rather keep the dashboard and bot running than export spreadsheets,
you can host it anywhere. Whoever does the setup should be comfortable running
a small Linux server — it's a standard Node.js project, nothing exotic. You
need:

- this repo,
- a database backup (unzipped, placed at `data/meridian.db`) — or none at all:
  `node scripts/bootstrap.mjs` builds an empty database with every table,
  ping route and the peds catalogue, ready for a first login,
- your own Discord bot application from https://discord.com/developers
  (bot token + OAuth credentials — the dashboard's login *is* Discord),
- a `.env` filled in from `.env.example` — put your own Discord user ID in
  `RISK_DISCORD_ID` so your first login gets full access before any roles are
  mapped,
- a small server (2 GB memory is enough) and a domain — or just a laptop with
  `BASE_URL=http://localhost:3000` to try it out.

Then: `npm install` in the repo root, `bot/`, and `dashboard/`; apply any
pending database changes with `node scripts/migrate.mjs` (an existing backup)
or build a fresh one with `node scripts/bootstrap.mjs`; build the site with
`npm run build` inside `dashboard/`; run `node bot/index.js` and
`dashboard/start.sh` as services (ready-made service files are in `deploy/`).
Discord ids for roles and channels live in the database (Admin → Discord &
Access, Admin → Pings) and the guild, owner and form-sheet ids in `.env`, so
pointing the bot at a different Discord server means updating those — budget a
careful afternoon for that part. `node scripts/test/run.mjs` exercises every
server action and bot handler against a throwaway seeded database and is the
quickest way to confirm a copy works.

## Building something new instead

Nothing here is locked in. The database is plain SQLite, readable from every
programming language and plenty of no-code tools; the CSV exports are the same
data with zero dependencies on this codebase. If a future team wants a
different dashboard, a Sheets-based workflow, or a bot in another framework,
the data comes along cleanly — the code in this repo is then just a working
reference for what each table means and how the workflows fit together
(`schema.sql` lists every table and column).

## For whoever operates the current server

Day-to-day reference — only relevant with access to the box it runs on.

| Path | What |
|---|---|
| `dashboard/` | the website (Next.js; current UI under `src/app/v2/`, legacy under `src/app/fm/`) |
| `bot/` | the Discord bot (discord.js: commands, schedulers, message capture) |
| `shared/` | database + Discord helpers used by both |
| `schema.sql` | reference list of every table (regenerated, not hand-edited) |
| `migrations/` | numbered database changes, applied once each by `scripts/migrate.mjs` |
| `scripts/` | `deploy.sh`, `backup.sh`, `migrate.mjs`, `bootstrap.mjs`, `schema-dump.mjs`, `export-csv.sh`, `smoke.mjs`, `test/` |
| `deploy/` | service files (installed copies live in `/etc/systemd/system/`) |
| `data/` | live database + nightly backups — **never in git** |

- **Deploy a change:** `cd /opt/meridian && ./scripts/deploy.sh` — runs the
  smoke test and the functional tests first (aborts safely if anything's
  broken), then pulls, migrates, builds, restarts. Flags: `--dashboard`, `--bot`, `--no-pull`. Never run two
  site builds at once on this box — it runs out of memory.
- **Smoke test alone:** `node scripts/smoke.mjs` (exit 0 = safe to restart).
  It checks every bot file loads and migrations apply — all against a throwaway
  database copy, never the live one.
- **Tests:** `node scripts/test/run.mjs [filter]` builds a seeded throwaway
  database and runs `scripts/test/cases/*.test.mjs` against it (server actions
  at every clearance level, bot handlers with fake interactions). Never touches
  the live file.
- **Migrations:** add `migrations/NNN_short_name.sql` (plain SQL) or
  `NNN_short_name.mjs` (`export default function (db) {…}` for data rewrites),
  run `node scripts/migrate.mjs`, then regenerate the reference:
  `node scripts/schema-dump.mjs > schema.sql`.
- **Conventions the code now relies on:** dates are ISO (`shared/dates.js`),
  tasks live in `shared/tasks.js`, the RP-change pipeline in
  `shared/rpChanges.js`, pings in `shared/pings.js`, faction write scoping in
  `shared/access.js`; the dashboard and the bot import the same modules.
- **Backups:** nightly timer produces `data/backups/meridian-<date>.db.gz`
  (14 kept on the box, plus an off-box copy pulled daily) and then prunes
  message, keyword, member and session logs older than 180 days. The latest one is
  downloadable by leadership at `https://ecrpfm.com/api/backup` (unlisted;
  downloads are recorded in the audit log).
- **Exports on the box:** `./scripts/export-csv.sh` with no `DATABASE_PATH`
  reads the live database directly (read-only, safe any time).
