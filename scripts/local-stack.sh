#!/usr/bin/env bash
# Runs the real production stack on this Mac, under its own project name, and proves it
# through Caddy. Usage: scripts/local-stack.sh up | check | down
#
# This Mac is shared, so everything here stays inside the hidetheslop-local project and
# .local/. It can't prove Cloudflare in front, real certificates, real client IPs or the
# firewall. docs/TESTING.md has the full list.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="$ROOT/.local"
PROJECT=hidetheslop-local
COPY="$LOCAL/copy"
ORIGIN="$LOCAL/origin.git"
SANDBOX_HOME="$LOCAL/home"
BACKUPS="$SANDBOX_HOME/backups"
STORE="$LOCAL/store"
API_HOST=api.hidetheslop.com
STATUS_HOST=status.hidetheslop.com
# The documentation range, so a forged address can't be anyone's.
FORGED=203.0.113

compose() {
  docker compose -p "$PROJECT" --project-directory "$ROOT" \
    -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.local.yml" \
    --env-file "$LOCAL/env" "$@"
}

require_tools() {
  docker compose version >/dev/null 2>&1 || {
    echo "docker compose isn't installed. docs/TESTING.md says how." >&2
    exit 1
  }
}

generate_env() {
  mkdir -p "$LOCAL"
  [ -f "$LOCAL/env" ] && return 0
  (
    umask 077
    {
      echo "POSTGRES_USER=hidetheslop"
      echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
      echo "POSTGRES_DB=hidetheslop"
      echo "ACME_EMAIL=local@example.com"
    } > "$LOCAL/env"
  )
}

# Made from the real file rather than kept as a second copy that could drift.
generate_caddyfile() {
  mkdir -p "$LOCAL/caddy"
  awk 'NR == 1 && $0 == "{" { print; print "    local_certs"; next } { print }' \
    "$ROOT/Caddyfile" > "$LOCAL/caddy/Caddyfile"
}

caddyfile_differs_only_by_local_certs() {
  local changes
  changes="$(diff "$ROOT/Caddyfile" "$LOCAL/caddy/Caddyfile" | grep '^[<>]' || true)"
  [ "$changes" = ">     local_certs" ] || { echo "unexpected difference: $changes"; return 1; }
}

cmd_up() {
  require_tools
  generate_env
  generate_caddyfile
  caddyfile_differs_only_by_local_certs
  # In the order deploy.sh does it.
  compose build api
  compose up -d --wait db
  compose run --rm -T api node dist/migrate.js
  compose up -d --wait --wait-timeout 300
  read_ports
  echo "==> Up. Caddy is on 127.0.0.1:$HTTPS_PORT (https) and 127.0.0.1:$HTTP_PORT (http)."
}

cmd_down() {
  require_tools
  generate_env
  generate_caddyfile
  compose down -v --remove-orphans --rmi local
  rm -rf "$COPY" "$ORIGIN" "$LOCAL/work" "$SANDBOX_HOME" "$STORE" "$LOCAL/bin" "$LOCAL/caddy" \
    "$LOCAL/root.crt" "$LOCAL/env" "$LOCAL/docker-calls.log" "$LOCAL/ping-"* \
    "$LOCAL/backup.out" "$LOCAL/status.html"
  echo "==> Down, with this project's volumes removed."
}

# --- Talking to the stack through Caddy --------------------------------------------------

read_ports() {
  HTTPS_PORT="$(compose port caddy 443 | sed 's/.*://')"
  HTTP_PORT="$(compose port caddy 80 | sed 's/.*://')"
  [ -n "$HTTPS_PORT" ] && [ -n "$HTTP_PORT" ]
}

api() {
  curl -sS --max-time 15 --cacert "$LOCAL/root.crt" \
    --resolve "$API_HOST:$HTTPS_PORT:127.0.0.1" "$@"
}

status_page() {
  curl -sS --max-time 15 --cacert "$LOCAL/root.crt" \
    --resolve "$STATUS_HOST:$HTTPS_PORT:127.0.0.1" "$@"
}

api_url() { echo "https://$API_HOST:$HTTPS_PORT$1"; }

code_of() { api -o /dev/null -w '%{http_code}' "$@"; }

post_json() {
  api -H 'content-type: application/json' -H 'Expect:' --data-binary "$2" -w '\n%{http_code}' "$(api_url "$1")"
}

wait_for_https() {
  local _
  for _ in $(seq 1 60); do
    # Colima's port forward can lag a new container by a few seconds.
    if compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$LOCAL/root.crt" 2>/dev/null \
      && [ "$(code_of "$(api_url /health)" 2>/dev/null)" = 200 ]; then
      return 0
    fi
    sleep 1
  done
  echo "no 200 from /health through Caddy within 60s"
  return 1
}

