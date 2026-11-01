# The perceptual hash and the local production stack

Roadmap steps 1 and 2 (items 17 and 20), up to the point where a droplet is needed. Written 2026-11-01. Kevin has approved the downloads below for this work.

Nothing here reaches users: the extension doesn't call the hash yet, so no version bump. Nobody commits, pushes or deploys until Kevin says so.

## Part A: the hash

`docs/CROWD-API.md` describes the hash, but no code for it is in the repo, and the spec doesn't fix the grayscale formula or the shrink to 32 × 32. Browsers shrink pictures differently, so two browsers could hash one picture more than 3 bits apart and its votes would never merge. Changing this after votes exist means a new `hashVersion` and splitting the data, so settle it now.

**`hashVersion` 1, exactly:**

1. Decode with `createImageBitmap(blob)` at natural size, the call `vision.js` already makes, so it can come from the same single download. EXIF orientation is applied.
2. Draw it 1:1 onto an `OffscreenCanvas` filled with white first, so transparency lands on white. Never let the browser scale it. Read with `getImageData`.
3. Pictures under 32 pixels on either side get no hash.
4. Grayscale each pixel as `0.299 R + 0.587 G + 0.114 B`, in doubles.
5. Shrink to 32 × 32 with an exact box filter in our own code, weighting partly covered source pixels by coverage. The aspect ratio is ignored.
6. 2-D DCT-II, in doubles, then take the top-left 8 × 8 without the first coefficient: 63 values.
7. The median is the 32nd of the 63 values when sorted. A bit is 1 when its value is above the median. In row order the first value kept is bit 62 and the last is bit 0, so the top bit is always 0. Sent as 16 lowercase hex digits.

**Code:**

- `extension/src/phash.js`: `var SlopHash`, no dependencies, with a pure function from RGBA pixels, width and height to hex, plus a thin function from a bitmap. Not wired into `inspect()` yet; that's step 3. Follow how `meta.js` is loaded by its tests, so the pure part runs in Node.
- `extension/test/phash.test.mjs`: fixed synthetic images with expected hex, bit order, top bit 0, the size limit, transparency on white, and that the output passes the API's phash format. Add it to the test commands in the docs and in `CLAUDE.md`.

**Measuring it in real browsers:**

- `eval/hash-check.html` runs the real `phash.js` over `test-images/`, in the same steps the extension will use, and posts results to a small dependency-free `eval/hash-check.mjs` server. The server also serves the page, the file and the pictures. Run it once per browser: Chrome, Firefox and Safari, opened with `open -a`.
- Results go in `eval/hash-results/`, which must be gitignored, because hashes of real people's posts stay private.
- Each browser also makes variants in the page: resize and recompress, and trim 3% and 8% off each edge.
- `eval/hash-report.mjs` prints:
  - the table in `CROWD-API.md` again, over all 205 pictures rather than 57, for comparison
  - the closest different pairs, with distances, using file names only
  - `test-images/duplicates/` as true reposts where an original can be identified
  - the distance between browsers for the same picture: the worst case, and how many are over 3 bits
  - `test-images/flyers/<template>/`, when present: distances within each template and how many are at or under 3. It must cope with the folder not existing yet.
- **Pass:** different pictures stay over 3 bits, reposts and recompressed copies stay within 3, and browsers agree within 3 on the same file.

**A page isn't an extension.** Results from a web page don't prove the same pixels in an extension's background or offscreen document, and canvas noise from anti-fingerprinting could differ there. Say so in the report, and check it in step 3 when the hash is wired in.

**Docs:** rewrite the hash section of `CROWD-API.md` to the exact spec, keep the old measurements only if the new ones confirm them, add the new numbers, and add the check to `TESTING.md`. Add a line to `CHANGELOG.md` under Unreleased.

## Part B: the production stack on this Mac

Not yet proven: `docker compose` has never started this stack.

**Downloads, approved:** `docker-compose` from Homebrew (about 31 MB), linked as a CLI plugin in `~/.docker/cli-plugins`, and `louislam/uptime-kuma:2` from Docker Hub (about 618 MB). The Docker build also fetches the API's npm packages, and `rclone/rclone` from Docker Hub is needed for backups.

**Shared machine.** This Mac runs other projects' containers, including Supabase. Touch only the `hidetheslop-local` project. No `docker system prune`, nothing that stops or removes other containers, no change to Colima or `~/.docker/config.json`.

**Local override, so the tested config is the real one:**

