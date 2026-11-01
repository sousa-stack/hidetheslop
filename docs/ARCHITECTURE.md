# Architecture

## The pieces

| File | Runs in | Job |
|---|---|---|
| `common.js` | everywhere | `SLOP_API`, `SLOP_DEFAULTS` (every setting), `slopGetSettings()` |
| `content.js` + `content.css` | every page, every frame | finds AI content and hides it; the bars, the hover button, the right-click handling |
| `meta.js` | content script, background, offscreen | `SlopMeta.scan(bytes)`: AI markers in image metadata |
| `background.js` | Chrome service worker or Firefox background page | downloads, the classifier, ratings and retraining, badge counts, context menu |
| `train.js` | background, `eval/probe.mjs` | `SlopTrain`: the logistic-regression classifier (train and score) |
| `vision.js` | Firefox background page, Chrome `offscreen.html`, options page | `SlopVision`: downloads the CLIP model, turns a picture into a 512-number embedding |
| `offscreen.html` / `offscreen.js` | Chrome only | hosts `vision.js`, because a service worker can't run it |
| `ort/` | with `vision.js` | onnxruntime-web 1.31.1 (MIT), WebAssembly build |
| `popup.*` | toolbar popup | count hidden on this page, show all, pause on this site |
| `options.*` | settings page | every setting, model download, ratings |
| `welcome.*` | welcome page | opens once, on first install: picture check offer, site access, a demo of the Hide slop button |
| `poster.css` | popup, options and welcome pages | the shared poster look; `popup.css`, `options.css` and `welcome.css` add each page's own styles |
| `vision-weights.json` | background | the shipped classifier (written by `eval/probe.mjs --export`) |
| `vision-examples.json` | background | the shipped training embeddings, for retraining with your ratings |

## How something gets hidden

`content.js` runs a scan 250 ms after the page changes:

1. **Posts.** It looks for posts with `SITES[host].posts`, then reads each post's own text, skipping nested posts such as comments:
   - **The site's AI label**, exact text such as "AI content" or "AI info", from `LABEL`.
   - **A sponsored label**, when `hideSponsored` is on.
   - **AI hashtags or phrases**, from `HASHTAG_RE` and `PHRASE_RE`.
   - **Your blocklist** (the `keywords` setting).

   At most once a second it also searches the whole page for label text, so a post is caught even when its markup isn't one we know. In that case `postAround()` climbs from the label to the smallest box that holds a big picture.
2. **Pictures.** Every `img` and `video` is watched by an IntersectionObserver with a 1200 px margin. When one comes near the screen, `checkImage()` runs:
   - **An image you hid by hand before** (`blockedImages`) is hidden straight away.
   - **A video with no thumbnail:** `grabFrame()` draws its current frame to a canvas and sends that as a `data:` URL.
   - **Anything else** gets one `check` message to the background, saying whether it wants the metadata check (`meta`, for images ≥160 px) and the picture check (`picture`, for images ≥200 px that show at least 150 px on screen, when `visualCheck` is on).
3. **Hiding.** `hide()` adds a class that hides the post's children and prepends a bar in shadow DOM. A picture with no post around it gets blurred. With `mode: 'remove'` it's removed instead.

## The background's `check`

- **Picture check on:** `inspectUrl` downloads the picture **once** and returns both the metadata verdict and the embedding. `SlopTrain.score()` then scores the embedding with the current classifier. In Firefox, `vision.js` runs right there. Chrome creates `offscreen.html` and sends it an `inspect` message with `target: 'offscreen'`.
- **Picture check off, or the model failed:** `scanUrl` downloads only the first 512 KB and reads the metadata. Hosts that strip metadata (`STRIPS_METADATA`: fbcdn.net, cdninstagram.com) aren't downloaded at all for this.
- Results are cached per URL, at most 2 picture checks run at once, and every download is made without cookies.

## Messages

| From → to | `type` | Meaning |
|---|---|---|
| content → background | `check` `{url, meta, picture}` | → `{ meta, score }` or null |
| content → background | `learn` `{url, label: 'ai'│'real'}` | save a rating and retrain |
| content → background | `stats` `{count, reasons}` | per-frame hidden count, for the badge and popup |
| popup → background | `tabStats` `{tabId}` | totals for the popup |
| popup → content | `revealAll`, `whereAmI` | show everything / which host this tab is on |
| background → content | `menu` `{id: 'hide'│'block', srcUrl}` | right-click menu choice |
| background → offscreen | `inspect` `{url}`, with `target: 'offscreen'` | Chrome only |

