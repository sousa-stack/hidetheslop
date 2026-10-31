#!/usr/bin/env bash
# Deploy the Hide the Slop API. Run on the droplet as the deploy user.
# Usage: ./deploy.sh [git-ref]   (default: main)
set -euo pipefail

REF="${1:-main}"
APP_DIR="${APP_DIR:-$HOME/hidetheslop}"
HEALTH_URL="http://127.0.0.1:3000/health"

cd "$APP_DIR"
PREV="$(git rev-parse HEAD)"

echo "==> Fetching $REF"
git fetch --prune
git checkout -q "$REF"
# A tag or a commit leaves HEAD detached, and there's nothing to pull.
if git symbolic-ref -q HEAD >/dev/null; then
  git pull -q --ff-only origin "$REF"
fi
echo "    $PREV -> $(git rev-parse --short HEAD)"

# Rollback restores code and not the database, which is why migrations only ever add.
rollback() {
  trap - ERR
  set +e
  echo "!!! Deploy failed. Rolling back to $PREV"
  git checkout -q "$PREV"
  docker compose build api
  docker compose up -d
  docker compose logs --tail=50 api
  exit 1
}
trap rollback ERR

echo "==> Building"
docker compose pull --ignore-buildable
docker compose build api

# Before the new code serves traffic. Through node, not npm, which wants to write to a
# read-only filesystem.
echo "==> Running migrations"
docker compose up -d --wait db
docker compose run --rm -T api node dist/migrate.js

echo "==> Starting"
docker compose up -d --remove-orphans
# Waits on the API alone, so a slow Uptime Kuma can't roll back an API deploy.
docker compose up -d --wait --wait-timeout 180 api

echo "==> Health check"
healthy=""
for i in $(seq 1 20); do
  if docker compose exec -T api wget -qO- "$HEALTH_URL" >/dev/null 2>&1; then
    echo "    healthy after ${i}s"
    healthy="yes"
    break
  fi
  sleep 1
done
[ -n "$healthy" ]

# After the trap is gone, and allowed to fail, so a prune can't undo or fail a good deploy.
trap - ERR
docker image prune -f >/dev/null || echo "    image prune failed; the deploy is fine"
echo "==> Deployed $(git rev-parse --short HEAD)"
