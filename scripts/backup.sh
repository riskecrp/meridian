#!/usr/bin/env bash
# Nightly Meridian backup + log-table retention. Run by meridian-backup.timer.
#  1. Consistent snapshot via `sqlite3 .backup` -> data/backups/meridian-<stamp>.db.gz
#  2. Keep the newest $KEEP local backups.
#  3. Only after a successful backup: prune high-churn log tables older than
#     $RETAIN_DAYS (data is always captured in a backup before being pruned).
set -euo pipefail
DB=/opt/meridian/data/meridian.db
OUT=/opt/meridian/data/backups
KEEP=14
RETAIN_DAYS=180

mkdir -p "$OUT"
stamp=$(date +%Y%m%d-%H%M%S)
tmp="$OUT/meridian-$stamp.db"
sqlite3 "$DB" ".backup '$tmp'"
gzip "$tmp"
echo "backup written: $tmp.gz ($(du -h "$tmp.gz" | cut -f1))"

# Rotate: keep newest $KEEP
ls -1t "$OUT"/meridian-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

# Retention pruning (post-backup)
sqlite3 "$DB" <<SQL
DELETE FROM mentions             WHERE created_at < datetime('now', '-$RETAIN_DAYS days');
DELETE FROM edited_message_logs  WHERE created_at < datetime('now', '-$RETAIN_DAYS days');
DELETE FROM deleted_message_logs WHERE created_at < datetime('now', '-$RETAIN_DAYS days');
SQL
echo "retention pruning done (${RETAIN_DAYS}d window)"