- `scripts/local-stack.sh` with `up`, `check` and `down`.
- It generates a local Caddyfile from the real `Caddyfile` by adding `tls internal` to each site, rather than keeping a second copy that can drift.
- `docker-compose.local.yml` replaces Caddy's ports with high host ports that aren't in use, and mounts the generated file.
- Generated files and a generated env with random hex passwords live in `.local/`, which must be gitignored.
- Use the project name `hidetheslop-local`. `down -v` is fine for this project only, and the script must name it explicitly.

**`check` proves, through Caddy with `curl --resolve`, where each line fails loudly:**

- All containers healthy, and the API's filesystem is read-only. Neither the database nor the API has a host port.
- Migrations run the way `deploy.sh` runs them.
- `/health` works, and `/status` reaches Uptime Kuma on the status host.
- 5 votes with 5 tokens lead, after the aggregate job runs, to the hash appearing in `/v1/verdicts` with the cache header.
- The embedding gate: nothing asked for at 2 votes, asked for at 3, and the embedding is stored.
- An extra field such as `url` is rejected, and a body over 64 KB is refused.
- A forged `CF-Connecting-IP` isn't believed from a non-Cloudflare address, so it can't dodge the rate limit.
- After all that, `docker logs` for Caddy and the API contain no client IP, phash, token or URL path with a hash in it. Include a real 502 by stopping the API.
- Data survives restarting the stack.

Also run `deploy.sh` and `backup.sh` against this project, using Compose's own env variables, so no script gains a local mode. Note anything that can't be covered.

What this can't prove: Cloudflare in front, real certificates, real client IPs, and the firewall. Those wait for the droplet.

## Part C: backups off the droplet

`backup.sh` keeps dumps only on the droplet. Kevin's choice is an encrypted copy in a private R2 bucket, kept 30 days.

- Extend `backup.sh`: when the backup settings are in `.env`, upload the dump after the existing local steps with `rclone/rclone` run through Docker, so no system package is added. Use an rclone `crypt` remote, so it's encrypted before it leaves the droplet.
- Pin the image version, and pass settings through environment variables, never the command line or logs.
- Delete remote dumps older than 30 days in the same run. Never delete local dumps because of an upload failure. A failed upload exits non-zero, after the local dump is safe.
- With no backup settings, it behaves exactly as today.
- Add the settings to `.env.example`.
- Add `restore.sh`: fetch the newest dump, decrypt it, and load it into a named database, refusing to touch the live one.
- **Prove it locally** with rclone's local backend behind the same `crypt` remote: dump, encrypt, confirm the stored file isn't readable as SQL, restore into a throwaway Postgres, compare row counts. The real R2 bucket and token wait for the droplet, and go in the going-live checklist, along with keeping the passphrase in a password manager, because losing it loses the backups.

## Part D: the vote threshold

`CONFIRM_MIN_VOTES` is a constant, so lowering it for a test means changing code.

- Add `CONFIRM_MIN_VOTES` to `env.ts`, an integer from 2 to 100, default 5, and pass it into the aggregate job.
- Pass it through `docker-compose.yml` with a default of 5, and add it to `.env.example` with a comment that it stays 5 outside testing.
- Log a single startup warning, with no other values, when it isn't 5.
- **Expiry stays at the promised 5.** Add a separate fixed constant, because "fewer than 5 votes is deleted after 90 days" is a public promise and mustn't move with a test setting.
- Tests: a lower threshold confirms and publishes; raising it again unpublishes through `remove`; expiry ignores it.
- Mention it in `CROWD-API.md`.

## Rules for whoever builds this

Read `CLAUDE.md` first. No commits, no pushes, no deploys, no `gh`. Never put pictures, hashes of them, or file contents from `test-images/` in tracked files. Comments explain why, in the voice of the existing code. Run the checks in `CLAUDE.md` and report real output, including what failed or wasn't covered.

## Changes after review (these override anything above)

A review on 2026-11-01 found these problems. Where this section and the parts above disagree, this section wins.

**Hash**

