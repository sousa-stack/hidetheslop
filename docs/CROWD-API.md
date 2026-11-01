# Crowd votes and the API

This is the design for sharing ratings between people. `api/` is the server, and `extension/src/votes.js` is the client, from 1.8.0. It's off until you turn it on. Kevin wants this tested on the droplet with real data before the extension goes public in any store.

The order of work is in [ROADMAP.md](ROADMAP.md). The build plan for the first version is in [plans/2026-10-30-local-api.md](plans/2026-10-30-local-api.md).

## What we promise

Hide the Slop stays free and open source, on every platform we can reach. Pooling ratings is what makes it better over time, and it has to happen without collecting personal data or browsing history.

- **Only explicit ratings are sent.** Pictures you scroll past send nothing. Sharing is off until you turn it on.
- **Checking a picture stays on your device.** The extension downloads a list of verdicts and matches locally. There is no per-image lookup, and there must never be one: it would hand the server a stream of what people look at.
- **No voter ID.** Nothing stored identifies a voter. Votes have no timestamp and rows have random ids, so the data itself doesn't say which votes came from one person. There's one limit on that, listed below.
- **Embeddings wait for a crowd.** The server asks for an embedding only after 3 or more installs have rated that exact picture, so a private photo one person rated never has its embedding sent.
- **Lone hashes expire.** A picture with fewer than 5 votes is deleted 90 days after it was first seen. Backups can hold it about a month longer: 14 nights on the droplet, 30 days encrypted in Cloudflare R2, plus DigitalOcean's droplet backups.
- **The server is open source too**, in this repo.

What we can't claim is zero data:
- The server and Cloudflare see an IP address while a request is in transit, and a batch of votes arrives together. The API doesn't log IPs and keeps them in memory only for rate limiting.
- A rated picture's hash is stored.
- It's 3 installs rather than 3 people: someone with two browsers counts twice.
- The extension trusts the server when it asks for an embedding. The open source server is what backs that up.
- A browser sends its usual `User-Agent` and `Accept-Language` on every request. The API doesn't store them.
- The rule against one install casting several votes on near copies lives in the client (below), so it covers honest use, not a hostile client.
- Someone with direct access to the live database can tell which votes arrived in the same request, because Postgres records each row's transaction (`xmin`) and new rows sit in physical order. That groups a batch without saying who sent it. `pg_dump` drops `xmin`, but it writes rows in physical order, so `backup.sh` first runs `CLUSTER` on each table, on its random id. A dump then doesn't keep batches together, apart from rows that arrive between that step and the dump. If `CLUSTER` fails the dump still happens, in arrival order, and the run reports a failure. `CLUSTER` keeps `xmin`, so none of this helps on the live database, and droplet backups are disk images, which keep `xmin` and the order. The extension should keep batches small to limit this.

The privacy policy has to say the parts that matter to people, plainly.

## Why it's built this way

| Decision | Why |
|---|---|
| A downloaded list, not lookups | Lookups would reveal browsing. A list is also cached by Cloudflare, so cost barely grows with users. |
| Votes carry a hash; embeddings come separately | `retrain()` needs the 512-number CLIP embedding. A pHash can match a repost but can't train anything. |
| Per-image tokens, not a voter ID | Stops double voting on one picture without linking a person's votes together. The IDs are random and votes have no timestamp, for the same reason. |
| Publish only `ai` verdicts at first | People promoting their own AI flyers will vote `real`. `real` votes still feed training. |
| No dataset sales | Chrome Web Store [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) bans selling user data to third parties, and covers aggregated, anonymized and derived data. |

**The cost of dropping voter IDs:** no reputation and no account age, so a determined attacker has an easier time. Rate limits, the 5-voter threshold, `ai`-only publishing and the Show bar are the defenses. If abuse appears, add small proof-of-work to each vote before adding any identity.

## The vote token

The extension makes a random secret once and keeps it in `storage.local`, never in `storage.sync`. For each vote:

