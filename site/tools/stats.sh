#!/usr/bin/env bash
# Prints hidetheslop.com's daily totals: page views (home, privacy) and install-button
# clicks (get-<browser>), newest day first.
#
# The token is the Worker's STATS_TOKEN secret. It's read from HIDETHESLOP_STATS_TOKEN and
# never taken as an argument or printed, so it stays out of shell history and the screen:
#   site/tools/stats.sh            (reads it from the Keychain on Kevin's Mac)
#   read -rs HIDETHESLOP_STATS_TOKEN && export HIDETHESLOP_STATS_TOKEN && site/tools/stats.sh
set -euo pipefail

# On Kevin's Mac the token lives in the Keychain, under the service "hidetheslop-stats".
if [[ -z "${HIDETHESLOP_STATS_TOKEN:-}" ]] && command -v security >/dev/null; then
  HIDETHESLOP_STATS_TOKEN=$(security find-generic-password -s hidetheslop-stats -w 2>/dev/null || true)
fi
if [[ -z "${HIDETHESLOP_STATS_TOKEN:-}" ]]; then
  echo "stats.sh: set HIDETHESLOP_STATS_TOKEN to the STATS_TOKEN secret first." >&2
  exit 1
fi

# The header goes to curl on stdin (-H @-), so the token never shows in the process list.
body=$(printf 'Authorization: Bearer %s\n' "$HIDETHESLOP_STATS_TOKEN" \
  | curl -sS --fail-with-body --max-time 20 -H @- https://hidetheslop.com/stats) || {
  echo "stats.sh: the request failed. A 404 means the token is wrong or not set on the Worker." >&2
  exit 1
}

printf '%s' "$body" | node -e '
  const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (!rows.length) { console.log("No totals yet."); process.exit(0); }
  console.log("day         name           count");
  for (const { day, name, count } of rows) console.log(`${day}  ${name.padEnd(13)}  ${String(count).padStart(5)}`);
'
