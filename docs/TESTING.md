# Testing

Run the quick checks after every change, and the real-browser checks after anything that touches how pages or pictures are handled. Every one of these has caught a real bug.

## Quick checks (seconds)

```bash
cd extension && node build.mjs && node --test test/meta.test.mjs
for f in src/*.js; do node --check "$f"; done
```

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
| `verdicts.test.ts` | paging, `add` and `remove`, the cache header, no rate-limit headers |
| `aggregate.test.ts` | verdict boundaries, weights, merging, `seq`, the lock, expiry |
| `schedule.test.ts` | the run soon after startup, the interval, and that 0 turns both off |
| `env.test.ts` | the aggregate interval's upper limit, and that errors don't repeat the database password |
| `privacy.test.ts` | no IP, phash, token or URL in logs on a 202, 400, 404, 413 or a real 500, the body limit, plus rate limits by client |
| `schema.test.ts` | no column named like an IP, URL, user, email or voter, and no date or time on `votes` |
| `health.test.ts` | 200, and 503 with a broken database, without leaking the error |

### The production files

- **Compose:** `docker compose -f docker-compose.yml --env-file .env.example config -q`. This needs the Compose plugin, and **Kevin's Mac doesn't have it**: it runs the Homebrew Docker CLI with Colima, so `docker compose` is an unknown command there.
- **Caddy:** `docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -e ACME_EMAIL=a@example.com caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.
- **The image:** `docker build -t hidetheslop-api:local api`, then run it with `--read-only --tmpfs /tmp` against a temporary `postgres:18-alpine`. Run `node dist/migrate.js` in it, and check `http://127.0.0.1:3000/health` with busybox `wget` inside the container.
- **No IPs in Caddy's logs:** take a copy of the `Caddyfile`, add a site that reverse-proxies to a dead port, send it a request, and check that the logs have no `client_ip`. Do the same with the `log default` block removed, which should log it, so you know the check works. Start Caddy with `--network none`, or the real sites will ask Let's Encrypt for certificates. On Colima, only your home folder can be bind-mounted, so use `docker create`, `docker cp` and `docker start` for a config kept anywhere else.

`deploy.sh`, `harden.sh` and `backup.sh` need a droplet, so here they only get `bash -n`. `deploy.sh` and `backup.sh` can also be run with a stub `docker` on the `PATH` and a throwaway git clone, which is enough to check their order and rollback.

## Fake feed: `extension/test/harness.html`

This page runs the real `content.js` on a fake Instagram-style feed, with the extension APIs faked. It has:
- a post with a label, one with a hashtag, one with metadata, one caught by the picture check, and one from a blocked account
- a sponsored post, a normal post, and a post that appears later
- a Facebook-style post with unknown markup, next to a normal one
- a video

Serve the top folder and open it:

```bash
python3 -m http.server 8767 --directory ~/Projects/hidetheslop
```

Open `http://localhost:8767/extension/test/harness.html` and read each post's `data-hidetheslop` state. The expected results:
- **Hidden:** label, hashtag, metadata, visual, keyword, fbpost, reel, late.
- **Visible:** sponsored (the setting is off), normal, fbnormal.

`window.learned` records rating messages.

## Real model in a browser: `eval/test-vision.html`

This runs the real `background.js` and `vision.js` with the real model and stubbed APIs. It needs `eval/models/` (`cd eval && npm install && ./get-models.sh`) and `eval/browser-check.json` (`node browser-check.mjs`). Open `http://localhost:8767/eval/test-vision.html` and wait about a minute for `window.result`. It checks:
- **Scores** match the Mac (`maxDiff` around 0.001, `flips: 0`).
- **Rating** a picture moves its score and switching the rating replaces it.
- **Downloads:** each picture is fetched once for both checks, and zero times on hosts that strip metadata.

## Settings page: `extension/test/options-preview.html`

This shows the real `options.html` with faked APIs and sample data, and always loads fresh CSS and JS. Add `?empty` to see a fresh install. Add `?page=welcome` or `?page=popup` for those pages. For the popup, `&unreached` shows a tab that needs a reload and `&blocked` shows a browser page. The model download is always faked here, and adding `&empty&fail` makes it fail. Use it for any design work, and check phone width with both pages. Hovering in a hidden in-app browser pane is unreliable, so check the welcome page's hover demo with the pane showing. Kevin reviews design changes there in the in-app browser pane. These pages ignore dark mode on purpose.

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
