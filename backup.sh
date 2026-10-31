#!/usr/bin/env bash
# Dumps the database to ~/backups and keeps the newest 14. Run on the droplet nightly.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/hidetheslop}"
BACKUP_DIR="$HOME/backups"
KEEP=14

cd "$APP_DIR"
umask 077
mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
FINAL="$BACKUP_DIR/hidetheslop-$STAMP.sql.gz"
TMP="$FINAL.tmp"
trap 'rm -f "$TMP"' EXIT

# To a temp file, then renamed, so a failed dump can't rotate out a good one.
docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$TMP"
gzip -t "$TMP"
mv "$TMP" "$FINAL"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'hidetheslop-*.sql.gz' -print \
  | sort -r \
  | tail -n +"$((KEEP + 1))" \
  | xargs -r rm -f --

echo "==> Backed up to $FINAL"
