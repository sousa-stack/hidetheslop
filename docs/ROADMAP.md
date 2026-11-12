# Roadmap

The goal is a polished public launch on Chrome, Firefox, Edge and Safari, with a site at **hidetheslop.com** (Kevin owns the domain). The repo stays private until launch, then goes public as a portfolio piece.

Hide the Slop stays free and open source, on every platform we can reach. It should pay for its own server, and a little on top is a bonus. Pooled ratings are how it gets better, and that has to happen without collecting personal data or browsing history. The design is in [CROWD-API.md](CROWD-API.md).

## Where things stand

Updated 2026-11-01. Start here.

**Live:**
- [hidetheslop.com](https://hidetheslop.com) and its privacy policy, on Cloudflare Workers. The install buttons say "coming soon".
- The model at `models.hidetheslop.com`, on Cloudflare R2, with Hugging Face as the fallback.
- `hello@hidetheslop.com`, forwarding to Kevin's Gmail. Tested.
- The API at `api.hidetheslop.com` and the status page at `status.hidetheslop.com`, on the droplet behind Cloudflare. Checked live: direct access is blocked, input rules and rate limits work, verdicts are cached, and no client IPs are in the logs. It holds Kevin's test votes and its first published verdict.

**Built, not live:**
- The extension, version 1.9.0: voting, off by default, and hiding pictures the crowd flagged, on by default. Not in any store. Tested for real on 2026-11-11: votes from Chrome, Firefox, Arc and second profiles, Firefox's own consent prompt, an embedding sent once a picture reached 3 installs, and one AI picture reaching 5 installs, confirmed and published in `/v1/verdicts` through Cloudflare. All five installs gave that picture the identical hash.
- Deploys from GitHub, which stay off until the secrets are added.
- The production stack, proven on this Mac by `scripts/local-stack.sh`: 30 checks through the real Compose file and a Caddyfile generated from the real one, including `deploy.sh` rollback and an encrypted backup and restore.
- Safari on the Mac, version 1.10.0, built on 2026-11-11 from `docs/plans/2026-11-11-safari.md`: a `safari` build target, the Mac app in `safari/` (builds and signs with Kevin's Apple Development identity), the origin check on the website, and Caddy dropping `Origin`. The website route and the Caddyfile aren't deployed. Waiting on the release gate in a real Safari, with Kevin's clicks (`.local/safari-spike/PHASE2-STEPS.md`), then real Facebook.
- Verdict downloads, version 1.9.0, built on 2026-11-11 and tested in headless Chrome and Firefox against a local list (`eval/crowd-check.mjs`). Never loaded by Kevin, and never run against the live list.

**Never run for real:**
- The workflow's deploy job. Its test job passes on GitHub.
- Restoring a backup with real rows in it. Backups run nightly to R2 and the lock is proven, but every restore so far has been of an empty database.
- The hash on a Chrome offscreen page or a Firefox background page. It has passed on web pages in Chrome, Firefox and Safari, and on extension pages in Kevin's Chrome and Firefox.
- Clicking "Turn it on" on a real install, which would be the first real download from the model mirror.
- A true first install opening the welcome page, and the update rebuild of a person's classifier.
- Sticky buttons on a real phone, and Firefox versions older than 159.

## Order of work

**Kevin's decision, 2026-11-01:** shared ratings get tested on the droplet with real data **before** the extension goes public in any store. An unlisted listing doesn't count, because nobody can find it without the link. This replaces the earlier plan of starting the droplet just before launch. It means paying for the server before there are users, and in exchange the server, voting and verdicts are proven first.

1. **Same-template test (item 17).** First pass done: 23 flyers from 4 templates gave no false match from layout, so the hash design stands. Details are in CROWD-API.md. Keep adding flyers to `test-images/flyers/<template>/`, especially human-made ones, because they also feed item 1.
2. **The droplet (item 20).** The stack is proven locally, so follow the going-live checklist in CROWD-API.md.
3. **Voting in the extension (item 18).** Build it and test it on Kevin's two laptops with a manual install, because every store update can wait days for review. Once it works there, submit unlisted to Chrome and Firefox, to prove the real install and update path and start the review early. See "Installing before launch". Update the privacy policy and the Firefox data permission first, and turn on no sharing for anyone before the policy says what's sent. The policy must also name Cloudflare R2 as where encrypted backups are kept, and say how long: 14 nights on the droplet, 30 days in R2, plus droplet backups.
4. **Test with real data.** Kevin votes on real feeds from two laptops with different accounts. Confirm votes arrive, the aggregate job runs, verdicts publish, and the rules in the promises section of CROWD-API.md hold on the live server: no IPs in logs, lone hashes expire. Restore a backup to prove it works, and load-test the votes route.
5. **Verdict downloads (item 19).** Done in 1.9.0. On 2026-11-11 a fresh Chrome profile that never rated the confirmed picture downloaded the list and hid it on Facebook.
6. **Safari (item 23).** Built as 1.10.0 on the background page with the proxy worker, Firefox's path. Proven in Safari 27.2: scores match the Mac, Safari's extension Origin is stripped once site access is granted (checked by a canary first), the crowd list hides and votes send. On real Facebook it hides about as fast as Chrome. Still to do: deploy the site's `origin-check` route and the Caddyfile backstop, a real Safari vote, and getting it to testers. The details are in `docs/plans/2026-11-11-safari.md`.
7. **The launch list below,** then the "Going public" list, then the store listings.

**Open questions for Kevin:**
- Settled on 2026-11-11: the Safari app is free on the Mac, as `com.hidetheslop.app`, with the team ID kept out of git and Safari 27.2 as the minimum.

**Votes during testing:** the threshold counts installs, not people. Two laptops with Chrome and Firefox, plus a second Chrome profile on one of them, make 5 installs, so it can stay at 5. `CONFIRM_MIN_VOTES` can lower it if that gets tedious, with a warning in the logs, and no verdicts are seeded. This proves the pipeline, not how good the crowd's judgment is.

## Installing before launch

Kevin wants installing to be one click and updates to be automatic, because people won't load an unpacked build. His two laptops use a manual install while voting is built, then unlisted listings once it works. Going public later means switching the same listing to Public. Each store has a way to do this without a public listing. Checked against the stores' docs on 2026-11-01; none of it has been tried yet.

| Browser | How | Worth knowing |
|---|---|---|
| Chrome | Web Store, **Unlisted** | Anyone with the link installs it, it's out of search, and new versions reach people on their own. It gets the full review, which can take days or weeks for a new developer, so submit early. Check the one-time fee on the sign-up page. |
| Firefox | **Unlisted** add-on signed by Mozilla | Link to an `.xpi` we host, sent as `application/x-xpinstall`, with `update_url` in the manifest for updates. Signing is automatic, up to 24 hours. |
| Edge | Add-ons, **Hidden** | Shared by link, and updates keep arriving. Certification can take up to 7 business days. |
| Safari | **TestFlight** for Mac | Builds expire after 90 days, and external testers need beta review. Apple's docs don't cover a Safari extension specifically, so treat it as likely but unproven. |

A build that sends votes needs the updated privacy policy first, because the stores review what it says.

## Done

- Real Chrome tested on Kevin's live Facebook feed (1.4, 1.5). The picture check, whole-post hiding, video frames, Show → rate, and the hover button all work there.
- Speed is fine: the page-wide label search takes about 1 ms on Facebook.
- One download per picture. Hosts that strip metadata aren't downloaded just for the metadata check.
- Stable onnxruntime-web 1.31.1 instead of a dev build.
- The logo, credited in `brand/README.md`, plus an MIT license and README.
- The poster redesign of the welcome, Settings and popup pages (1.6).
- The Firefox memory leak fix (1.5.1), confirmed by Kevin in Firefox and Chrome.
- Retraining on 205 unique pictures, with less overconfident scores (1.7), then on 224 (1.7.3).
- The website, privacy policy, model hosting and project email.

## Before launch: must do

1. **More training examples.** This is the biggest risk to people's first impression.
   - **Current set:** 93 AI and 131 real unique images, trained in 1.7.3. Mostly from one feed and area. Keep duplicates out: they inflate the numbers, and `test-images/duplicates/` holds the ones moved aside.
   - **Gaps:** human-made flyers and promo graphics (still the main false positives), AI edits of real photos, realistic AI food, and video frames.
   - **Target:** 200 or more of each kind, but human-made flyers come first. In a test on 2026-11-01, 1.7.2 hid 17 of 18 AI flyers it hadn't trained on, and also 3 of 5 human-made ones, so more AI flyers add little.
   - **How:** ratings exported from Settings → `cd eval && node probe.mjs --with <file> --export`, or image files dropped in `test-images/`. Report the new leave-one-out numbers. Early testers can do this with **Save to a file**, which exports only embeddings, because few pictures will reach 3 raters while there are few users.
2. **Retest in Firefox.** Kevin confirmed 1.5.1 there, but later versions changed the model download and the welcome page. Test with `about:debugging`, then `test/live.html`.
   - **Memory:** the 12 GB leak Kevin saw in Firefox's WebExtensions process was ours, and 1.5.1 fixes it. He confirmed it in real use in Firefox and Chrome on 2026-10-31. It's untested on Firefox versions older than 159, and the extension's minimum is 128.
3. **Host the model ourselves.** The file is on Cloudflare R2 in the `hidetheslop-models` bucket, and 1.7.2 tries it first, then Hugging Face. Both are checked by the same SHA-256 hash, and `models.hidetheslop.com` is connected. Done. Don't serve it from the droplet. The numbers are in CROWD-API.md under "If it takes off".
4. **Privacy policy page.** Live at [hidetheslop.com/privacy](https://hidetheslop.com/privacy), and linked from the welcome and Settings pages. It describes the extension as it is today. Update it before any build sends votes, so it says exactly what CROWD-API.md says gets sent, including that the server and Cloudflare see an IP address in transit.

## Before launch: should do

5. **Welcome page on install.** Done in 1.6.0. It still needs a check that it opens on a real first install in Chrome and Firefox. When shared ratings ship, add them here as an opt-in.
6. **Popup redesign.** Done in 1.6.0. Still to add: a "report a broken site" link, once the repo is public and has an issues page.
7. **Replace `window.prompt`** in "Always hide posts from this account…" with an in-page dialog styled like the rest.
8. **Hover button on unknown layouts:** it hides only the picture when it can't find the post around it.
9. **Untested on real Facebook:**
   - clicking the hover button (it should collapse the post, not open the photo viewer)
   - "Ad" and scrambled "Sponsored" detection (Kevin has that setting off)
   - profile pages with the new post markup
10. **Split `content.js`** (about 700 lines) into site rules, hiding UI, the hover button and the picture check, so the repo reads well.
11. **CI:** GitHub Actions running the tests, the build and `web-ext lint`, plus one `npm test` at the top.
12. **GitHub polish:** a demo GIF at the top of the README, and issue templates for "site broken" and "wrong call".
13. **Releases:** tag each version and attach both zips.
14. **Store listings:** five 1280 × 800 screenshots, Chrome's 440 × 280 promo tile, and a written reason for "read all sites". Keep Facebook branding out of screenshots.
15. **Name check:** search both stores and the trademark database for "Hide the Slop".

## Going public

The repo's history becomes public along with its files. An audit on 2026-10-31 found no secrets and no real pictures in the history, using pattern searches, not a dedicated scanner. Do these around launch:

- **Run a secret scanner** such as gitleaks over the full history.
- **Add `SECURITY.md`,** saying how to report a problem, because a public API needs one.
- **Say in the README and `eval/README.md`** that the accuracy numbers can't be reproduced from a clone, because `test-images/` stays private.
- **Decide about the commit email.** Every commit shows Kevin's Gmail, and history also has a Chrome profile name, a mention of his employer and local paths that are now gone from the current files. Rewriting history can replace all of that, and is safe only while he's the sole contributor. Do it once, as the last step before going public, then force-push.
- **Look again at `vision-examples.json`.** It publishes 512-number summaries of 224 real posts. The extension ships them anyway, but replacing them is worth considering when the training set grows.
- **After going public,** protect `main`, because a push to it deploys, and turn on secret scanning and Dependabot alerts. They're free on public repos.

## Shared ratings

Design: [CROWD-API.md](CROWD-API.md). Build plan: [plans/2026-10-30-local-api.md](plans/2026-10-30-local-api.md).

16. **The API and its deploy files, running locally.** Fastify, Drizzle and Postgres in `api/`, with the fixed Docker, Caddy and deploy files at the top of the repo. Built and tested locally; not deployed. The compose file and the GitHub workflow haven't run yet.
17. **Same-template flyer test.** Compare pHashes of flyers from the same template before the extension sends anything. They might collide, and they're already the main false positive. Tested on 23 flyers from 4 templates: layout alone never matched, and only the same artwork merged. A small sample, so keep adding to it.
18. **Voting in the extension.** Off by default, batched, and with the README, privacy policy and Firefox data permissions updated first. The list is in CROWD-API.md.
19. **Verdict downloads in the extension.** Built in 1.9.0: the list is matched locally and hides with a bar saying the crowd flagged it. See CROWD-API.md.
24. **A block list for verdicts, before launch.** A forged verdict hides a picture for everyone, and the hourly job would publish it again after a manual fix, so today the only remedy is deleting its votes by hand. Add a list of hashes the job never publishes, and a way for Kevin to add to it.
20. **Put the API on a droplet.** Follow Kevin's checklist in CROWD-API.md. This now comes before the store launch.
21. **Donations.** GitHub Sponsors and Ko-fi, a small link in Settings, and a public "server costs this month" line on the site.
23. **Safari from launch.** Kevin has an Apple developer account, and Safari is a launch target, not a later idea. Mac Safari comes first.
    - **How:** wrap the same source as a Safari Web Extension with Xcode's converter, as a new target in `extension/build.mjs`, and ship it through the App Store.
    - **Main risk:** Chrome runs the model through the `offscreen` API and Firefox in its background page. As far as I know Safari has no `offscreen`, so prove where the model can run before building around it.
    - **Check too:** memory limits, because of the Firefox leak; how Safari handles site access, which people grant by hand; and the `data_collection` work, which is Firefox-only.
    - **iPhone:** the 89 MB model may not fit, so test it before promising it. Without the model, labels, tags and verdicts could still work.
22. **Verdicts without the model,** for people who never turned the picture check on. It would mean downloading Facebook pictures again, which 1.5 stopped doing, so weigh that first.

## The website

A static site in `site/`, live on Cloudflare Workers with no tracking scripts or cookies. It has the demo, how it works, accuracy numbers, the privacy promise and the FAQ. Still to add:
- real install buttons, ideally detecting the visitor's browser, once the stores are live
- a before-and-after of a real feed, if a screenshot can avoid showing anyone's posts
- links to GitHub and donations
- updated accuracy numbers after each retrain

The site says "open source" while the repo is still private. Kevin chose to leave that as it is, because going public is coming soon.

## Counting visits and installs

Set this up at launch, using numbers the platforms already collect. Nothing here adds tracking to the extension, which stays free of analytics.

- **Site visits:** Cloudflare's own traffic numbers, which need no script or cookie. If they're too coarse, its cookieless Web Analytics is the next step, and the privacy policy would need to mention it.
- **Installs and active users:** the Chrome Web Store, Firefox Add-ons and Edge developer dashboards.
- **Direct downloads:** the download counts on GitHub Releases, once item 13 is done.
- **One place to look:** a monthly note of these numbers, or a simple page later. Never count people through the API: the verdict list is cached, and keeping it unable to identify anyone is the point.

## After launch: ideas

- **Retraining from shared ratings:** use embeddings collected by the API to ship better model versions as ordinary releases. Don't merge people's local models.
- **iPhone model:** if item 23 shows the 89 MB model won't fit. iPhone extensions get little memory, so the 89 MB model probably won't fit. Test Apple's MobileCLIP-S0 (about 12 MB) with the same eval, and check its license first, because it isn't a standard open-source one. The verdict list may also work there without a model, though matching still has to download each picture to hash it. iOS can't filter inside the Facebook or Instagram apps, only in Safari. A $2–5 app with the source still open was the earlier money idea.
- **Android:** the Firefox build works in Firefox for Android once it's listed on Firefox Add-ons. Skip a native app that filters other apps, because Play Store rules make it risky.
- **Moderation tools:** a Discord bot, an API for group admins and moderators, or a Bluesky labeler built on the same model. Build these only when someone asks, and check them against store policy first, because the model learns from votes.
- **Money:** donations first, then maybe a paid iPhone app, with moderator tools as a bonus. Never sell the votes or the dataset: Chrome's Limited Use policy bans it even when aggregated. No ads, and no subscription for the extension.