wait_for_api_healthy() {
  local _ id
  for _ in $(seq 1 60); do
    id="$(compose ps -q api)"
    if [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ]; then
      return 0
    fi
    sleep 2
  done
  echo "the API didn't become healthy"
  return 1
}

psql_in() {
  compose exec -T db sh -c 'exec psql -X -At -U "$POSTGRES_USER" -d "$1" -c "$2"' sh "$1" "$2"
}
sql() { psql_in hidetheslop "$1"; }

new_phash() { openssl rand -hex 8; }
new_token() { openssl rand -hex 16; }

# Everything the logs must never hold.
SECRETS_TO_FIND=()
remember() { SECRETS_TO_FIND+=("$1"); }

vote_json() {
  remember "$1"
  remember "$2"
  printf '{"hashVersion":1,"votes":[{"phash":"%s","token":"%s","label":"ai","source":"rated"}]}' "$1" "$2"
}

reload_caddy() {
  compose exec -T caddy caddy reload --config "$1" --adapter caddyfile
}

# --- The checks --------------------------------------------------------------------------

check_generated_caddyfile() { caddyfile_differs_only_by_local_certs; }

check_healthy() {
  local service id state
  for service in api db uptime; do
    id="$(compose ps -q "$service")"
    state="$(docker inspect -f '{{.State.Health.Status}}' "$id")"
    [ "$state" = healthy ] || { echo "$service is $state"; return 1; }
  done
  # Caddy has no healthcheck, so running is all it can say.
  state="$(docker inspect -f '{{.State.Status}}' "$(compose ps -q caddy)")"
  [ "$state" = running ] || { echo "caddy is $state"; return 1; }
}

check_read_only() {
  [ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$(compose ps -q api)")" = true ] || return 1
  if compose exec -T api sh -c 'touch /app/written' 2>/dev/null; then
    echo "wrote to the API's filesystem"
    return 1
  fi
}

check_no_host_ports() {
  local service id
  for service in api db uptime; do
    id="$(compose ps -q "$service")"
    [ "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$id")" = 0 ] \
      || { echo "$service has a host port"; return 1; }
  done
}

check_caddy_only_on_loopback() {
  local bindings
  bindings="$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$(compose ps -q caddy)")"
  if echo "$bindings" | grep -q '"HostIp":"\(0\.0\.0\.0\)\?"'; then
    echo "$bindings"
    return 1
  fi
}

check_migrations() {
  compose run --rm -T api node dist/migrate.js | grep -q 'migrations applied' || return 1
  [ "$(sql "select count(*) from information_schema.tables where table_schema = 'public'")" = 4 ]
}

check_health() {
  local body
  body="$(api "$(api_url /health)")" || return 1
  [ "$body" = '{"status":"ok"}' ] || { echo "$body"; return 1; }
}

check_status_page() {
  local code
  code="$(status_page -L -o "$LOCAL/status.html" -w '%{http_code}' "https://$STATUS_HOST:$HTTPS_PORT/")" || return 1
  [ "$code" = 200 ] || { echo "got $code"; return 1; }
  grep -qi 'uptime kuma' "$LOCAL/status.html" || { echo "that wasn't Uptime Kuma"; return 1; }
  # Its first-run page is public, and asks the first visitor to pick a database.
  if logs_of uptime | grep -q 'Waiting for user action'; then
    echo "Uptime Kuma is on its database setup page"
    return 1
  fi
}

check_votes_reach_verdicts() {
  local i out headers
  PUBLISHED="$(new_phash)"
  for i in 1 2 3 4 5; do
    out="$(post_json /v1/votes "$(vote_json "$PUBLISHED" "$(new_token)")")" || return 1
    [ "$(echo "$out" | tail -n 1)" = 202 ] || { echo "$out"; return 1; }
  done
  # A batch of new pictures at once, for the backup check that rows get mixed up.
  local batch="" sep="" phash tok
  for i in $(seq 1 30); do
    phash="$(new_phash)"
    tok="$(new_token)"
    remember "$phash"
    remember "$tok"
    batch="$batch$sep{\"phash\":\"$phash\",\"token\":\"$tok\",\"label\":\"ai\",\"source\":\"hid\"}"
    sep=","
  done
  out="$(post_json /v1/votes "{\"hashVersion\":1,\"votes\":[$batch]}")" || return 1
  [ "$(echo "$out" | tail -n 1)" = 202 ] || { echo "$out"; return 1; }

  if api "$(api_url '/v1/verdicts?hashVersion=1')" | grep -q "$PUBLISHED"; then
    echo "published before the job ran"
    return 1
  fi

  # The job runs 30 seconds after startup.
  compose restart api >/dev/null 2>&1
  wait_for_api_healthy || return 1
  for i in $(seq 1 30); do
    if api "$(api_url '/v1/verdicts?hashVersion=1')" | grep -q "$PUBLISHED"; then break; fi
    [ "$i" != 30 ] || { echo "not published 60s after the restart"; return 1; }
    sleep 2
  done
  headers="$(api -D - -o /dev/null "$(api_url '/v1/verdicts?hashVersion=1')")"
  echo "$headers" | grep -qi '^cache-control: public, max-age=3600' \
    || { echo "$headers"; return 1; }
}

