#!/usr/bin/env bash
# Export Meridian tables to CSV (one file per table) for Google Sheets import.
# Usage: ./scripts/export-csv.sh [table ...]   export the named tables
#        ./scripts/export-csv.sh               export the default reporting set
#        ./scripts/export-csv.sh --all         export every table
#        ./scripts/export-csv.sh --list        print table names and exit
# Output: data/exports/<YYYY-MM-DD>/<table>.csv (data/ is gitignored).
# Reads only — safe to run against the live DB or a backup copy via DATABASE_PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${DATABASE_PATH:-data/meridian.db}"
[ -f "$DB" ] || { echo "no database at $DB (set DATABASE_PATH to override)" >&2; exit 1; }

# Tables that answer the questions the team actually asks in a spreadsheet.
DEFAULT_TABLES=(factions faction_members faction_reviews faction_history
  staff teams tasks task_log reminders recurring_reminders
  scene_logs fm_hours_log treasury_logs announcement_log site_audit_log)

all_tables() {
  sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
}

case "${1:-}" in
  --list) all_tables; exit 0 ;;
  --all)  mapfile -t TABLES < <(all_tables) ;;
  "")     TABLES=("${DEFAULT_TABLES[@]}") ;;
  *)      TABLES=("$@") ;;
esac

OUT="data/exports/$(date +%F)"
mkdir -p "$OUT"

for t in "${TABLES[@]}"; do
  if ! sqlite3 "$DB" "SELECT 1 FROM \"$t\" LIMIT 1;" >/dev/null 2>&1; then
    echo "skip: no such table $t" >&2; continue
  fi
  sqlite3 -header -csv "$DB" "SELECT * FROM \"$t\";" > "$OUT/$t.csv"
  echo "$OUT/$t.csv  ($(wc -l < "$OUT/$t.csv") lines)"
done
