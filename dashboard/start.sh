#!/bin/bash
set -e
cd /opt/meridian/dashboard

# NOTE: Do NOT build here. Builds happen at deploy time (run `npm run build`
# manually after deploying). Building on every service start caused parallel
# `next build` processes across all apps on boot, exhausting the 2Gi VM and
# triggering OOM crash loops.
if [ ! -f .next/BUILD_ID ]; then
  echo "[start.sh] ERROR: no production build found (.next/BUILD_ID missing)." >&2
  echo "[start.sh] Run 'npm run build' in $(pwd) before starting." >&2
  exit 1
fi

exec npm start
