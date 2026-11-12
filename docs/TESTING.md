# Testing

Run the quick checks after every change, and the real-browser checks after anything that touches how pages or pictures are handled. Every one of these has caught a real bug.

## Quick checks (seconds)

```bash
cd extension && node build.mjs && node --test test/meta.test.mjs test/download.test.mjs test/phash.test.mjs test/votes.test.mjs test/crowd.test.mjs
for f in src/*.js; do node --check "$f"; done
cd ../site && node build.mjs && node --test worker.test.mjs
```

`site/worker.test.mjs` runs Safari's origin check (`site/worker.js`) with Node's own `Request`: extension Origins of every scheme read as arrived, none or `null` as not, the value is never sent back, nothing is cached or logged, and every other path is the static site. To run the real Worker locally: `npx --offline wrangler@4.156.0 dev --local --ip 127.0.0.1 --port 8793`, adding `--compatibility-date` with the newest date the local runtime supports if it refuses, then `curl -H 'Origin: safari-web-extension://x' http://127.0.0.1:8793/.well-known/origin-check`.

## The API

The tests run against a real Postgres, never a mock. They wipe every table, so they refuse to run unless the database's name contains `test`. There are three ways to run them, and all of them apply the migrations first.

**On your Mac, against a throwaway Postgres.** This starts a temporary cluster with Homebrew's `postgresql@18` on port 54329 and deletes it afterwards:

```bash
cd api && npm ci && npm run typecheck && ./scripts/test-local.sh
```

**Against a Postgres you already have.** Set `TEST_DATABASE_URL` to a database whose name contains `test`, such as `hidetheslop_test`. It has to be one you don't mind losing, and it has to be Postgres 14 or newer for `bit_count`. `test-local.sh` uses it instead of starting a cluster.

**On the real versions, in Docker.** Kevin's Mac runs an older Node, so a pass above doesn't prove production works. This runs the same tests on `node:26-alpine` and `postgres:18-alpine`, with a temporary network that it always removes:

```bash
cd api && ./scripts/test-docker.sh
```

| File in `api/test/` | What it checks |
|---|---|
| `phash.test.ts` | hex and signed bigint round trips, including a top bit that's set |
| `votes.test.ts` | every rejection on `/v1/votes`, replacing a vote, and the embedding gate |
| `embeddings.test.ts` | when an embedding is stored or skipped, and canonical base64 |
| `verdicts.test.ts` | paging, `add` and `remove`, the cache header, no rate-limit headers, and that raising the threshold unpublishes through `remove` |
| `aggregate.test.ts` | verdict boundaries, weights, merging, `seq`, the lock, expiry, and that the vote threshold can move while expiry can't |
| `block.test.ts` | `block.js`: a block unpublishes, takes a new `seq` and goes out in `remove`; it reaches merged hashes and copies at exactly 6 bits spread over all four bands, and not at 7; unblocking republishes only what the votes still call AI; a block before any votes holds; the lock held throughout and released partway; `list`; what a hash and note must look like; and the real process exiting on its own without printing a value it was given, even on a database error |
| `schedule.test.ts` | the run soon after startup, the interval, and that 0 turns both off |
| `env.test.ts` | the aggregate interval's upper limit, the vote threshold's range, and that errors don't repeat the database password |
| `privacy.test.ts` | no IP, phash, token or URL in logs on a 202, 400, 404, 413 or a real 500, the body limit, plus rate limits by client |
| `schema.test.ts` | exactly the five tables, no column named like an IP, URL, user, email or voter, no date or time on `votes` or `blocked_hashes`, the indexes `backup.sh` clusters on starting with a random id, and `blocked_hashes`' columns and unique hash |
| `health.test.ts` | 200, and 503 with a broken database, without leaking the error |

### The production files

- **Compose:** `docker compose -f docker-compose.yml --env-file .env.example config -q`. Kevin's Mac has the Compose plugin from Homebrew, linked into `~/.docker/cli-plugins`. Don't add `cliPluginsExtraDirs` to `~/.docker/config.json` as Homebrew suggests.
- **Caddy:** `docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -e ACME_EMAIL=a@example.com caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.
- **The image:** `docker build -t hidetheslop-api:local api`, then run it with `--read-only --tmpfs /tmp` against a temporary `postgres:18-alpine`. Run `node dist/migrate.js` in it, and check `http://127.0.0.1:3000/health` with busybox `wget` inside the container.
- **No IPs in Caddy's logs:** take a copy of the `Caddyfile`, add a site that reverse-proxies to a dead port, send it a request, and check that the logs have no `client_ip`. Do the same with the `log default` block removed, which should log it, so you know the check works. Start Caddy with `--network none`, or the real sites will ask Let's Encrypt for certificates. On Colima, only your home folder can be bind-mounted, so use `docker create`, `docker cp` and `docker start` for a config kept anywhere else.

