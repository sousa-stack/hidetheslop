#!/usr/bin/env bash
# Loads the newest encrypted dump from BACKUP_REMOTE into a new database beside the live one.
# It refuses the live database, so a mistake can't overwrite it: check the result, then swap
# it in by hand, as docs/CROWD-API.md describes.
# Usage: ./restore.sh <new-database> [dump-file-name]
set -euo pipefail

TARGET="${1:-}"
WANTED="${2:-}"
APP_DIR="${APP_DIR:-$HOME/hidetheslop}"
BACKUP_DIR="$HOME/backups"
DUMP_NAME='^hidetheslop-[0-9]{8}-[0-9]{6}\.sql\.gz$'
# More than the seq could have grown since any dump we keep.
SEQ_JUMP=1000000

cd "$APP_DIR"
umask 077
. scripts/backup-rclone.sh

die() {
  echo "!!! $1" >&2
  exit 1
}

[[ "$TARGET" =~ ^[a-z_][a-z0-9_]*$ ]] || die "Usage: ./restore.sh <new-database> [dump-file-name]"
[ -z "$WANTED" ] || [[ "$WANTED" =~ $DUMP_NAME ]] || die "That isn't a dump file name."
[ -n "$(env_value BACKUP_REMOTE)" ] || die "BACKUP_REMOTE isn't set in .env."

LIVE="$(docker compose exec -T db sh -c 'printf %s "$POSTGRES_DB"')"
[ -n "$LIVE" ] || die "Can't tell which database is live, so nothing was touched."
case "$TARGET" in
  "$LIVE" | postgres | template0 | template1) die "Refusing to restore into $TARGET." ;;
esac

mkdir -p "$BACKUP_DIR"
WORK="$(mktemp -d "$BACKUP_DIR/restore.XXXXXX")"
RCLONE_ENV="$(mktemp)"
trap 'rm -rf "$WORK"; rm -f "$RCLONE_ENV"' EXIT
write_rclone_env "$RCLONE_ENV"

rclone() {
  docker run --rm --user "$(id -u):$(id -g)" --env-file "$RCLONE_ENV" \
    -v "$WORK:/restore" "$RCLONE_IMAGE" "$@"
}

NAME="$WANTED"
if [ -z "$NAME" ]; then
  # The stamp in each name sorts by date.
  NAME="$(rclone lsf --files-only backupcrypt: | grep -E "$DUMP_NAME" | sort | tail -n 1 || true)"
fi
[ -n "$NAME" ] || die "No dumps found at BACKUP_REMOTE."

echo "==> Fetching $NAME"
rclone copyto "backupcrypt:$NAME" "/restore/$NAME"
DUMP="$WORK/$NAME"

# Before the database exists, so a bad dump leaves nothing behind.
gzip -t "$DUMP" || die "$NAME is damaged."
if ! gzip -dc "$DUMP" | tail -n 5 | grep -q '^-- PostgreSQL database dump complete$'; then
  die "$NAME has no completion marker, so it may be cut short."
fi

echo "==> Loading into $TARGET"
docker compose exec -T db sh -c 'exec createdb -U "$POSTGRES_USER" "$1"' sh "$TARGET" \
  || die "Couldn't create $TARGET. It may already exist, and nothing was loaded into it."

# An old dump rewinds verdict_seq. Clients holding a higher cursor would then never see a
# new verdict, because the API only sends what's above their cursor. In the same transaction
# as the load, so a restored database can't exist without this.
SEQ_SQL="SELECT pg_catalog.setval('public.verdict_seq',
  greatest((SELECT last_value FROM public.verdict_seq),
           coalesce((SELECT max(seq) FROM public.verdicts), 0)) + $SEQ_JUMP);"

if ! { gzip -dc "$DUMP"; printf '%s\n' "$SEQ_SQL"; } \
  | docker compose exec -T db sh -c \
    'exec psql -X -q -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" -d "$1"' sh "$TARGET" \
    >/dev/null; then
  die "The load failed and was rolled back. $TARGET exists but is empty."
fi

query() {
  docker compose exec -T db sh -c 'exec psql -X -At -U "$POSTGRES_USER" -d "$1" -c "$2"' sh "$TARGET" "$1"
}
echo "==> Restored $NAME into $TARGET"
echo "    verdict_seq moved $SEQ_JUMP past the dump, to $(query 'select last_value from verdict_seq'), so clients' cursors keep working"
echo "    rows: $(query "select (select count(*) from hashes) || ' hashes, ' || (select count(*) from votes) || ' votes, ' || (select count(*) from verdicts) || ' verdicts, ' || (select count(*) from embeddings) || ' embeddings'")"