check_embedding_gate() {
  local phash first second third out vector stored
  stored="$(sql 'select count(*) from embeddings')"
  phash="$(new_phash)"
  first="$(new_token)"
  second="$(new_token)"
  third="$(new_token)"
  vector="$(head -c 512 /dev/zero | base64 | tr -d '\n')"
  embed_body() {
    printf '{"hashVersion":1,"modelVersion":1,"items":[{"phash":"%s","token":"%s","vector":"%s"}]}' "$phash" "$1" "$vector"
  }

  out="$(post_json /v1/votes "$(vote_json "$phash" "$first")")" || return 1
  out="$(post_json /v1/votes "$(vote_json "$phash" "$second")")" || return 1
  echo "$out" | grep -q '"needEmbedding":\[\]' || { echo "asked at 2 votes: $out"; return 1; }

  post_json /v1/embeddings "$(embed_body "$second")" | grep -q '^202$' || return 1
  [ "$(sql 'select count(*) from embeddings')" = "$stored" ] || { echo "stored at 2 votes"; return 1; }

  out="$(post_json /v1/votes "$(vote_json "$phash" "$third")")" || return 1
  echo "$out" | grep -q "\"needEmbedding\":\[\"$phash\"\]" || { echo "not asked at 3: $out"; return 1; }

  post_json /v1/embeddings "$(embed_body "$third")" | grep -q '^202$' || return 1
  [ "$(sql 'select count(*) from embeddings')" = "$((stored + 1))" ] || { echo "not stored at 3 votes"; return 1; }
}

check_extra_field() {
  local phash tok out
  phash="$(new_phash)"
  tok="$(new_token)"
  remember "$phash"
  remember "$tok"
  out="$(post_json /v1/votes "{\"hashVersion\":1,\"url\":\"https://example.com/$phash\",\"votes\":[{\"phash\":\"$phash\",\"token\":\"$tok\",\"label\":\"ai\",\"source\":\"rated\"}]}")" || return 1
  [ "$(echo "$out" | tail -n 1)" = 400 ] || { echo "$out"; return 1; }
}

padded_vote() {
  local size="$1" head
  head="$(vote_json "$(new_phash)" "$(new_token)")"
  head="${head%\}}"
  printf '%s%*s}' "$head" "$((size - ${#head} - 1))" ''
}

check_body_limit() {
  local file="$LOCAL/body.json" size code
  for size in 64000 64001; do
    padded_vote "$size" > "$file"
    [ "$(wc -c < "$file" | tr -d ' ')" = "$size" ] || { echo "body isn't $size bytes"; return 1; }
    code="$(post_json /v1/votes "@$file" | tail -n 1)"
    if [ "$size" = 64000 ]; then
      [ "$code" = 202 ] || { echo "64,000 bytes got $code"; return 1; }
    else
      [ "$code" = 413 ] || { echo "64,001 bytes got $code"; return 1; }
    fi
  done
  rm -f "$file"
}

# Over the 120-a-minute limit on /v1/verdicts. Votes allow only 60 an hour, and a probe there
# would starve the checks after it. Prints how many came back 429.
probe_rate_limit() {
  local mode="$1" limited=0 i ip code
  for i in $(seq 1 135); do
    ip="$FORGED.$((i % 250 + 1))"
    [ "$mode" = distinct ] || ip="$FORGED.200"
    code="$(code_of -H "CF-Connecting-IP: $ip" "$(api_url '/v1/verdicts?hashVersion=1')")"
    [ "$code" != 429 ] || limited=$((limited + 1))
  done
  echo "$limited"
}

check_forged_ip_ignored() {
  local limited
  limited="$(probe_rate_limit distinct)"
  # All one client to the API, so the distinct addresses bought nothing.
  [ "$limited" -gt 0 ] || { echo "135 requests with forged addresses were never limited"; return 1; }
}