- **Caddy drops Origin:** run a copy of the generated local Caddyfile with `api:3000` swapped for a tiny Node server that echoes the headers it got, on its own Docker network, and send a POST and a GET with `Origin: safari-web-extension://x`. The echo must show no `origin`. Then delete the `header_up -Origin` line, reload, and see the Origin come back, so you know the check works.

`harden.sh` needs a droplet, so here it only gets `bash -n`. `deploy.sh`, `backup.sh` and `restore.sh` run for real in the next section.

### The whole stack on this Mac

```bash
scripts/local-stack.sh up      # builds and starts everything, migrating the way deploy.sh does
scripts/local-stack.sh check   # about 2 minutes, one PASS or FAIL line per check
scripts/local-stack.sh down    # removes the project's containers, volumes and .local/ files
```

This Mac is shared, so all of it stays in the Compose project `hidetheslop-local`, with Caddy on ports the system picks, bound to `127.0.0.1`. It runs the real `docker-compose.yml`, plus `docker-compose.local.yml` for those ports. The Caddyfile is generated from the real one, and `check` fails if it differs by more than a `local_certs` line. Passwords are random and live in `.local/`, which git ignores. Never run `docker system prune` or `docker image prune` here, or anything that stops other projects' containers.

`check` goes through Caddy with `curl --resolve`, and covers:
- Containers healthy, a read-only API, no host port on the API, database or Uptime Kuma, migrations, `/health`, and `/` on the status host, which must not be on Uptime Kuma's database setup page. There's no `/status` route. Caddy has no healthcheck, so it only counts as running.
- 5 votes with 5 tokens reaching `/v1/verdicts` with the cache header. Restarting the API triggers the job, 30 seconds later.
- `block.js` in the running container: `block` on that picture while another session holds the aggregate lock for 8 seconds, so it has to wait, then the `remove` in `/v1/verdicts`, `list`, `unblock` and the `add`. A block of a hash nobody voted on stays, so the restore below carries it, and a refused hash isn't echoed.
- The embedding gate at 2 and 3 votes, a rejected `url` field, and 64,000 bytes accepted against 64,001 refused.
- A forged `CF-Connecting-IP` not being believed. That passes even with `trusted_proxies` deleted, so a **control** reloads Caddy trusting the bridge subnet, where distinct forged addresses must get separate limits. The probes use `/v1/verdicts`, because votes allow only 60 an hour.
- No client IP, phash, token or path in the Caddy and API logs, through a 404 and a real 502 with the API stopped. The **control** removes `log default`, and the client IP must then appear. Lines from Caddy's `admin.api` logger are left out, because they're the script's own `caddy reload`.
- Data surviving `docker compose down` and `up`.

`deploy.sh` and `backup.sh` are never run in the real checkout: `deploy.sh` runs `git checkout`, its rollback would detach `main`, and `docker image prune` reaches every project on the machine. `check` makes a throwaway copy in `.local/copy`, with its own commit and bare origin, leaving `test-images/` out. A `docker` shim in `.local/bin` forces the project name, and turns `image prune` and `compose pull` into no-ops, so neither script gains a local mode. There, it proves:
- A deploy, a rollback from a build that dies at startup, and the next deploy, which also applies a changed Caddyfile.
- With no backup settings, a local dump and no rclone.
- `CLUSTER`: votes are out of id order before, and votes and hashes are in id order in the dump.
- An encrypted upload with rclone's local backend standing in for R2, behind the same `crypt` remote: the stored name and bytes aren't readable as a dump, and 14 local dumps are kept.
- The monitor ping, on a good run only, and no secret on a command line, in the output, or left on disk.
- `restore.sh`: a round trip with matching row counts, `blocked_hashes` included, and `verdict_seq` moved forward, refusing the live database, and refusing a dump with no completion marker.
- A failed upload exiting non-zero and keeping the local dump.

**What this can't prove:** Cloudflare in front, real certificates, real client IPs, the firewall, `compose pull`, a real Uptime Kuma push monitor, and the real bucket: the S3 backend, the token, the lifecycle rule and the lock. This Mac is arm64 and the droplet will be amd64: every image is published for amd64 and the API has no native modules, but nothing has run on amd64 yet.