```
token = first 16 bytes of HMAC-SHA-256(secret, "hts-vote-v1:" + hashVersion + ":" + phash)
```

Rating the same picture again gives the same token, so the vote is replaced. Tokens for different pictures look unrelated. Turning sharing off and forgetting your ratings both leave the secret alone, because a new secret would turn a re-rating into a second vote.

**Near copies.** `vote_count` counts tokens across merged hashes, so one install rating copies 1 to 3 bits apart would cast several votes, and could confirm a picture alone. The extension keeps a list of the hashes it has sent (`voteSent`, at most 5,000), and when a new hash is within 3 bits of one of them or of one waiting in the queue, it votes on the earlier hash with the earlier token, which replaces that vote. The server can't check this, so it covers honest use, not a hostile client.

## The perceptual hash (`hashVersion` 1)

The server treats a hash as 64 opaque bits. The extension computes it in `extension/src/phash.js`, only at rating time and only with sharing on. Browsers scale pictures differently, so they only decode, and every later step is the extension's own arithmetic. Changing any step once votes exist means a new `hashVersion` and splitting the data.

1. Decode with `createImageBitmap(blob, {imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default'})` at natural size, so EXIF orientation is applied.
2. Draw it 1:1 onto a white `OffscreenCanvas` from `getContext('2d', {colorSpace: 'srgb', willReadFrequently: true})`, so transparency lands on white. Read it with `getImageData` in strips of about 1 megapixel, and never let the browser scale it.
3. Grayscale each pixel as `0.299 R + 0.587 G + 0.114 B`, in doubles.
4. Shrink to 32 × 32 with an exact box filter, weighting partly covered source pixels by coverage. The aspect ratio is ignored.
5. Take the 2-D DCT-II without scale factors, using a literal table of 8 × 32 cosines, because `Math.cos` differs between engines in the last digit. Keep the top-left 8 × 8 without the first coefficient: 63 values in row-major order, where rows are vertical frequency. Round each to 1e-6.
6. The median is the 32nd of the 63 when sorted. A bit is 1 when its value is above the median. The first value kept becomes bit 62 and the last bit 0, so the top bit is always 0. It's sent as 16 lowercase hex digits.