# The check above also passes with trusted_proxies deleted, so prove that trusting the sender
# really does change the outcome.
check_forged_ip_control() {
  local subnet limited same rc=0
  subnet="$(docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' "${PROJECT}_web")"
  sed "s|trusted_proxies static .*|trusted_proxies static $subnet|" "$LOCAL/caddy/Caddyfile" \
    > "$LOCAL/caddy/Caddyfile.trust-bridge"
  reload_caddy /etc/caddy/variants/Caddyfile.trust-bridge >/dev/null 2>&1 || return 1
  limited="$(probe_rate_limit distinct)"
  same="$(probe_rate_limit same)"
  reload_caddy /etc/caddy/Caddyfile >/dev/null 2>&1 || rc=1
  [ "$limited" = 0 ] || { echo "$limited forged-address requests shared a limit"; rc=1; }
  [ "$same" -gt 0 ] || { echo "one forged address was never limited"; rc=1; }
  return "$rc"
}

logs_of() { docker logs "$(compose ps -aq "$1")" 2>&1; }

check_logs_clean() {
  local leak_path needle logs code rc=0
  leak_path="$(new_phash)"
  remember "$leak_path"
  [ "$(code_of "$(api_url "/v1/verdicts/$leak_path")")" = 404 ] || { echo "no 404"; rc=1; }

  compose stop api >/dev/null 2>&1
  code="$(code_of "$(api_url "/v1/verdicts/$leak_path")")"
  [ "$code" = 502 ] || { echo "stopping the API gave $code, not 502"; rc=1; }

  # Not admin.api: that's this script's own `caddy reload`, from inside the container, and
  # no client can reach Caddy's admin port.
  logs="$(logs_of caddy | grep -v '"logger":"admin.api"'; compose start api >/dev/null 2>&1; wait_for_api_healthy >/dev/null; logs_of api)"
  for needle in client_ip remote_ip "$FORGED." "/v1/" "${SECRETS_TO_FIND[@]}"; do
    if printf '%s' "$logs" | grep -qF -- "$needle"; then
      echo "the logs contain ${needle:0:12}"
      rc=1
    fi
  done
  local gateway
  gateway="$(docker network inspect -f '{{(index .IPAM.Config 0).Gateway}}' "${PROJECT}_web")"
  if [ -n "$gateway" ] && printf '%s' "$logs" | grep -qF -- "$gateway"; then
    echo "the logs contain the client's address"
    rc=1
  fi
  return "$rc"
}

# With `log default` gone the same 502 must log the client, or the check above proves nothing.
check_logs_control() {
  local rc=0
  awk '/^    log default \{/ { skip = 1 } !skip { print } skip && /^    }/ { skip = 0 }' \
    "$LOCAL/caddy/Caddyfile" > "$LOCAL/caddy/Caddyfile.logs-on"
  reload_caddy /etc/caddy/variants/Caddyfile.logs-on >/dev/null 2>&1 || return 1
  compose stop api >/dev/null 2>&1
  code_of "$(api_url /health)" >/dev/null
  logs_of caddy | grep -q '"client_ip"' || { echo "no client_ip with the block removed"; rc=1; }
  reload_caddy /etc/caddy/Caddyfile >/dev/null 2>&1 || rc=1
  compose start api >/dev/null 2>&1
  wait_for_api_healthy || rc=1
  return "$rc"
}

check_data_survives() {
  local before after
  before="$(sql 'select (select count(*) from hashes), (select count(*) from votes), (select count(*) from embeddings)')"
  compose down >/dev/null 2>&1
  compose up -d --wait --wait-timeout 300 >/dev/null 2>&1 || return 1
  read_ports
  wait_for_https || return 1
  after="$(sql 'select (select count(*) from hashes), (select count(*) from votes), (select count(*) from embeddings)')"
  [ "$before" = "$after" ] || { echo "$before became $after"; return 1; }
  api "$(api_url '/v1/verdicts?hashVersion=1')" | grep -q "$PUBLISHED" || { echo "the verdict is gone"; return 1; }
}

check_cluster_index() {
  local first
  first="$(sql "select a.attname from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where c.relname = 'votes_hash_id_token_pk'")"
  [ "$first" = hash_id ] || { echo "starts with $first"; return 1; }
  [ "$(sql "select column_default from information_schema.columns where table_name = 'hashes' and column_name = 'id'")" = 'gen_random_uuid()' ]
}

# --- The real deploy.sh and backup.sh, in a throwaway copy -------------------------------

