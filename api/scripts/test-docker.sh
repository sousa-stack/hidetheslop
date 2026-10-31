#!/usr/bin/env bash
# The same tests on the real versions: Node 26 and Postgres 18 in containers. The Mac
# runs an older Node, so a pass in test-local.sh doesn't prove production works.
set -euo pipefail

cd "$(dirname "$0")/.."

SUFFIX="$$-$RANDOM"
NETWORK="hidetheslop-test-$SUFFIX"
DB="hidetheslop-test-db-$SUFFIX"
RUNNER="hidetheslop-test-node-$SUFFIX"
DB_NAME=hidetheslop_test

cleanup() {
  docker rm -f -v "$RUNNER" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NETWORK" >/dev/null

# No published port, and no password: only the test container can reach it.
docker run -d --name "$DB" --network "$NETWORK" \
  --tmpfs /var/lib/postgresql \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB="$DB_NAME" \
  postgres:18-alpine >/dev/null

# Over TCP, because the image's first start listens only on a socket while it sets up.
for _ in $(seq 1 60); do
  if docker exec "$DB" pg_isready -q -h 127.0.0.1 -U postgres -d "$DB_NAME"; then break; fi
  sleep 1
done
docker exec "$DB" pg_isready -q -h 127.0.0.1 -U postgres -d "$DB_NAME"

docker run --rm --name "$RUNNER" --network "$NETWORK" \
  -v "$PWD:/src:ro" \
  -e TEST_DATABASE_URL="postgres://postgres@$DB:5432/$DB_NAME" \
  -e DATABASE_URL="postgres://postgres@$DB:5432/$DB_NAME" \
  node:26-alpine sh -euc '
    mkdir /work
    tar -C /src --exclude=./node_modules --exclude=./dist -cf - . | tar -C /work -xf -
    cd /work
    node --version
    npm ci --no-audit --no-fund
    npm run --silent migrate
    npm test
  '