## Fake feed: `extension/test/harness.html`

This page runs the real `content.js` on a fake Instagram-style feed, with the extension APIs faked. It has:
- a post with a label, one with a hashtag, one with metadata, one caught by the picture check, and one from a blocked account
- a sponsored post, a normal post, and a post that appears later
- a Facebook-style post with unknown markup, next to a normal one
- a video
- three posts for the crowd's list, matched by the real `crowd.js` and `phash.js`: one listed, one listed that you rated Not AI under another address, and one not listed. The list is the hashes of `shapes.png` and `crowd-mine.jpg`, worked out when the page loads. The two `crowd-*.jpg` pictures are drawn the same way `eval/vote-check.mjs` draws its own.

Serve the top folder and open it:

```bash
python3 -m http.server 8767 --directory ~/Projects/hidetheslop
```

Open `http://localhost:8767/extension/test/harness.html` and read each post's `data-hidetheslop` state. The expected results:
- **Hidden:** label, hashtag, metadata, visual, keyword, fbpost, reel, late, and crowd, whose bar says "the crowd flagged it" although its robot score is low.
- **Visible:** sponsored (the setting is off), normal, fbnormal, crowdmine (your Not AI wins) and crowdmiss.

After **Show**, crowd's bar asks whether it was AI and has **Report this**, a plain link; visual's has only the two answers. `window.reported` records the hash Report this sends, which must be `window.crowdHashes.listed`.

`window.learned` records rating messages as `[label, file, source]`. **AI, hide it** and **Not AI** must say `rated`, and the hover button `hid`. The hover button's shadow root is closed, so it needs a real mouse. A post hidden for its label or tags gets no **was this AI?** question.

## The vote client: `extension/test/votes.test.mjs`

This runs the real `votes.js` with fake storage and a fake network, so nothing reaches the API. It covers the token against a vector worked out with Python's `hmac`, off meaning off, the queue, every reply, races, near copies, and that nothing but the agreed fields goes in a body. The last two tests read `api/src/` and the build, and fail if the schema or the manifest moves.

Safari's tests use a manifest with `browser_specific_settings.safari` and a fake origin check: the rule is switched off and on, then a GET and a POST check it, once per run; an extension Origin, a bad or missing answer, or no access to either host sends nothing; and Chrome and Firefox never send the check or touch the rulesets.

## The crowd's list: `extension/test/crowd.test.mjs`

This runs the real `crowd.js` with fake storage, a fake network, fake alarms and a fake model cache. It covers paging with `more`, `add` and `remove`, the 7-day resync that replaces the set, every kind of bad page applying nothing, a `more` that doesn't move `seq`, the page cap, the 20,000 cap, a full store, the exact request options, the timeout, off in all three ways deleting the list and aborting a fetch, Firefox's rule check, the alarm and startup timing, band matching at 0 to 3 bits and not 4, your Not AI by address, by hash and from before 1.9.0, and forgetting it. The last few read `background.js`, `vision.js`, `content.js`, the build and `api/src/routes/verdicts.ts`, and fail if the wiring or the API's reply moves.

## Real model in a browser: `eval/test-vision.html`

This runs the real `background.js` and `vision.js` with the real model and stubbed APIs. It needs `eval/models/` (`cd eval && npm install && ./get-models.sh`) and `eval/browser-check.json` (`node browser-check.mjs`). Open `http://localhost:8767/eval/test-vision.html` and wait about a minute for `window.result`. It checks:
- **Scores** match the Mac: `flips: 0` is what counts. `maxDiff` can reach about 0.15, because the browser and the Mac resize pictures slightly differently, and scores in the middle of the range show that.
- **Rating** a picture moves its score and switching the rating replaces it.
- **Downloads:** each picture is fetched once for both checks, and zero times on hosts that strip metadata.
- **The hash:** `hash.match` must be true: a rating queues the same hash `SlopHash` gives on `shapes.png`, a drawn picture. `sd-burger.png` is flat, so it has no hash, and its rating must still save with nothing queued.

Firefox's `maxDiff` is larger, 0.27 on 2026-11-01. `flips: 0` still counts.

## What a vote really sends: `eval/vote-check.mjs`

This installs the real build in throwaway headless browsers and drives it against a local stand-in for the API, which checks each body against the strict schema. Run it after a build. It needs `eval/models/`, Playwright's Chrome for Testing in `~/Library/Caches/ms-playwright` (branded Chrome ignores `--load-extension`), and Firefox in `/Applications`. Neither touches your own profiles.

