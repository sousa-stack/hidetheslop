# Crowd votes and the API

This is the design for sharing ratings between people. `api/` is the server. The extension doesn't talk to it yet: that's the next phase, and until it ships, the README's "nothing is sent to any other server" stays true.

The order of work is in [ROADMAP.md](ROADMAP.md). The build plan for the first version is in [plans/2026-10-30-local-api.md](plans/2026-10-30-local-api.md).

## What we promise

Hide the Slop stays free and open source, on every platform we can reach. Pooling ratings is what makes it better over time, and it has to happen without collecting personal data or browsing history.

- **Only explicit ratings are sent.** Pictures you scroll past send nothing. Sharing is off until you turn it on.
- **Checking a picture stays on your device.** The extension downloads a list of verdicts and matches locally. There is no per-image lookup, and there must never be one: it would hand the server a stream of what people look at.
- **No voter ID.** Nothing stored identifies a voter. Votes have no timestamp and rows have random ids, so the data itself doesn't say which votes came from one person. There's one limit on that, listed below.
- **Embeddings wait for a crowd.** The server asks for an embedding only after 3 or more installs have rated that exact picture, so a private photo one person rated never has its embedding sent.
- **Lone hashes expire.** A picture with fewer than 5 votes is deleted 90 days after it was first seen. Backups can hold it a few weeks longer.
- **The server is open source too**, in this repo.

What we can't claim is zero data:
- The server and Cloudflare see an IP address while a request is in transit, and a batch of votes arrives together. The API doesn't log IPs and keeps them in memory only for rate limiting.
- A rated picture's hash is stored.
- It's 3 installs rather than 3 people: someone with two browsers counts twice.
- The extension trusts the server when it asks for an embedding. The open source server is what backs that up.
- Someone with direct access to the live database can tell which votes arrived in the same request, because Postgres records each row's transaction (`xmin`) and rows sit in physical order. That groups a batch without saying who sent it. `pg_dump` backups drop `xmin`. The extension should keep batches small to limit this.

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

Rating the same picture again gives the same token, so the vote is replaced. Tokens for different pictures look unrelated.

## The perceptual hash (`hashVersion` 1)

The server treats a hash as 64 opaque bits. The extension will compute it this way: grayscale, 32 × 32, 2-D DCT, take the top-left 8 × 8 without the first coefficient, and threshold those 63 values at their median. In row order, the first value kept becomes bit 62 and the last becomes bit 0, so the top bit is always 0. It's sent as 16 lowercase hex digits.

Measured on the 57 pictures in `test-images/`:

| Change | Distance (out of 63 bits) |
|---|---|
| Resize and recompress | 2 at most |
| Trim 3% off each edge | 8–14 |
| Trim 8% off each edge | 18–26 |
| Different pictures | 16 or more, 32 typically |

One pair of near-identical files in `test-images/` was left out of that last row.

So hashes within **3 bits** count as the same picture. Reposts match; crops and screenshots won't. **Not tested yet:** two flyers from the same template, which might collide. Test this before the extension ships votes, because those flyers are already the main false positive.

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

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | `200 {status:'ok'}`, or `503` if the database can't be reached |
| `POST /v1/votes` | Up to 50 votes. `{hashVersion, votes: [{phash, token, label, source}]}` → `202 {accepted, needEmbedding: [phash]}` |
| `POST /v1/embeddings` | `{hashVersion, modelVersion, items: [{phash, token, vector}]}` → `202 {accepted}`. Stored only when that token voted on that hash, that exact hash has 3 or more votes, and the picture has no embedding yet. `vector` is 512 int8 values in base64, and the scale gets settled with the eval before votes ship. |
| `GET /v1/verdicts?since=<seq>&hashVersion=1` | `{seq, add: [phash], remove: [phash], more}`, up to 10,000 entries. Call again with the returned `seq` while `more` is true. Cached for an hour. |

Votes and embeddings are limited to 60 requests an hour per client, each with its own count, and verdicts to 120 a minute. `/health` has no limit.

Errors are `{error: <short code>}` and never repeat the input. A batch with two tokens for one phash gets a 400, because one request could otherwise confirm a picture. `accepted` counts votes after duplicates in the batch are removed. A `503` means the request raced the aggregate job and should be sent again.