# They run git and daemon-wide commands, and rollback would detach HEAD on the real main, so
# they get a copy with its own origin. This shim keeps them inside this project without
# either script gaining a local mode. `compose pull` is skipped because a deploy would pull
# newer Caddy and Postgres images, and the local checks use the ones already here.
write_docker_shim() {
  local real
  real="$(command -v docker)"
  mkdir -p "$LOCAL/bin"
  cat > "$LOCAL/bin/docker" <<SHIM
#!/usr/bin/env bash
printf '%s ' "\$@" >> "$LOCAL/docker-calls.log"
echo >> "$LOCAL/docker-calls.log"
case "\${1:-}" in
  compose)
    shift
    [ "\${1:-}" != pull ] || exit 0
    exec "$real" compose -p "$PROJECT" "\$@"
    ;;
  image | system | volume | network | container)
    [ "\${2:-}" != prune ] || exit 0
    ;;
  run)
    shift
    # Stands in for the bucket: rclone's local backend, behind the same crypt remote.
    case " \$* " in
      *rclone/rclone*) exec "$real" run -v "$STORE:/store" "\$@" ;;
    esac
    exec "$real" run "\$@"
    ;;
esac
exec "$real" "\$@"
SHIM
  chmod +x "$LOCAL/bin/docker"
}

# Runs a command as if on the droplet. HOME moves so ~/backups lands in .local, which means
# the real Docker config has to be named.
in_copy() {
  (
    cd "$COPY"
    export HOME="$SANDBOX_HOME" APP_DIR="$COPY" PATH="$LOCAL/bin:$PATH"
    export DOCKER_CONFIG="$REAL_DOCKER_CONFIG"
    export COMPOSE_FILE=docker-compose.yml:docker-compose.local.yml
    "$@"
  )
}

git_copy() {
  git -C "$COPY" -c user.name=local-stack -c user.email=local@example.com -c commit.gpgsign=false "$@"
}

make_copy() {
  rm -rf "$COPY" "$ORIGIN" "$LOCAL/work" "$SANDBOX_HOME" "$STORE" "$LOCAL/docker-calls.log"
  mkdir -p "$COPY/.local" "$SANDBOX_HOME" "$STORE"
  # The ignore rules also keep test-images/ out, and it's named as well because it must never
  # end up anywhere new.
  rsync -a --exclude=/.git --exclude=/.local --exclude=/test-images --filter=':- .gitignore' \
    "$ROOT/" "$COPY/"
  cp "$LOCAL/env" "$COPY/.env"
  cp -R "$LOCAL/caddy" "$COPY/.local/caddy"
  git init -q -b main "$COPY"
  # Without this a failed init would commit to the real repo.
  [ "$(cd "$COPY" && git rev-parse --show-toplevel | xargs realpath)" = "$(realpath "$COPY")" ] \
    || { echo "the copy isn't its own repo"; return 1; }
  git_copy add -A
  git_copy commit -q -m "throwaway copy"
  git init -q --bare -b main "$ORIGIN"
  git_copy remote add origin "$ORIGIN"
  git_copy push -q -u origin main
}

check_deploy() {
  make_copy || return 1
  write_docker_shim
  in_copy bash "$COPY/deploy.sh" main || return 1
  read_ports
  wait_for_https || return 1
  grep -q 'compose run --rm -T api node dist/migrate.js' "$LOCAL/docker-calls.log"
}

# Pushes a change to the copy's origin, the way a commit reaches the droplet.
push_change() {
  local message="$1" script="$2"
  rm -rf "$LOCAL/work"
  git clone -q "$ORIGIN" "$LOCAL/work"
  (cd "$LOCAL/work" && sh -c "$script")
  git -C "$LOCAL/work" -c user.name=local-stack -c user.email=local@example.com \
    -c commit.gpgsign=false commit -qam "$message"
  git -C "$LOCAL/work" push -q origin main
}

check_rollback() {
  local good
  good="$(git_copy rev-parse HEAD)"
  # Builds and migrates fine, then dies at startup: the worst case for a real deploy.
  push_change "break startup" \
    "sed -i.bak 's|^CMD .*|CMD [\"node\", \"-e\", \"process.exit(1)\"]|' api/Dockerfile && rm api/Dockerfile.bak"
  if in_copy bash "$COPY/deploy.sh" main; then
    echo "a broken deploy reported success"
    return 1
  fi
  [ "$(git_copy rev-parse HEAD)" = "$good" ] || { echo "HEAD didn't go back"; return 1; }
  wait_for_api_healthy || return 1
  read_ports
  wait_for_https
}