```bash
cd extension && node build.mjs && cd ../eval && node vote-check.mjs   # about a minute
node vote-check.mjs firefox                                            # just one
```

It never reaches the live API, because each browser gets a copy of `dist/` pointed at this machine. Firefox's copy keeps the real hostname over plain http on a random port, with a test pref resolving it to `127.0.0.1`, so the strip rule that runs is the one that ships. It uses real clicks for the switch and **Send now**, and a test pref answers Firefox's consent prompt, so the prompt itself still needs a person.

It prints a PASS or FAIL for: the first install, a rating with sharing off, the click-only consent in Firefox, a real rating through the offscreen or background path, **Send now**, the vote and embedding requests, turning off, and revoking consent. Then it prints each request as the server saw it, the hash of each drawn picture in each browser, which must match, and what a hash costs.

Measured on 2026-11-01, on Chrome for Testing 156 and Firefox 159. A browser's own headers will change over time, so check these when something changes. Chrome:

```
Host, Connection, Content-Length, Pragma: no-cache, Cache-Control: no-cache, User-Agent,
content-type: application/json, Accept: */*, Origin: chrome-extension://<id>,
Sec-Fetch-Site: none, Sec-Fetch-Mode: cors, Sec-Fetch-Dest: empty, Accept-Encoding, Accept-Language
```

Firefox, with no `Origin`, because `origin-rules.json` removed it:

```
Host, User-Agent, Accept, Accept-Language, Accept-Encoding, content-type: application/json,
Content-Length, Connection, Sec-Fetch-Dest: empty, Sec-Fetch-Mode: cors, Sec-Fetch-Site: same-origin,
Priority: u=4, Pragma: no-cache, Cache-Control: no-cache
```

Without the rule, Firefox sends `Origin: moz-extension://<uuid>`, which is unique to the install. That's why the Firefox build won't send unless the ruleset is on. Neither browser sends `Cookie` or `Referer`.

**Not covered here:** Firefox's real consent prompt, Firefox 140 to 158, https, and the live API. See "With Kevin" below.

### What a hash costs

The hash only runs for a rating being queued, and it reuses the picture from the HTTP cache: the file was downloaded once for the rating, with or without sharing. Medians of 5 runs, with extra memory as the peak of the browser's whole process tree over 5 runs, so treat that as rough.

| Picture | Chrome, offscreen | Firefox, background |
|---|---|---|
| 1 MP, a feed picture | 12 ms, 20–30 MB | 11 ms, 20–30 MB |
| 12 MP | 95 ms, 100–160 MB | 85 ms, 120–150 MB |
| 36 MP | 277 ms, 300–350 MB | 240 ms, about 500 MB |

Measured on one rating of a 1.2 MP picture, sharing added 32–36 ms on Chrome and 36–45 ms on Firefox, and the file wasn't downloaded a second time.

## The crowd's list in real browsers: `eval/crowd-check.mjs`

This borrows `vote-check.mjs`'s headless browsers, copies of `dist/` pointed at this machine, and drawn pictures, and serves a made-up list of 4 hashes in two pages. It needs the same things as `vote-check.mjs`.

```bash
cd extension && node build.mjs && cd ../eval && node crowd-check.mjs   # about two minutes
```

It fires the real `fetch-crowd` alarm rather than waiting, then checks: nothing fetched while your robot is off, the alarm moving within 30 minutes when it's turned on, both pages fetched and stored, the headers, a listed picture on a real page hidden by the real content script with "the crowd flagged it" through Chrome's offscreen page and Firefox's background page, an unlisted one and one you rated Not AI at another address left alone, no extra download, 12 MP hashed and over 12 MP skipped, and off deleting the list and stopping fetches. On Firefox a control turns the strip rule off: a POST then carries `Origin: moz-extension://<uuid>`.

It also clicks **Show** and then **Report this** on the listed picture, as a person would. Its copy of `background.js` records the address `tabs.update` is given in storage, which survives the background restarting, then lets the real call go ahead. The email must go to hello@hidetheslop.com with only a subject and a body, the body must be exactly the hash, the version and the browser, and the page must stay put. Last, `phash-of.mjs` on the same picture, in its own headless Chrome, must print the hash the extension worked out. 54 checks on 2026-11-12.

Measured on 2026-11-11, on Chrome for Testing 156 and Firefox 160. Chrome's list GET sends no `Origin`:

