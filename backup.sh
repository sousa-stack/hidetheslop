#!/usr/bin/env bash
# Dumps the database to ~/backups and keeps the newest 14. Run on the droplet nightly.
# With BACKUP_REMOTE in .env, it also puts an encrypted copy in the bucket. It never deletes
# anything there: the droplet shouldn't be able to destroy its own backups, so retention is
# the bucket's lifecycle rule and lock.
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/hidetheslop}"
BACKUP_DIR="$HOME/backups"
KEEP=14

cd "$APP_DIR"
umask 077
mkdir -p "$BACKUP_DIR"
. scripts/backup-rclone.sh

STAMP="$(date -u +%Y%m%d-%H%M%S)"
FINAL="$BACKUP_DIR/hidetheslop-$STAMP.sql.gz"
TMP="$FINAL.tmp"
RCLONE_ENV=""
trap 'rm -f "$TMP" "$RCLONE_ENV"' EXIT
FAILED=""

# COPY writes rows in physical order, so a dump would keep each batch together. Ordering by
# random ids mixes them up. These index names come from the migrations, and schema.test.ts
# checks that each starts with a random id. Bounded by lock_timeout so it can't hold up the
# API behind a long lock. If it fails the dump still runs, because a dump in arrival order
# beats no dump, but the run is reported as failed.
if ! docker compose exec -T db sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SET lock_timeout = '10s';
CLUSTER votes USING votes_hash_id_token_pk;
CLUSTER hashes USING hashes_pkey;
CLUSTER embeddings USING embeddings_hash_id_model_version_pk;
CLUSTER verdicts USING verdicts_pkey;
SQL
then
  echo "!!! CLUSTER failed, so tonight's dump keeps rows in arrival order" >&2
  FAILED="yes"
fi

# To a temp file, then renamed, so a failed dump can't rotate out a good one.
docker compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$TMP"
gzip -t "$TMP"
mv "$TMP" "$FINAL"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'hidetheslop-*.sql.gz' -print \
  | sort -r \
  | tail -n +"$((KEEP + 1))" \
  | xargs -r rm -f --

echo "==> Backed up to $FINAL"

# After the local steps, so a failed upload can't cost the local dump.
if [ -n "$(env_value BACKUP_REMOTE)" ]; then
  NAME="$(basename "$FINAL")"
  RCLONE_ENV="$(mktemp)"
  if write_rclone_env "$RCLONE_ENV" \
    && docker run --rm --user "$(id -u):$(id -g)" --env-file "$RCLONE_ENV" \
      -v "$BACKUP_DIR:/backups:ro" "$RCLONE_IMAGE" \
      copyto "/backups/$NAME" "backupcrypt:$NAME"; then
    echo "==> Encrypted copy uploaded"
  else
    echo "!!! The encrypted upload failed. The local dump is safe." >&2
    FAILED="yes"
  fi
fi

[ -z "$FAILED" ] || exit 1

# Through stdin, because the URL holds the monitor's secret. A failed ping fails nothing: the
# monitor raises the alarm for a missed ping on its own.
PING_URL="$(env_value BACKUP_PING_URL)"
if [ -n "$PING_URL" ]; then
  printf 'url = "%s"\n' "$PING_URL" | curl -fsS --max-time 20 -o /dev/null --config - \
    || echo "    the monitor didn't answer; the backup is fine" >&2
fi
