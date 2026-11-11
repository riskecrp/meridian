#!/usr/bin/env bash
# Nightly Meridian backup + log-table retention. Run by meridian-backup.timer.
#  1. Consistent snapshot via `sqlite3 .backup` -> data/backups/meridian-<stamp>.db.gz
#  2. Keep the newest $KEEP local backups.
#  3. Only after a successful backup: prune high-churn log tables older than
#     $RETAIN_DAYS (data is always captured in a backup before being pruned).
set -euo pipefail
DB=${DATABASE_PATH:-/opt/meridian/data/meridian.db}
OUT=${BACKUP_DIR:-$(dirname "$DB")/backups}
KEEP=${BACKUP_KEEP:-14}
RETAIN_DAYS=${RETAIN_DAYS:-180}

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
DELETE FROM discord_messages     WHERE created_at < datetime('now', '-$RETAIN_DAYS days');
DELETE FROM keyword_alerts       WHERE created_at < datetime('now', '-$RETAIN_DAYS days');
DELETE FROM member_join_leave_logs WHERE created_at < datetime('now', '-$RETAIN_DAYS days');
DELETE FROM sessions             WHERE expires_at < datetime('now');
DELETE FROM task_log             WHERE created_at < datetime('now', '-' || ($RETAIN_DAYS * 2) || ' days');
SQL
sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
echo "retention pruning done (${RETAIN_DAYS}d window)"