```
Host, Connection, User-Agent, Accept: */*, Sec-Fetch-Site: none, Sec-Fetch-Mode: cors,
Sec-Fetch-Dest: empty, Accept-Encoding, Accept-Language
```

Firefox's sends no `Origin` either, and didn't even with the strip rule off, so the rule is there for a later version that might:

```
Host, User-Agent, Accept: */*, Accept-Language, Accept-Encoding, Connection, Priority: u=4
```

Neither sends `Cookie`, `Referer` or a body.

What hashing every inspected picture adds to `inspect()`, medians of 5 after a warm-up, with the peak of the browser's whole process tree, which is rough. It isn't `about:processes`.

| Picture | Chrome, offscreen | Firefox, background |
|---|---|---|
| 1 MP | 264 → 274 ms, within the noise of 20–60 MB | 250 → 258 ms, 1 → 10 MB |
| 12 MP | 295 → 388 ms, 47 → 135 MB | 266 → 351 ms, 53 → 204 MB |
| over 12 MP | skipped: 297 → 294 ms | skipped: 266 → 268 ms |

### With Kevin

These can't run without a person or the live server. The policy has to be live first, so nothing sends before it says what's sent.

- Load the build in Chrome and Firefox on both laptops, turn on sharing, answer Firefox's prompt, rate a picture, press **Send now**, and confirm it reaches the live API.
- Check `about:addons` in Firefox shows the data permission, and that turning it off there turns sharing off.
- Rate one real AI picture from 5 installs, and confirm the aggregate job publishes it in `/v1/verdicts` within an hour.
- After real use, check Firefox's memory with `about:processes` or `about:memory`, not Activity Monitor, which hides compressed memory.
- With 1.9.0 and your robot on, in an install that never rated it: wait for the list (Settings counts it, within half an hour) and check the picture confirmed on 2026-11-11 is hidden on Facebook with "the crowd flagged it".

## The hash in real browsers: `eval/hash-check.html`

`extension/test/phash.test.mjs` proves the arithmetic. This proves browsers hand it the same pixels. It needs `cd eval && npm install` once for sharp, and ffmpeg for the APNG fixture. Everything it writes goes in `eval/hash-results/`, about 720 MB, which stays out of git because hashes of real people's posts are as private as the posts.

```bash
cd eval && node hash-check.mjs   # the first run makes every variant, about a minute
open -a "Google Chrome" http://127.0.0.1:8768/
open -a Firefox http://127.0.0.1:8768/
open -a Safari http://127.0.0.1:8768/
node hash-report.mjs             # any time, once the pages say Done
```

New pictures, such as flyers, need the server restarted, which makes their variants, then a run in each browser before the report sees them. The server only listens on 127.0.0.1. The variants are made once, offline, so every browser hashes identical bytes. Add `?run=2` for a second run, because `open` otherwise just goes to the tab that's already open. **Keep Safari in front on an unlocked Mac.** It suspends a page it isn't showing about 10 seconds in, and the page sits there with no error. Firefox carries on while locked, but takes 12 minutes instead of 1.

**A page isn't an extension**, so run it on an extension page too. Keep the server running, then:
- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → `eval/hash-results/extension`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `eval/hash-results/extension/manifest.json`.

The check opens in its own tab and says Done after about a minute. Remove the extension afterwards. `hash-check.mjs` rebuilds that folder from `eval/hash-ext/` and the real `phash.js` each time it starts, and it's never part of `dist/`.

`hash-report.mjs` prints the table in `CROWD-API.md`, the closest different pairs, the duplicates, browsers against each other, the whole matrix of browser A at one size against browser B at another, and `test-images/flyers/<template>/` when that exists. It ends with a PASS or FAIL for each of: browsers agree within 3 bits on one file, copies stay within 3 across the matrix, and different pictures stay over 3. Trims are known misses and don't count. Distances come in twos, because one value crossing the median pushes another back.

## Settings page: `extension/test/options-preview.html`

This shows the real `options.html` with faked APIs and sample data, and always loads fresh CSS and JS. Add `?empty` to see a fresh install. Add `?page=welcome` or `?page=popup` for those pages. For sharing, `?share` turns it on with 7 ratings waiting, `&stuck` is a server that keeps refusing them, `&nosend` is one that can't be reached, and `?firefox&refuse` is Firefox saying no when you click the switch. `&crowdoff` turns off the crowd's list, which otherwise shows 37 made-up pictures, and `&robotoff` turns your robot off. For the popup, `&unreached` shows a tab that needs a reload and `&blocked` shows a browser page. The model download is always faked here, and adding `&empty&fail` makes it fail. Use it for any design work, and check phone width with both pages. The website is in `site/`: run `node build.mjs` there and open `site/dist/index.html` from the same server. Hovering in a hidden in-app browser pane is unreliable, so check the welcome page's hover demo with the pane showing. Kevin reviews design changes there in the in-app browser pane. These pages ignore dark mode on purpose.

