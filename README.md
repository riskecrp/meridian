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
| `scripts/` | `deploy.sh`, `backup.sh`, `migrate.mjs` |
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
