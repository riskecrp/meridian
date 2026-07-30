#!/usr/bin/env bash
# Meridian deploy: pull, install deps if lockfiles changed, migrate, build, restart.
# Usage: ./scripts/deploy.sh [--dashboard] [--bot] [--no-pull]
#   --dashboard  only rebuild/restart the dashboard
#   --bot        only restart the bot
#   --no-pull    deploy the working tree as-is (local edits/testing)
set -euo pipefail
cd "$(dirname "$0")/.."

DASH=1; BOT=1; PULL=1
for arg in "$@"; do
  case "$arg" in
    --dashboard) BOT=0 ;;
    --bot)       DASH=0 ;;
    --no-pull)   PULL=0 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

before=$(git rev-parse HEAD)
if [ "$PULL" = 1 ]; then git pull --ff-only; fi
after=$(git rev-parse HEAD)

changed() { [ "$before" != "$after" ] && git diff --name-only "$before" "$after" | grep -q "$1"; }

if changed "^package-lock.json";           then npm ci; fi
if [ "$BOT"  = 1 ] && changed "^bot/package-lock.json";       then (cd bot && npm ci); fi
if [ "$DASH" = 1 ] && changed "^dashboard/package-lock.json"; then (cd dashboard && npm ci); fi

# Gate before anything touches production. Deliberately ahead of the migrate
# below: the smoke test applies migrations to a throwaway copy first, so a broken
# one aborts the deploy with the live database untouched. It also loads every bot
# module, which nothing else here does — index.js imports bot/commands/*.js with
# no try/catch, so one bad file means a restart loop.
# --no-build-check because the source is legitimately newer than the build at this
# point; the build below is what resolves that.
echo "==> smoke test"
node scripts/smoke.mjs --no-build-check

node scripts/migrate.mjs

if [ "$DASH" = 1 ]; then
  # NEVER run parallel `next build`s on this box — small VM, it OOMs.
  (cd dashboard && npm run build)
  systemctl restart meridian-dashboard
fi
if [ "$BOT" = 1 ]; then
  systemctl restart meridian-bot
fi

sleep 3
systemctl is-active meridian-dashboard meridian-bot | paste <(echo -e "dashboard\nbot") -