## Safari

Safari runs the same code as Firefox, so the tests above cover most of it. What only Safari can show needs Safari itself and Kevin's clicks, because an agent can't tick an extension on in Safari's settings or grant it site access.

- **Build and sign:** `cd safari && xcodebuild -project "Hide the Slop.xcodeproj" -scheme "Hide the Slop" -configuration Debug -derivedDataPath build CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="Apple Development" PROVISIONING_PROFILE_SPECIFIER= clean build`, with your team ID in `safari/Local.xcconfig`. Then `codesign --verify --deep --strict` on `build/Build/Products/Debug/Hide the Slop.app`, and check that the extension's `Contents/Resources` is identical to `extension/dist/safari`. Opening the app registers its extension with Safari; `pluginkit -r` on the `.appex` unregisters it.
  Always `clean build`: after a change to the JavaScript alone, an incremental build doesn't re-sign the extension, and `codesign --verify` fails.
- **Loading without Xcode:** Safari → Settings → Advanced → **Show features for web developers**, then Developer → **Allow unsigned extensions** and **Add Temporary Extension…**, and pick `extension/dist/safari`. Safari removes it when it quits, and the unsigned setting resets too.
- **The release gate** (`.local/safari-spike/gate/`, not in git, with Kevin's steps in `.local/safari-spike/PHASE2-STEPS.md`): `build-gate.sh` builds the real Xcode project around a copy of the real `dist/safari` with the API at `http://127.0.0.1:8791` and the origin check at `http://localhost:8791`, two hosts and two rules as in production, under the bundle ID `com.hidetheslop.gate`, so nothing it turns on reaches a real install. `gate-server.mjs` records every request to either host with its headers as they arrived, answers the origin check with the real `site/worker.js`, and serves the model, the spike's 224 score-check pictures and two drawn pictures. The probe reports what `slopIsSafari()` sees, site access, the ruleset after re-arming, a vote-shaped POST and a list-shaped GET sent past `allowed()` with and without site access, the real canary, the robot's scores (`flips: 0` is the bar), the real list download and a crowd match hiding on a page, a real vote, and what `openOptionsPage()` does. Nothing ships to anyone until a run shows no extension Origin from the canary or the real senders, including after a fresh start of the background.
- **Real Facebook,** last: per-site access, injection on a cold start, bars, the hover button, and memory after an hour, with Safari's Activity Monitor processes as in the spike.

## The installed extension in Kevin's real Chrome

Test in the Chrome profile Kevin uses for Facebook. Use the Claude in Chrome tools: call `switch_browser` so he can click Connect in the right window, then work only in a new tab group.

- **Installing** has to be done by Kevin. Chrome won't let an agent open `chrome://extensions` or the file picker. He goes to `chrome://extensions` → Developer mode → Load unpacked → `~/Projects/hidetheslop/extension/dist/chrome`. After a rebuild he presses the reload arrow on the card.
- **Controlled check: `extension/test/live.html`.** Serve the top folder on port 8767 and open `http://localhost:8767/extension/test/live.html` in his Chrome. It shows 8 AI and 8 real examples from `test-images/` plus the Stable Diffusion fixture.
  - The installed extension should hide all 9 AI ones and none of the real ones.
  - These are training images, so this shows the pipeline works, not how accurate it is.
  - The server log shows downloads: each picture should be requested twice, once by the page and once by the extension.
- **Facebook:** open facebook.com in the new tab, scroll with waits, then read the state from the page. Useful things to look at:
  - `document.querySelectorAll('[data-hidetheslop]')`, plus each one's `title` or the bar text inside its shadow root.
  - How many `div[data-virtualized]` there are, which should be one per feed item.
  - When a site seems broken, walk up the ancestors of a feed image and list their attributes, to find the current post markers.
- **Ratings are real data.** Don't click **Hide slop** or **AI, hide it** on real posts just to test, because that saves a wrong rating in Kevin's browser. Rating a real false positive as **Not AI** is fine.
- Read and scroll only. Never post, react, comment or change anything on his Facebook account. Close your tabs when you're done.