`needEmbedding` lists hashes from this request that have 3 or more votes on that exact hash, and no embedding in the picture yet. Voters who rate later supply the embedding, so nobody has to be contacted again. Counting the exact hash means one person rating near-identical copies can't open the gate. A forged embedding can't be detected on the way in, so Kevin checks them, and removes duplicates, when retraining offline.

## What the extension needs to do (next phase)

- Add the hash to `SlopVision.inspect()`, so it comes from the same single download.
- Add `shareRatings` to `SLOP_DEFAULTS`, off by default, with a control in `options.html`. Explain it in plain words where it's turned on.
- Queue votes in `storage.local` and send them in batches from the background, so the timing doesn't follow your browsing.
- `learn()` knows the rating; `showAndAsk` is `source: 'rated'`, and the **Hide slop** button and right-click are `source: 'hid'`.
- Never send the rating's `key`, which contains the image URL. Skip `data:` video frames, because the hash changes with the frame.
- Firefox: change `data_collection_permissions` to declare the optional collection, probably `websiteContent`, and request it at runtime. Check Mozilla's docs and the policy dated December 1, 2026 first.
- Update the README's privacy section, the privacy policy and the store listings in the same release.
- Only people with the picture check on can rate today, because `learn()` needs the embedding. Verdicts for people without the model would mean downloading Facebook pictures again, which 1.5 stopped doing, so that comes later.

## Paying for it

Rough costs, from memory, so check them: $10–15 a month for the droplet and backups, about $1 for the domain, free Cloudflare, $5 once for Chrome, free for Firefox, and $99 a year for Apple if we ship on Safari or iPhone.

1. **Donations first.** GitHub Sponsors and Ko-fi, a small link in Settings, and a public "server costs this month" line on the site.
2. **Paid iPhone app later,** $2–5, with the source still open.
3. **Hosted moderator tools as a bonus:** a Discord bot or an API for group admins, built only when someone asks. Check them against store policy first, because the model learns from votes.

`api_keys` is deliberately not in the schema. Add it only when a paid API is real. When that happens, keys are random, so hash them with HMAC-SHA-256 and `API_KEY_PEPPER`, not argon2, which is too slow to run on every request.

## Going live (Kevin's checklist)

None of this is done, and all of it needs Kevin.

1. Create the droplet (Ubuntu 24.04) and run `harden.sh`. Confirm with `sudo sshd -T | grep -i passwordauthentication`, and test `ssh deploy@<ip>` from a new terminal before closing the old one.
2. Add a DigitalOcean Cloud Firewall allowing 80 and 443 from Cloudflare's ranges only. Docker's published ports skip ufw, so ufw alone doesn't protect them. Port 22 stays open, key-only with fail2ban, because GitHub's runners don't have fixed addresses.
3. Add a read-only deploy key for the private repo, and clone it to `~/hidetheslop`.
4. Copy `.env.example` to `.env` and fill it in. Use hex for the database password, because it goes into a URL.
5. Point `api.hidetheslop.com` and `status.hidetheslop.com` at the droplet in Cloudflare, with SSL set to Full (strict). Turn off "Always Use HTTPS" for these hosts until Caddy has its certificates. Add a Cache Rule so Cloudflare caches `/v1/verdicts`, because it doesn't cache JSON by default. Set the rule's Edge TTL to respect the origin's `Cache-Control`, and to bypass the cache when there isn't one. Only a successful response carries that header, so a 429 or 5xx is never cached. Don't use a fixed TTL.
   - **Don't add an AAAA record for the origin** until Caddy's `trusted_proxies` match has been tested over IPv6. If it doesn't match, Caddy won't believe `CF-Connecting-IP`, and clients behind one Cloudflare edge would share a rate limit.
6. Open `status.hidetheslop.com` straight away and create the Uptime Kuma admin. Whoever gets there first owns it.
7. Add the GitHub secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and `DEPLOY_HOST_FINGERPRINT`, and set the repo variable `DEPLOY_ENABLED=true`. A deploy fails if the fingerprint is empty, so host key checking can't be skipped by accident.
8. Turn on droplet backups, schedule `backup.sh` nightly, and choose where its dumps go off the machine. Note how long each kind of backup is kept, because the privacy policy has to say so.