# Also the first deploy after a rollback, which starts on a detached HEAD.
check_caddyfile_deploy() {
  push_change "fix startup and change the Caddyfile" \
    "sed -i.bak 's|^CMD .*|CMD [\"node\", \"dist/server.js\"]|' api/Dockerfile && rm api/Dockerfile.bak && echo '# changed' >> Caddyfile"
  # `git checkout` replaces a file rather than editing it, so do the same here. The local
  # override mounts this generated file, not the tracked one.
  awk '{ print } /X-Frame-Options "DENY"/ { print "        X-Local-Check \"new config\"" }' \
    "$COPY/.local/caddy/Caddyfile" > "$COPY/.local/caddy/Caddyfile.new"
  mv "$COPY/.local/caddy/Caddyfile.new" "$COPY/.local/caddy/Caddyfile"
  in_copy bash "$COPY/deploy.sh" main || return 1
  [ "$(git_copy symbolic-ref --short HEAD)" = main ] || { echo "HEAD is still detached"; return 1; }
  read_ports
  wait_for_https || return 1
  api -D - -o /dev/null "$(api_url /health)" | grep -qi '^x-local-check: new config' \
    || { echo "Caddy is still on the old config"; return 1; }
}

dump_files() { find "$BACKUPS" -maxdepth 1 -name 'hidetheslop-*.sql.gz' | sort; }
newest_dump() { dump_files | tail -n 1; }

check_backup_plain() {
  local before
  # In arrival order first, or the check after this one proves nothing.
  before="$(compose exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | votes_order)"
  if echo "$before" | LC_ALL=C sort -c 2>/dev/null; then
    echo "votes were already in id order, so this can't show CLUSTER working"
    return 1
  fi
  in_copy bash "$COPY/backup.sh" || return 1
  [ -n "$(newest_dump)" ] || { echo "no dump"; return 1; }
  gzip -t "$(newest_dump)"
  if grep -q 'rclone/rclone' "$LOCAL/docker-calls.log"; then
    echo "rclone ran with no backup settings"
    return 1
  fi
}

votes_order() {
  awk '/^COPY public\.votes / { on = 1; next } /^\\\.$/ { on = 0 } on { print $1 }'
}

hashes_order() {
  awk '/^COPY public\.hashes / { on = 1; next } /^\\\.$/ { on = 0 } on { print $1 }'
}

check_dump_is_mixed() {
  local dump votes
  dump="$(newest_dump)"
  votes="$(gzip -dc "$dump" | votes_order)"
  [ "$(echo "$votes" | wc -l | tr -d ' ')" -gt 30 ] || { echo "too few votes to tell"; return 1; }
  echo "$votes" | LC_ALL=C sort -c || { echo "votes aren't in id order"; return 1; }
  gzip -dc "$dump" | hashes_order | LC_ALL=C sort -c || { echo "hashes aren't in id order"; return 1; }
}

start_ping_listener() {
  rm -f "$LOCAL/ping-port" "$LOCAL/ping-hits"
  node -e '
    const fs = require("fs");
    const server = require("http").createServer((req, res) => {
      fs.appendFileSync(process.argv[1], "hit\n");
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(server.address().port)));
  ' "$LOCAL/ping-hits" "$LOCAL/ping-port" &
  PING_PID=$!
  local _
  for _ in $(seq 1 50); do
    [ ! -s "$LOCAL/ping-port" ] || return 0
    sleep 0.1
  done
  return 1
}

check_backup_encrypted() {
  local rc=0 stored name
  CRYPT_PASSWORD="$(openssl rand -hex 32)"
  CRYPT_PASSWORD2="$(openssl rand -hex 32)"
  start_ping_listener || { echo "no ping listener"; return 1; }
  {
    echo "BACKUP_REMOTE=backupstore:/store/dumps"
    echo "BACKUP_CRYPT_PASSWORD=$CRYPT_PASSWORD"
    echo "BACKUP_CRYPT_PASSWORD2=$CRYPT_PASSWORD2"
    echo "BACKUP_PING_URL=http://127.0.0.1:$(cat "$LOCAL/ping-port")/api/push/local-secret?status=up"
    echo "RCLONE_CONFIG_BACKUPSTORE_TYPE=local"
  } >> "$COPY/.env"
  # 15 old dumps, so the run also proves it keeps the newest 14.
  local i
  for i in $(seq 10 24); do
    printf 'old\n' | gzip > "$BACKUPS/hidetheslop-200001$i-000000.sql.gz"
  done
  sleep 1
  in_copy bash "$COPY/backup.sh" > "$LOCAL/backup.out" 2>&1 || { cat "$LOCAL/backup.out"; rc=1; }
  [ "$(dump_files | wc -l | tr -d ' ')" = 14 ] || { echo "local dumps: $(dump_files | wc -l)"; rc=1; }

  stored="$(find "$STORE" -type f | head -n 1)"
  [ -n "$stored" ] || { echo "nothing stored"; return 1; }
  [ "$(find "$STORE" -type f | wc -l | tr -d ' ')" = 1 ] || { echo "expected one stored file"; rc=1; }
  name="$(basename "$stored")"
  case "$name" in
    *hidetheslop* | *.sql* | *.gz) echo "the stored name shows what it is: $name"; rc=1 ;;
  esac
  if gzip -t "$stored" 2>/dev/null; then echo "the stored file is plain gzip"; rc=1; fi
  if LC_ALL=C grep -aq 'COPY public\|PostgreSQL database dump' "$stored"; then
    echo "the stored file is readable as SQL"
    rc=1
  fi
  [ "$(LC_ALL=C head -c 6 "$stored")" = RCLONE ] || { echo "not rclone crypt's format"; rc=1; }
  return "$rc"
}

