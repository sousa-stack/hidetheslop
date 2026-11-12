# The verdict block list

Roadmap item 24. Written 2026-11-12. Today a forged verdict, a real picture pushed onto the crowd's list by fake votes, hides that picture for every install, and the only way to pull it is deleting votes from the database by hand, which `CLAUDE.md` says needs Kevin's OK every time and which the aggregate job would undo if the votes came back. This has to exist before strangers can vote.

Nobody commits, pushes or deploys until Kevin says so. The privacy rules in `CLAUDE.md` and the promises in `docs/CROWD-API.md` hold throughout.

## What it does

Kevin can block a picture by its hash. A blocked picture is never published, whatever its votes say, and if it was already published, the next aggregate run takes it off the list with a `remove`, so every install stops hiding it within about an hour, plus the list's 1-hour cache and each install's 6-hour fetch. Unblocking puts it back to whatever the votes say.

## How Kevin blocks something: a command, not an endpoint

- No new public route and no admin route. An admin endpoint needs a secret, and then that secret is something to leak or brute-force, on a server whose whole pitch is having little to attack.
- Instead, a small CLI in the API image, run on the droplet: `docker compose exec api node dist/block.js block <phash> [--note "..."]`, `unblock <phash>`, and `list`. It goes through the same Drizzle code as everything else, so it isn't hand-editing the database.
- `block` also runs the aggregate job straight away, so the `remove` goes out at once, not at the next hourly run.
- Add `block`, `unblock` and `list` to the "Fine without asking" or "Never without Kevin's OK" lists in `CLAUDE.md`. The recommendation: listing is fine without asking, and blocking and unblocking need Kevin's OK, because they change what every install hides.

## The data

- A migration adds `blocked_hashes`: a random UUID id, `hash_version`, `phash` (bigint), the four 16-bit band columns like `hashes`, and a short optional `note` for Kevin's own record. No timestamps, IPs or anything about who reported it, in keeping with the API rules. Migrations only add things.
- A block covers every stored hash within **6 bits** of the blocked one, wider than the 3 bits used to merge, because blocking errs on the side of not hiding: a slightly different copy of a real picture should stay unhidden too. Use the bands for the lookup, as the merge step does. The reviewer should check whether 6 bits needs more than the four 16-bit bands to find every match, and what 6 bits costs in false blocks, given different pictures measured 12 bits apart or more.
- In `updateVerdicts`, `published` becomes false when the root, or any hash merged into it, is within 6 bits of a blocked hash. The status, label and counts still follow the votes, so Kevin can see what the crowd said. When `published` flips, `seq` moves on as it does today, which is what makes `/v1/verdicts` send the `remove`.
- Blocking a hash nobody has voted on yet still works, so a picture can be blocked before it's ever published.

## Finding the hash to block

A report says "this real picture got hidden by the crowd". Kevin needs that picture's hash, and the server never stores URLs or pictures, so the report has to carry it:

- When a picture is hidden by the crowd and you press **Show**, the bar's **Not AI** answer already counts as a real vote. Add a third link on that bar only, **Report this**, which opens your email app, like Settings' **Email a report**, with the picture's 16-digit fingerprint and the version filled in, and nothing else: no URL, no page. You choose whether to send it.
- For a picture Kevin has himself, `eval/phash-of.mjs <file>` prints its hash with the real `phash.js` decode steps run through a headless browser, as `eval/hash-check` does, so it matches what the extension computes.
- `list` on the server shows blocked hashes, with how close each is to anything published.

## Tests

- API tests on a real Postgres:
  - blocking a published picture flips `published`, takes a new `seq`, and appears in `remove`
  - blocking reaches merged hashes and copies within 6 bits, and not at 7
  - unblocking republishes only if the votes still say `ai`
  - a block before any votes holds
  - the CLI never logs a value it's given
  - the schema test still finds no IP, URL, user or time column