## Storage

**`storage.sync`** holds the settings in `SLOP_DEFAULTS`: `enabled`, `labels`, `hashtags`, `scanImages`, `includeEdited`, `visualCheck`, `visualCutoff`, `hideSponsored`, `hoverButton`, `mode`, `keywords`, `disabledSites`. When any of these changes, content scripts show everything again and rescan.

**`storage.local`** holds:
- `blockedImages`: origin plus path of pictures hidden by hand, at most 1000.
- `visionRatings`: `{ ai: [{key, e}], real: [...] }`, where `e` is the 512-number embedding. At most 500 of each kind.
- `visionModel`: the classifier retrained from those ratings. If it's missing, `vision-weights.json` is used.

**Cache Storage `hidetheslop-model`** holds the CLIP model file, downloaded from a pinned Hugging Face revision and checked against its SHA-256 hash (`vision.js`).

## The picture classifier

- **Model:** CLIP ViT-B/32 image encoder, int8 ONNX, 89 MB. The `Xenova/clip-vit-base-patch32` revision is pinned in `vision.js`. It runs in a worker (`ort.env.wasm.proxy`), because Firefox never frees WebAssembly memory left in a stopped background page.
- **Preprocessing:** shortest side to 224, centre crop, CLIP normalisation. The result is a 512-number embedding, normalised to unit length.
- **Classifier:** logistic regression (`train.js`). Classes are weighted equally, and each of your ratings counts 3 times (`RATING_WEIGHT`).
- **Cutoffs:** your setting `visualCutoff` (default 0.7) for pictures, and at least 0.9 for video frames.
- **Why this approach:** ready-made AI-image detectors did badly on flyers, the main kind of slop here. See `eval/README.md`.
- **Retraining:** after each rating, the background retrains on the shipped examples plus your ratings, which takes about 0.2–0.4 seconds. A new version rebuilds your classifier from your ratings when it installs.

## The API

`api/` is a small server that pools ratings between people: Fastify, Drizzle and Postgres, behind Caddy and Cloudflare on one droplet. **The extension doesn't call it yet**, so everything above still runs entirely on your computer. The design, the privacy rules and what the extension will need are in [CROWD-API.md](CROWD-API.md).

| File | Job |
|---|---|
| `api/src/server.ts` | starts the app, runs the aggregate job on a timer and once soon after startup, shuts down cleanly on SIGTERM |
| `api/src/app.ts` | builds the Fastify app: logging without IPs, rate limits, the shared error handler, routes |
| `api/src/routes/` | `health`, `votes`, `embeddings`, `verdicts` |
| `api/src/db/schema.ts` | the tables; migrations are in `api/drizzle/` and `api/src/migrate.ts` applies them |
| `api/src/db/client.ts` | the database connection, and `failureCode()`, the only part of a failed query that's safe to log |
| `api/src/jobs/aggregate.ts` | the hourly job: merges near-duplicates, counts votes, publishes verdicts, expires lone hashes |
| `api/src/lib/phash.ts` | hashes are 16 hex digits on the wire and a signed bigint in Postgres |
| `api/src/config.ts`, `api/src/env.ts` | thresholds and limits; the environment, checked at startup |
| `docker-compose.yml`, `Caddyfile`, `deploy.sh`, `harden.sh`, `backup.sh` | production |
| `.github/workflows/deploy.yml` | tests the API on Node 26 and Postgres 18, then deploys |

**How the real client address reaches the rate limiter.** Cloudflare sets `CF-Connecting-IP`. Caddy believes it only from Cloudflare's ranges (`trusted_proxies`) and passes it on as `X-Forwarded-For`. The API then trusts exactly one hop, with the function `(_address, hop) => hop < 1`. Don't write that as `trustProxy: 1`: Fastify 5.12 treats a number as trusting nobody, so every client would share Caddy's address and one rate limit. The address stays in memory, for the rate limiter only.