check_ping() {
  [ -s "$LOCAL/ping-hits" ] || { echo "the monitor wasn't called"; return 1; }
}

# Nothing secret may reach a command line, where `ps` would show it, or the script's output.
check_no_secrets_exposed() {
  local rc=0 value
  for value in "$CRYPT_PASSWORD" "$CRYPT_PASSWORD2" local-secret; do
    if grep -qF -- "$value" "$LOCAL/docker-calls.log" "$LOCAL/backup.out"; then
      echo "${value:0:6}... was exposed"
      rc=1
    fi
  done
  if docker ps -a --format '{{.Command}}' | grep -qF -- "$CRYPT_PASSWORD"; then rc=1; fi
  [ -z "$(find "$SANDBOX_HOME" "$LOCAL/bin" -name '*.env' -o -name 'tmp.*')" ] || { echo "a settings file was left behind"; rc=1; }
  return "$rc"
}

counts_in() {
  psql_in "$1" 'select (select count(*) from hashes), (select count(*) from votes), (select count(*) from verdicts), (select count(*) from embeddings)'
}

check_restore() {
  local live_counts restored_counts live_seq restored_seq out target="hidetheslop_restored_$$"
  # What the dump holds, so a vote since then can't cause a false alarm.
  live_counts="$(counts_in hidetheslop)"
  live_seq="$(sql 'select last_value from verdict_seq')"
  out="$(in_copy bash "$COPY/restore.sh" "$target")" || { echo "$out"; return 1; }
  restored_counts="$(counts_in "$target")"
  [ "$live_counts" = "$restored_counts" ] || { echo "$live_counts became $restored_counts"; return 1; }
  restored_seq="$(psql_in "$target" 'select last_value from verdict_seq')"
  [ "$restored_seq" -ge "$((live_seq + 1000000))" ] || { echo "seq only reached $restored_seq"; return 1; }
  echo "$out" | grep -q 'verdict_seq moved' || { echo "restore.sh didn't say so"; return 1; }
  [ -z "$(find "$BACKUPS" -maxdepth 1 -name 'restore.*')" ] || { echo "the decrypted dump was left behind"; return 1; }
}

check_restore_refuses_live() {
  local before
  before="$(counts_in hidetheslop)"
  if in_copy bash "$COPY/restore.sh" hidetheslop 2>/dev/null; then
    echo "it restored over the live database"
    return 1
  fi
  [ "$(counts_in hidetheslop)" = "$before" ] || { echo "the live database changed"; return 1; }
}

upload_to_store() {
  local env_file
  env_file="$(mktemp)"
  . scripts/backup-rclone.sh
  write_rclone_env "$env_file" || return 1
  docker run --rm --env-file "$env_file" -v "$BACKUPS:/backups:ro" "$RCLONE_IMAGE" \
    copyto "/backups/$1" "backupcrypt:$1"
  local rc=$?
  rm -f "$env_file"
  return "$rc"
}

check_restore_refuses_cut_dump() {
  local name=hidetheslop-19990101-000000.sql.gz
  printf 'SELECT 1;\n' | gzip > "$BACKUPS/$name"
  in_copy upload_to_store "$name" || { echo "couldn't place the test dump"; return 1; }
  rm -f "$BACKUPS/$name"
  if in_copy bash "$COPY/restore.sh" hidetheslop_cut "$name" 2>/dev/null; then
    echo "it loaded a dump with no completion marker"
    return 1
  fi
  [ "$(sql "select count(*) from pg_database where datname = 'hidetheslop_cut'")" = 0 ] \
    || { echo "it created the database anyway"; return 1; }
}