- The extension: the **Report this** link appears only on crowd-hidden pictures, and its email holds the hash and version and nothing else.
- `scripts/local-stack.sh check` gains a block and unblock round trip.
- On the droplet, after Kevin's OK, block and then unblock the one live verdict, and watch `/v1/verdicts` send the `remove` and then the `add`.

## Docs

`docs/CROWD-API.md` (how a verdict is reached, the known gap now closed, the runbook for blocking), `CLAUDE.md` (the commands, and whether they need Kevin's OK), `docs/TESTING.md`, `CHANGELOG.md`, and the privacy policy, if **Report this** changes anything about what can be sent, which it shouldn't, because you send it yourself.

## Not in this

Automatic moderation, any public block or report endpoint, any reporter identity, and rate-limit changes.

## Changes after review (these override anything above)

A review on 2026-11-12 found these problems. Where this section and the parts above disagree, this section wins.

**Scan, don't use bands.** Four 16-bit bands only guarantee a shared band up to 3 flipped bits. At 6, the flips can land in all four bands (2+2+1+1), and a copy would never be blocked. The blocked list is tiny, so check it directly in `updateVerdicts` with an `exists` over the root and its members, using `bit_count((m.phash # b.phash)::bit(64)) <= BLOCK_MAX_BITS` with matching `hash_version`, and set `published = (label is not distinct from 'ai') and not blocked`.
- `BLOCK_MAX_BITS = 6` goes in `config.ts`.
- `blocked_hashes` has no band columns, and does have `unique(hash_version, phash)`. `block` is idempotent with `on conflict do nothing`.
- Add a test at exactly 6 bits, with the flips spread over all four bands, and one at 7 that isn't blocked.
- Why 6 is safe: distances come in twos, copies measured up to 4 bits apart, flyers from one template 8 or more, and different pictures 12 or more.

**The CLI must not claim a `remove` it didn't send.** `runAggregate` returns false when the hourly job holds the lock, and a run that started before the block was committed can't see it. So `block` and `unblock` retry `runAggregate` for about 60 seconds, and if it still can't run, print "saved; it takes effect at the next run" rather than claiming it's done.

**Checking what the CLI is given:**
- The hash must be exactly 16 lowercase hex digits with the top bit 0. Anything else is rejected.
- `note` is at most 80 characters, and anything containing `://` or `http` is refused, because the server never stores URLs.
- Never echo an argument in an error. Note in the runbook that hashes typed on the droplet land in shell history, which is low risk.
- Import only `env.ts`, `db/client.ts` and `jobs/aggregate.ts`, never `server.ts` or `app.ts`. Close the client at the end, or the process hangs. Check `dist/block.js` is built. Run it with `docker compose exec -T api node dist/block.js …`.

**Rules:** in `CLAUDE.md`, `list` goes under "Fine without asking", and `block` and `unblock` under "Never without Kevin's explicit OK", because they change what every install hides, and `unblock` deletes a row. The runbook says the votes stay after a block, so unblocking a forgery republishes it, which means unblocking is rarely right.

**The extension's Report this:**
- `check()` returns `phash` only when `crowd` is true. `content.js` keeps it per element in a `WeakMap`, only if `hide()` actually ran, using the flagged image's own hash rather than `biggestPicture`.
- `addBar` gets a plain `link` kind, neither red nor green.
- The link sends a message to the background, which opens the `mailto:`, so Facebook's page can't intercept it. The email body is the 16 hex digits plus the version and browser, the same pattern as Settings' **Email a report**.
- **Accepted limits:** no **Report this** for a lone picture blurred in place, which has only the hover **Show**; or in **Remove it completely** mode; or with the robot off. Kevin can still get the hash from a file with `eval/phash-of.mjs`.

**The privacy policy changes:** **Report this** emails the picture's fingerprint, together with your own email address, to hello@hidetheslop.com, only when you press send. Reports are deleted after they've been acted on. Nothing about this goes through the API, so "no per-image lookup" still holds.

**Backups:** `pg_dump` includes `blocked_hashes`, so blocks survive a restore.