- `Math.cos` differs between browser engines in the last digit, and on flat flyers that noise decides bits. Hardcode the 8 × 32 cosine table as literals. Round each coefficient to 1e-6 before sorting. If the spread of the 63 values is too small, send no hash; pick the limit from measurement. State that rows are vertical frequency, in row-major order.
- A rank swap at the median flips 2 bits, not 1, so count that when reading results.
- Pass options explicitly: `createImageBitmap(blob, {imageOrientation:'from-image', premultiplyAlpha:'none', colorSpaceConversion:'default'})` and `getContext('2d', {colorSpace:'srgb', willReadFrequently:true})`. Include an EXIF orientation 6 fixture.
- No hash above 40 megapixels, checked on the bitmap's size. Read pixels in strips of about 1 megapixel, feeding the box filter as you go, and release canvases and bitmaps. A canvas over a browser's limit can silently go blank, and the flat-picture rule above catches that.
- No hash for animated GIF, animated WebP (`ANIM`) or APNG (`acTL`), detected from the file's bytes, because browsers don't promise the first frame.
- **The 3-bit limit is built into the schema:** four 16-bit bands only guarantee a shared band up to 3 flipped bits. So the real measurement is the worst distance across the whole matrix of browser A at size 1 against browser B at size 2, not each axis alone. If that doesn't fit in 3 bits, stop and report it; don't change the limit or the schema.
- Generate variants once, offline, and serve identical bytes to all three browsers: several filters, JPEG quality 30–90, 4:2:0 and 4:4:4, WebP, odd sizes, widths 160–2048. Use `sharp` if `eval/` has it, else any local tool. If nothing is installed, installing libvips or ImageMagick through Homebrew is approved. Keep the variants in `eval/hash-results/`. This replaces variants made in each browser's own encoder. The one exception is the trims, which are measured as known misses, and the report must say that site-made crops don't match.
- Bind the `hash-check.mjs` server to 127.0.0.1 only.
- Also build a tiny unpacked test extension, so the same check runs on an extension page in Chrome and Firefox. Don't ship it in `dist/`. Kevin loads it himself, so give him exact steps. The web-page results don't prove the extension case without it.

**Stack**

- **Don't run `deploy.sh` or `backup.sh` in the real checkout.** `deploy.sh` runs `git checkout` and `git pull`, and its rollback would detach HEAD on the `main` Kevin works in. `docker image prune -f` is daemon-wide and would touch other projects' images. Run both from a throwaway copy under `.local/`: `rsync` the working tree, `git init` it, commit inside the copy only, and give it a bare local origin. Put a `docker` shim first on `PATH` in `.local/bin` that forces `-p hidetheslop-local` and turns `image prune` into a no-op. No script gains a local mode.
- Compose appends `ports` lists, so use `ports: !override`, bound to `127.0.0.1` with ephemeral host ports, and read them back with `docker compose port`.
- Prefer one `local_certs` line in the global block over `tls internal` per site. Diff the generated Caddyfile against the real one and assert that's the only difference.
- A forged `CF-Connecting-IP` test passes even with `trusted_proxies` deleted, so add a positive control: a second generated Caddyfile that trusts the bridge subnet, where distinct forged IPs must get separate rate limits. Probe on `/v1/verdicts`, because votes allow only 60 an hour and a probe there would starve later checks.
- Trigger the aggregate job by sending votes, then `docker compose restart api`, which runs it after the 30-second boot delay.
- There's no `/status` route. Check `/` on the status host.
- Test the body limit at 64,000 against 64,001 bytes, with padded JSON.
- The no-IP log check needs the negative control in `TESTING.md`: with `log default` removed, the IP must appear.
- Caddy has no healthcheck, so it counts as "running".
- `docker compose build` may need the buildx plugin. Installing `docker-buildx` through Homebrew is approved if it does.
- The images already here are fine to use. This Mac is arm64 and the droplet will be amd64, so say what that leaves unproven.

**Backups**

- The droplet must not be able to delete its own backups. The script does no remote pruning. Retention is an R2 lifecycle rule of 30 days plus a bucket lock, and the droplet's token can write objects only. Both are Kevin's steps in the going-live checklist.
- `rclone`: `rclone obscure` the crypt password, set `password2`, set `no_check_bucket=true`. Pass secrets through a 0600 `--env-file`, never `-e KEY=value`, which shows in `ps` and `docker inspect`.
- Add an optional Uptime Kuma push URL, pinged on success, so a missed night is noticed.
- COPY writes rows in physical order, so a dump keeps each batch of votes together, which `CROWD-API.md` doesn't admit. Run `CLUSTER votes USING votes_pkey` before each dump, if the primary key really does start with a random id. Check that first, and report it if not. Update the limits list in `CROWD-API.md`.
- Restoring an old dump rewinds `verdict_seq`, and clients with a higher cursor would never see new verdicts. `restore.sh` must `setval` it well past the old maximum, and must say so.
- `restore.sh` uses `psql -v ON_ERROR_STOP=1 --single-transaction`, checks the dump's completion marker, and refuses a target equal to `$POSTGRES_DB`.
- Write the real retention figures in the docs: 14 nights local, 30 days on R2, plus droplet backups. R2 must be named in the privacy policy when it's next updated, so add that to the roadmap's list for step 3.

**Threshold**

- `aggregate.test.ts` calls `runAggregate(db)` and `updateVerdicts(db)` about 30 times, so make the threshold an optional parameter that defaults to config.