check_failed_upload() {
  local hits newest_before
  newest_before="$(newest_dump)"
  hits="$(wc -l < "$LOCAL/ping-hits")"
  echo "BACKUP_REMOTE=nosuchremote:dumps" >> "$COPY/.env"
  sleep 1
  if in_copy bash "$COPY/backup.sh" 2>/dev/null; then
    echo "a failed upload exited 0"
    return 1
  fi
  [ "$(newest_dump)" != "$newest_before" ] || { echo "no new local dump"; return 1; }
  gzip -t "$(newest_dump)" || return 1
  [ "$(wc -l < "$LOCAL/ping-hits")" = "$hits" ] || { echo "the monitor was told it worked"; return 1; }
}

# --- Output ------------------------------------------------------------------------------

PASSED=0
FAILED=0

line() {
  local title="$1" out
  shift
  out="$(mktemp)"
  # Not in a subshell: checks share what they learn, such as ports and phashes.
  if "$@" > "$out" 2>&1; then
    PASSED=$((PASSED + 1))
    printf 'PASS  %s\n' "$title"
  else
    FAILED=$((FAILED + 1))
    printf 'FAIL  %s\n' "$title"
    sed 's/^/      /' "$out" | tail -n 25
  fi
  rm -f "$out"
}

cmd_check() {
  require_tools
  [ -n "$(compose ps -q api 2>/dev/null)" ] || { echo "Nothing's running. Run: $0 up" >&2; exit 1; }
  REAL_DOCKER_CONFIG="${DOCKER_CONFIG:-$HOME/.docker}"
  PUBLISHED=""
  PING_PID=""
  CRYPT_PASSWORD=""
  CRYPT_PASSWORD2=""
  trap '[ -z "$PING_PID" ] || kill "$PING_PID" 2>/dev/null || true' EXIT
  # An earlier check leaves the stack running from the throwaway copy, with Caddy's mounts in
  # there, where a new generated config wouldn't be seen.
  generate_caddyfile
  compose up -d --wait --wait-timeout 300 >/dev/null 2>&1
  read_ports
  wait_for_https

  line "generated Caddyfile differs from the real one only by local_certs" check_generated_caddyfile
  line "api, db and uptime healthy, caddy running" check_healthy
  line "the API's filesystem is read-only" check_read_only
  line "no host port on the API, the database or Uptime Kuma" check_no_host_ports
  line "Caddy's ports are only on 127.0.0.1" check_caddy_only_on_loopback
  line "migrations run the way deploy.sh runs them" check_migrations
  line "/health works through Caddy" check_health
  line "/ on the status host reaches Uptime Kuma" check_status_page
  line "5 votes with 5 tokens reach /v1/verdicts after the job, with the cache header" check_votes_reach_verdicts
  line "embedding gate: nothing at 2 votes, asked at 3, stored" check_embedding_gate
  line "an extra url field is rejected" check_extra_field
  line "64,000 bytes accepted, 64,001 refused" check_body_limit
  line "forged CF-Connecting-IP isn't believed from a non-Cloudflare address" check_forged_ip_ignored
  line "control: trusting the sender gives forged addresses separate limits" check_forged_ip_control
  line "logs hold no client IP, phash, token or path, through a 404 and a real 502" check_logs_clean
  line "control: with log default removed, the client IP does appear" check_logs_control
  line "data survives restarting the stack" check_data_survives
  line "votes' primary key starts with a random id" check_cluster_index
  line "deploy.sh deploys from a throwaway copy" check_deploy
  line "deploy.sh rolls back a build that dies at startup" check_rollback
  line "deploy.sh recovers from a rollback and applies a changed Caddyfile" check_caddyfile_deploy
  line "backup.sh with no settings dumps locally and uploads nothing" check_backup_plain
  line "CLUSTER: a dump keeps votes and hashes in id order, not arrival order" check_dump_is_mixed
  line "backup.sh encrypts: the stored name and file aren't readable, 14 kept locally" check_backup_encrypted
  line "backup.sh calls the monitor after a good run" check_ping
  line "no secret on a command line, in output or left on disk" check_no_secrets_exposed
  line "restore.sh round trip: row counts match, verdict_seq jumps, says so" check_restore
  line "restore.sh refuses the live database" check_restore_refuses_live
  line "restore.sh refuses a dump with no completion marker" check_restore_refuses_cut_dump
  line "a failed upload exits non-zero, keeps the local dump, skips the monitor" check_failed_upload

  echo
  echo "$PASSED passed, $FAILED failed"
  [ "$FAILED" = 0 ]
}

case "${1:-}" in
  up) cmd_up ;;
  check) cmd_check ;;
  down) cmd_down ;;
  *)
    echo "Usage: $0 up | check | down" >&2
    exit 1
    ;;
esac
