# Meridian

Faction Management ops hub for the ECRP FM team: a Next.js dashboard
(https://ecrpfm.com) plus a Discord bot, sharing one SQLite database.

## Layout

| Path | What |
|---|---|
| `dashboard/` | Next.js 15 / React 19 app-router dashboard (`src/app/fm/...`) |
| `bot/` | discord.js bot: slash commands, schedulers, DM handler, message capture |
| `shared/` | DB (`better-sqlite3`) + Discord + config helpers used by both |
| `schema.sql` | Full schema dump of the live DB (regenerated, not hand-maintained) |
| `migrations/` | Numbered SQL migrations, applied once each by `scripts/migrate.mjs` |
| `scripts/` | `deploy.sh`, `backup.sh`, `migrate.mjs`, `export-csv.sh` |
| `deploy/` | systemd unit files (installed copies live in `/etc/systemd/system/`) |
| `data/` | live SQLite DB + rotated backups — **not in git** |
| `archive/` | pre-git one-time patch scripts & old backups — **not in git** |

## Services (systemd)

- `meridian-dashboard.service` → `dashboard/start.sh` (refuses to start without a build)
- `meridian-bot.service` → `node bot/index.js`
- `meridian-backup.timer` → nightly `scripts/backup.sh` (backup + log-table retention)

Secrets live in `/opt/meridian/.env` (see `.env.example`).

## Deploying a change

```
cd /opt/meridian && ./scripts/deploy.sh            # smoke + pull + migrate + build + restart both
./scripts/deploy.sh --dashboard | --bot | --no-pull
```

NOTE: never run multiple `next build`s in parallel on this box (2–4 GiB VM, OOMs).

## Smoke test — run before restarting

```
node scripts/smoke.mjs            # exit 0 = safe to restart
node scripts/smoke.mjs --build    # also runs next build (the only real JSX check)
```

`deploy.sh` runs it automatically before it migrates, so a failure aborts the
deploy with the live database and the running services untouched.

It checks, without connecting to Discord and without writing to the live DB
(every phase runs in a child process against a temp `.backup` copy, with a dummy
bot token): every bot file parses; every bot module resolves its imports; every
command exposes the `data` + `execute` shape and a unique name that `index.js`
requires at boot; all migrations apply cleanly to the copy; the dashboard's
server-side libs load; and `.next` is not older than `src/`.

Why the bot half matters: `bot/index.js` imports every file in `bot/commands/`
with no `try`/`catch`, so one broken file exits the process — and with
`Restart=always` + `RestartSec=5` that is a crash loop nothing catches before the
restart. The dashboard has `next build` as its gate; the bot had none.

## Migrations

Add `migrations/NNN_short_name.sql`, then run `node scripts/migrate.mjs`
(deploy.sh does this automatically). Applied filenames are tracked in the
`_migrations` table. After schema changes, regenerate the reference dump:
`sqlite3 data/meridian.db .schema > schema.sql`.

## Backups

Nightly timer: consistent `sqlite3 .backup` → `data/backups/meridian-<date>.db.gz`
(14 kept locally). jax-box pulls the latest copy off-box daily. After a successful
backup the script prunes `mentions` / `edited_message_logs` / `deleted_message_logs`
rows older than 180 days.

## Exporting data to Google Sheets

All of Meridian's information lives in one SQLite database. To get any of it
into Google Sheets, export tables to CSV (a format Sheets imports natively),
copy the files to your machine, and import them.

**1. Export on the server** (read-only, safe to run any time):

```
cd /opt/meridian
./scripts/export-csv.sh              # the core reporting set (factions, members,
                                     #   reviews, staff, tasks, scenes, hours, …)
./scripts/export-csv.sh --list       # print every table name
./scripts/export-csv.sh --all        # every table
./scripts/export-csv.sh scene_logs treasury_logs   # just the tables you name
```

Output lands in `data/exports/<today>/`, one `<table>.csv` per table, with a
header row of column names.

**2. Copy the files to your machine:**

```
scp -r root@<fm-bot>:/opt/meridian/data/exports/<today> ./meridian-export
```

**3. Import into Google Sheets** — either way works:

- In a spreadsheet: **File → Import → Upload**, pick a CSV, then
  *Insert new sheet(s)* to add it as a tab (or *Replace current sheet* when
  refreshing an existing tab with a newer export). Repeat per CSV — Sheets
  imports one file per tab.
- In bulk: upload the whole folder to Google Drive with
  **Settings → Convert uploads to Google Docs editor format** enabled; each CSV
  becomes its own spreadsheet.

Timestamps are stored as UTC (`created_at` etc.) and event times as epoch
milliseconds (`epoch_ms`); convert in Sheets with
`=A2/86400000 + DATE(1970,1,1)` and format the cell as a date.

To pull an export **without touching the live box**, run the script against a
nightly backup instead: `gunzip -k meridian-<date>.db.gz`, then
`DATABASE_PATH=/path/to/meridian-<date>.db ./scripts/export-csv.sh --all`
(jax-box keeps 30 days of pulled backups in `/root/backups/meridian/`).

There is no live Sheets sync and none is wired up: the box is private, the data
includes confidential leadership material, and a monthly-cadence workflow doesn't
need one — re-import a fresh CSV when you want current numbers.
