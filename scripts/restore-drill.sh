#!/usr/bin/env bash
# Restore drill: prove the latest backup can become a working dashboard.
#   ./scripts/restore-drill.sh [backup.db.gz] [port]
# Unpacks the newest data/backups/meridian-*.db.gz (or the file given) into a
# temp dir, applies pending migrations to the copy, runs the smoke test and the
# functional tests, starts the built dashboard on a spare port, fetches the
# login page, then tears everything down. Exit 0 = the backup restores.
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP=${1:-$(ls -1t data/backups/meridian-*.db.gz 2>/dev/null | head -1)}
PORT=${2:-3999}
[ -n "$BACKUP" ] && [ -f "$BACKUP" ] || { echo "no backup found (looked in data/backups/)"; exit 1; }
TMP=$(mktemp -d /tmp/meridian-restore-XXXXXX)
trap 'pkill -f "next start -p $PORT" 2>/dev/null || true; rm -rf "$TMP"' EXIT
gunzip -c "$BACKUP" > "$TMP/meridian.db"
echo "==> restored $BACKUP to $TMP/meridian.db ($(du -h "$TMP/meridian.db" | cut -f1))"
export DATABASE_PATH="$TMP/meridian.db" DISCORD_BOT_TOKEN= BASE_URL="http://localhost:$PORT"
node scripts/migrate.mjs
node scripts/smoke.mjs --no-build-check
node scripts/test/run.mjs
[ -d dashboard/.next ] || (cd dashboard && npm run build)
# Fully detached (own session, no inherited stdio) so a caller that pipes this
# script's output is not held open by the server.
(cd dashboard && setsid node node_modules/.bin/next start -p "$PORT" >"$TMP/server.log" 2>&1 </dev/null &)
for i in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done
curl -sf -o /dev/null "http://localhost:$PORT/login" && echo "==> dashboard answered on :$PORT from the restored copy" || { echo "dashboard did not answer"; cat "$TMP/server.log"; exit 1; }
echo "RESTORE DRILL OK"