**No hash** for a picture under 32 pixels on either side, over 40 megapixels, an animated GIF, WebP or APNG (browsers don't promise the first frame), a file that won't decode, or a flat picture, where the largest and smallest of the 63 values are under 1000 apart. Noise on a flat page measured under 40 and the flattest real picture about 6800. A canvas over a browser's limit can go blank without saying so, and that comes out as flat too.

Hashes within **3 bits** count as the same picture. Each hash has 31 ones, so when one value crosses the median another crosses back, and distances come in twos: 3 bits really means one swap. The limit is built into the schema too, because four 16-bit bands only promise a shared band up to 3 flipped bits.

Measured on 2026-11-01 with `eval/hash-check.html`, on 3,781 identical files: 221 pictures, 14 copies and 2 trims of each, and 24 made-up fixtures. It ran in Chrome 156 and Firefox 159 as a web page, on extension pages in clean headless profiles of both, and in WebKit 26.5 in a plain `WKWebView`. Copies are every mix of filter, JPEG quality 30–90, 4:2:0 and 4:4:4, WebP, odd sizes and widths from 160 to 2048. Each row is the same in every browser, except that one more recompressed copy goes over 3 bits in WebKit.

| Change, on the 205 pictures in `ai/` and `real/` | Distance (out of 63 bits) |
|---|---|
| Resize and recompress | 0–4, 3 of 2,870 over 3 bits |
| Trim 3% off each edge | 0–16, typically 8, 9 of 205 within 3 |
| Trim 8% off each edge | 6–30, typically 18 |
| Different pictures | 12–46, typically 32 |
| Different pictures, any copy against any copy | 12 at the closest, 0 of 20,910 pairs within 3 |
| One file, browser against browser | Chrome and Firefox 0; Safari 2 at most, on 58 of 3,315 files |
| The 16 files in `duplicates/`, against their originals | 0 (9 are byte-identical) |

An earlier table from 57 pictures said 2 at most, 8–14, 18–26 and 16 or more. None of those held over all 205.

**The whole matrix doesn't fit in 3 bits.** Browser A at one size against browser B at another is the number that matters, and across those 885,105 pairs the worst is 4 bits. 1,904 pairs (0.22%) are over the limit, on 8 of the 221 pictures, always at 4 and never more. Copies of those 8 can split into two pictures, so their votes wouldn't merge. They're all pictures with a low spread, and the smallest copies are the ones most often involved. The limit and the schema are unchanged, and this is an open decision for Kevin.

Reposts mostly match. Crops and screenshots mostly won't: a site's own crop isn't a repost, even though a few 3% trims landed within 3 bits. **Flyers from one template** were tested on 2026-11-01: 23 flyers from 4 templates, in Chrome only, 3 AI series and 1 human-made. No flyer got a false match from layout alone. Across templates the closest pair is 16 bits, and within a template, flyers with different artwork are 8 bits at the closest. Same artwork does merge: a repost at 0 bits, the same art with a new date at 2, and the same photo on a different background color at 2, because the hash is grayscale. That's the behavior to want, because a verdict says whether the picture is AI, and a date change doesn't alter that. The case this can get wrong is the same artwork with AI and human versions, which didn't appear here. It's a small sample with one human template, so keep testing as more arrive.

## How a verdict is reached

The aggregate job runs hourly inside the API, and once 30 seconds after startup, because the hourly timer starts over on every deploy. It takes a Postgres advisory lock, so only one copy runs at a time.

1. **Merge near-duplicates.** Each new hash joins the oldest root hash within 3 bits, by setting `canonicalId`. Roots never chain. Four 16-bit bands make this fast: hashes within 3 bits must share at least one band.
2. **Count votes** across each picture, meaning a root and the hashes merged into it. A `rated` vote weighs 1, a `hid` vote 0.5, because "Hide slop" may only mean you don't like the post.
3. **Set the verdict:**
   - Fewer than 5 votes: `pending`.
   - 5 or more, and one side has at least 80% of the weight: `confirmed`, with that label.
   - 5 or more otherwise: `disputed`.
4. **Publish.** `published` is true only for `confirmed` + `ai`. When it flips, the verdict takes the next `seq`, so clients can fetch just what changed.
5. **Expire.** Delete pictures with fewer than 5 votes whose root was first seen more than 90 days ago, including their merged hashes.

These numbers live in `api/src/config.ts` and are starting points. They'll need tuning once real votes arrive.

The 5 votes needed to confirm can be changed for a small test, without changing code: set `CONFIRM_MIN_VOTES` in `.env`, from 2 to 100. It stays 5 outside testing, and the API logs a warning at startup when it isn't. Raising it again takes back what the lower number published, through `remove`. Expiry doesn't move with it, because "fewer than 5 votes is deleted after 90 days" is a public promise, so a picture confirmed on 3 test votes is still deleted at 90 days, and clients aren't told.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | `200 {status:'ok'}`, or `503` if the database can't be reached |
| `POST /v1/votes` | Up to 50 votes. `{hashVersion, votes: [{phash, token, label, source}]}` → `202 {accepted, needEmbedding: [phash]}` |
| `POST /v1/embeddings` | `{hashVersion, modelVersion, items: [{phash, token, vector}]}` → `202 {accepted}`. Stored only when that token voted on that hash, that exact hash has 3 or more votes, and the picture has no embedding yet. `vector` is 512 int8 values in base64, at scale 127 (below). |
| `GET /v1/verdicts?since=<seq>&hashVersion=1` | `{seq, add: [phash], remove: [phash], more}`, up to 10,000 entries. Call again with the returned `seq` while `more` is true. Cached for an hour. |

Votes and embeddings are limited to 60 requests an hour per client, each with its own count, and verdicts to 120 a minute. `/health` has no limit.

Errors are `{error: <short code>}` and never repeat the input. A batch with two tokens for one phash gets a 400, because one request could otherwise confirm a picture. `accepted` counts votes after duplicates in the batch are removed. A `503` means the request raced the aggregate job and should be sent again.

`needEmbedding` lists hashes from this request that have 3 or more votes on that exact hash, and no embedding in the picture yet. Voters who rate later supply the embedding, so nobody has to be contacted again. Counting the exact hash means one person rating near-identical copies can't open the gate. A forged embedding can't be detected on the way in, so Kevin checks them, and removes duplicates, when retraining offline.

## The embedding scale

`vector` is each of the 512 numbers times **127**, rounded, and clamped to ±127. To use one, divide by the scale and normalize to unit length again. A unit vector can't reach the clamp at this scale.

Measured on 2026-11-01 with `eval/quantize.mjs`: leave-one-out on the 224 shipped embeddings at a 70% cutoff, against the full numbers (AUC 0.9771, 83 of 93 caught, 8 of 131 wrongly flagged). The values go up to 0.73, and are typically about 0.02.

| Scale | AUC | Caught | Wrong | Scores flipped | Mean change | Worst change | Clamped | Lowest cosine |
|---|---|---|---|---|---|---|---|---|
| **127** | 0.9773 | 82 | 8 | 1 | 0.0049 | 0.069 | 0 of 114,688 | 0.99855 |
| 256 | 0.9764 | 82 | 8 | 1 | 0.0070 | 0.102 | 96 | 0.98142 |
| 512 | 0.9797 | 82 | 8 | 3 | 0.0168 | 0.189 | 212 | 0.89059 |

The AUC differences are noise. A bigger scale keeps more detail in the small values, but it clamps the one large value most of these vectors have, which costs more than that gains.

## What the extension does

- **What's sent.** Only with `shareRatings` on, and only for a rating made while it was on: `POST /v1/votes`, and `POST /v1/embeddings` for hashes the server named in `needEmbedding`, one try each. Requests use `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`, a 15-second timeout, and no headers of its own beyond `content-type`, which the API needs to parse the body.
- **When.** A vote waits in `voteQueue` for a random 1 to 6 hours. An hourly alarm sends up to 5 that are due, shuffled. **Send now** in Settings ignores the wait, but not the 5. Rating a picture again replaces its waiting entry.
- **The hash.** `SlopVision.hash(url)` fetches the picture again from the HTTP cache, in the offscreen document on Chrome and the background page on Firefox. It only runs for a rating that's about to be queued, because it decodes at full size. Verdict matching (step 5) still has to decide how it gets hashes.
- **Skipped:** video frames, because the hash changes with the frame; private windows; and a rating whose picture has no hash. The rating itself still saves.
- **Replies.** `202` counts only if it parses as `{accepted, needEmbedding: string[]}`. A hash in `needEmbedding` that wasn't in the batch is ignored. `400` and `413` split the batch and resend, and an item is dropped only when it's alone and the reply is a JSON `{error}`. After 3 batches in a row are refused, sending stops, nothing more is dropped, and Settings says "Couldn't send, try updating the extension". **Send now** still tries once, and an update or a good reply clears it. Anything else, including `3xx`, `401`, `403`, `404`, `408`, `429`, `5xx` and network errors, keeps everything for the next alarm.
- **Off means off.** The sender rereads the setting before every fetch. Turning it off aborts what's in flight and clears the queue. Forgetting your ratings clears the queue too.
- **The queue can't lose a race.** Every change to `voteQueue`, and creating `voteSecret`, goes through one promise chain, never held across the network. Entries carry a number that changes when they're replaced, so a `202` can't remove a re-rating made while it was in the air.
- **Firefox.** The optional `websiteContent` collection in `data_collection_permissions` is requested from the click that turns sharing on. Revoking it turns sharing off and clears the queue, and the next start catches a revoke made while the background was asleep. Below Firefox 140, or 142 on Android, Mozilla's built-in consent doesn't exist, so those are now the minimum versions. The sender also checks site access for the API, which Firefox lets you withhold, because the API has no CORS.
- **Firefox's per-install address.** Firefox puts `Origin: moz-extension://<uuid>` on an extension's POST, and that UUID is random per install, which would be a voter ID on every vote. `origin-rules.json` removes the header for `api.hidetheslop.com`, and the sender won't send on Firefox unless that ruleset is on. Chrome's `chrome-extension://<id>` is the same for everyone on a store build, so it stays. The exact headers each browser sends are in `docs/TESTING.md`.

Only people with the picture check on can rate today, because `learn()` needs the embedding. Verdicts for people without the model would mean downloading Facebook pictures again, which 1.5 stopped doing, so that comes later.

## If it takes off

The extension does its work on people's own computers, so more users barely touch the server. Only three things travel over the network, and each is sized for a surge:

- **The model (89 MB, once per person who turns on the picture check).** Never serve it from the droplet. 1,000 downloads a day is about 2.7 TB a month, which on a droplet costs about $17–21 a month and competes with the API for bandwidth. On Cloudflare R2 the same traffic should be free: no egress fees, and 30,000 reads is well inside the 10 million free each month. The file is live at `models.hidetheslop.com`, with Hugging Face as the fallback, which publishes no bandwidth cap for it. Its limit of 3,000 requests per IP every 5 minutes is far above this use.
- **The verdict list.** Cloudflare caches it, so a surge in users mostly doesn't reach the droplet. This depends on the Cache Rule in the going-live checklist.
- **Votes.** Only explicit ratings, in small batches, and rate limited per IP. This is the one thing that does reach the droplet, and it's tiny.

**If the droplet falls over, hiding keeps working.** Picture checks and every other detector run locally, so people only lose new votes and list updates. The extension must fail quietly and retry later. Droplet overage is $0.01 per GiB, so a traffic spike can't produce a shocking bill.

Prices checked on 2026-11-01: [R2](https://developers.cloudflare.com/r2/pricing/), [Droplets](https://docs.digitalocean.com/products/droplets/details/pricing/), [Hugging Face limits](https://huggingface.co/docs/hub/rate-limits), [Pages](https://developers.cloudflare.com/pages/platform/limits/).

## Paying for it

Rough costs, from memory, so check them: $10–15 a month for the droplet and backups, about $1 for the domain, free Cloudflare, $5 once for Chrome and free for Firefox. Kevin already has an Apple developer account for Safari.

1. **Donations first.** GitHub Sponsors and Ko-fi, a small link in Settings, and a public "server costs this month" line on the site.
2. **Maybe a paid iPhone app,** $2–5, with the source still open. Kevin hasn't decided.
3. **Hosted moderator tools as a bonus:** a Discord bot or an API for group admins, built only when someone asks. Check them against store policy first, because the model learns from votes.

`api_keys` is deliberately not in the schema. Add it only when a paid API is real. When that happens, keys are random, so hash them with HMAC-SHA-256 and `API_KEY_PEPPER`, not argon2, which is too slow to run on every request.

## Going live (Kevin's checklist)

Everything except steps 7 and 15 was done on 2026-11-01, and the API is live. Most of it needs Kevin, because it creates accounts, tokens or access.

1. Create the droplet (Ubuntu 26.04, the 2 GB Premium AMD plan) and run `harden.sh`. Confirm with `sudo sshd -T | grep -i passwordauthentication`, and test `ssh deploy@<ip>` from a new terminal before closing the old one.
2. Add a DigitalOcean Cloud Firewall allowing 80 and 443 from Cloudflare's ranges only. Docker's published ports skip ufw, so ufw alone doesn't protect them. Port 22 stays open, key-only with fail2ban, because GitHub's runners don't have fixed addresses.
3. Add a read-only deploy key for the private repo, and clone it to `~/hidetheslop`.
4. Copy `.env.example` to `.env` and fill it in. Use hex for the database password, because it goes into a URL.
5. Point `api.hidetheslop.com` and `status.hidetheslop.com` at the droplet in Cloudflare, with SSL set to Full (strict). Turn off "Always Use HTTPS" for these hosts until Caddy has its certificates. Add a Cache Rule so Cloudflare caches `/v1/verdicts`, because it doesn't cache JSON by default. Set the rule's Edge TTL to respect the origin's `Cache-Control`, and to bypass the cache when there isn't one. Only a successful response carries that header, so a 429 or 5xx is never cached. Also set Browser TTL to respect the origin, or Cloudflare's 4-hour default replaces the API's 1 hour for browsers. Don't use a fixed TTL.
   - **Don't add an AAAA record for the origin** until Caddy's `trusted_proxies` match has been tested over IPv6. If it doesn't match, Caddy won't believe `CF-Connecting-IP`, and clients behind one Cloudflare edge would share a rate limit.
6. Open `status.hidetheslop.com` straight away and create the Uptime Kuma admin. Whoever gets there first owns it. Its first-run database page is skipped, because `docker-compose.yml` sets SQLite.
7. Add the GitHub secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and `DEPLOY_HOST_FINGERPRINT`, and set the repo variable `DEPLOY_ENABLED=true`. A deploy fails if the fingerprint is empty, so host key checking can't be skipped by accident.
8. Turn on droplet backups. Note how long they're kept, because the privacy policy has to say so.
9. Create a private R2 bucket named `hidetheslop-backups`. Give it no public access: no custom domain and no `r2.dev` URL.
10. Add a lifecycle rule to that bucket that deletes objects after 30 days. `backup.sh` deletes nothing there on purpose, so this rule is the only retention.
11. Add a bucket lock rule to the whole bucket for 30 days. This is what stops the droplet destroying its own backups: a lock blocks deletes and overwrites, and it also holds back the lifecycle rule until it ends.
12. Create an R2 API token with **Object Read & Write**, for this one bucket only. R2 has no write-only level, so this token can read and try to delete, and the lock from step 11 is what refuses the delete. Never give the droplet an Admin token, because that could remove the lock.
13. Run `openssl rand -hex 32` twice, for `BACKUP_CRYPT_PASSWORD` and `BACKUP_CRYPT_PASSWORD2`. **Put both in your password manager before anything else.** Losing them loses the backups, because nothing else can decrypt them.
14. Fill in the backup block of `.env` on the droplet: `BACKUP_REMOTE=backupstore:hidetheslop-backups/dumps`, both passwords, the bucket's endpoint, and the token's key and secret.
15. In Uptime Kuma, add a **Push** monitor with a heartbeat of about 25 hours. Put its push URL in `BACKUP_PING_URL`, so a missed night raises an alarm.
16. Run `~/hidetheslop/backup.sh` by hand. It should exit 0, and one object with a scrambled name should appear in the bucket. Then try to delete that object with the token, which must fail. The first run also downloads the rclone image (about 35 MB).
17. Run `~/hidetheslop/restore.sh hidetheslop_check` and compare its row counts with the live database. Dropping `hidetheslop_check` afterwards is a manual `DROP`, which is yours to do.
18. Schedule it nightly as `deploy`, with `crontab -e`: `15 3 * * * $HOME/hidetheslop/backup.sh >> $HOME/backup.log 2>&1`.

**To recover,** on a new droplet if need be: set up steps 1 to 4 with the same `.env`, run `deploy.sh`, then `./restore.sh hidetheslop_restored`. It refuses the live database, so a slip can't overwrite it. It also moves `verdict_seq` 1,000,000 past the dump, because an old dump rewinds it and clients holding a higher cursor would otherwise never see a new verdict. Check the row counts it prints, stop the API, swap the two databases with `ALTER DATABASE ... RENAME TO`, and start the API. Votes since that dump are gone, and clients keep any verdict from that gap until it's published again.
