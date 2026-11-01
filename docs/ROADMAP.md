# Roadmap

The goal is a polished public launch on Chrome, Firefox, Edge and Safari, with a site at **hidetheslop.com** (Kevin owns the domain). The repo stays private until launch, then goes public as a portfolio piece.

Hide the Slop stays free and open source, on every platform we can reach. It should pay for its own server, and a little on top is a bonus. Pooled ratings are how it gets better, and that has to happen without collecting personal data or browsing history. The design is in [CROWD-API.md](CROWD-API.md).

## Where things stand

Updated 2026-11-01. Start here.

**Live:**
- [hidetheslop.com](https://hidetheslop.com) and its privacy policy, on Cloudflare Workers. The install buttons say "coming soon".
- The model at `models.hidetheslop.com`, on Cloudflare R2, with Hugging Face as the fallback.
- `hello@hidetheslop.com`, forwarding to Kevin's Gmail. Tested.

**Built, not live:**
- The extension, version 1.7.2. Not in any store.
- The API in `api/`, 88 tests passing, with its deploy files. There's no droplet yet, and the extension doesn't call it.

**Never run for real:**
- `docker compose`, because this Mac has no Compose plugin, so the production stack has never started as a whole.
- `deploy.sh`, `backup.sh` and `harden.sh` on a real server, and the workflow's deploy job. Its test job passes on GitHub.
- Real client IPs through Cloudflare.
- Clicking "Turn it on" on a real install, which would be the first real download from the model mirror.
- A true first install opening the welcome page, and the update rebuild of a person's classifier.
- Sticky buttons on a real phone, and Firefox versions older than 159.

## Order of work

**Kevin's decision, 2026-11-01:** shared ratings get tested on the droplet with real data **before** the extension goes to any store. This replaces the earlier plan of starting the droplet just before launch. It means paying for the server before there are users, and in exchange the server, voting and verdicts are proven first.

1. **Same-template test (item 17).** Test more flyer pairs, because a collision here changes the hash design. Kevin is collecting images, and they also feed item 1.
2. **Prove the stack, then the droplet (item 20).** Get the Compose plugin installed with Kevin's OK and start the stack locally. Then follow the going-live checklist in CROWD-API.md.
3. **Voting in the extension (item 18),** on an unlisted build Kevin loads himself. Update the privacy policy and the Firefox data permission first, and turn on no sharing for anyone before the policy says what's sent.
4. **Test with real data.** Kevin and a few testers vote on real feeds. Confirm votes arrive, the aggregate job runs, verdicts publish, and the rules in the promises section of CROWD-API.md hold on the live server: no IPs in logs, lone hashes expire. Restore a backup to prove it works, and load-test the votes route.
5. **Verdict downloads (item 19).** Build them against real verdicts, and confirm the extension hides a picture from the list.
6. **Safari (item 23),** so it launches with the other browsers.
7. **The launch list below,** then the "Going public" list, then the store listings.

**Open questions for Kevin:**
- Five voters is a lot with only a few testers. Lower the threshold during testing, or seed verdicts from his hand-sorted pictures? Seeding bypasses the voting rules, so it needs his decision.
- Who are the testers, and how do they get the unlisted build?
- Is the Safari app free, or the paid iPhone idea from earlier? Kevin already has an Apple developer account, so the $99 fee no longer needs covering.
- Where do backups go off the droplet, and for how long?

## Done

- Real Chrome tested on Kevin's live Facebook feed (1.4, 1.5). The picture check, whole-post hiding, video frames, Show → rate, and the hover button all work there.
- Speed is fine: the page-wide label search takes about 1 ms on Facebook.
- One download per picture. Hosts that strip metadata aren't downloaded just for the metadata check.
- Stable onnxruntime-web 1.31.1 instead of a dev build.
- The logo, credited in `brand/README.md`, plus an MIT license and README.
- The poster redesign of the welcome, Settings and popup pages (1.6).
- The Firefox memory leak fix (1.5.1), confirmed by Kevin in Firefox and Chrome.
- Retraining on 205 unique pictures, with less overconfident scores (1.7).
- The website, privacy policy, model hosting and project email.

## Before launch: must do

1. **More training examples.** This is the biggest risk to people's first impression.
   - **Current set:** 87 AI and 118 real unique images, trained in 1.7.0. Mostly from one feed and area. Keep duplicates out: they inflate the numbers, and `test-images/duplicates/` holds the ones moved aside.
   - **Gaps:** human-made flyers and promo graphics (still the main false positives), AI edits of real photos, realistic AI food, and video frames.
   - **Target:** 200 or more of each kind.
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
- **Look again at `vision-examples.json`.** It publishes 512-number summaries of 205 real posts. The extension ships them anyway, but replacing them is worth considering when the training set grows.
- **After going public,** protect `main`, because a push to it deploys, and turn on secret scanning and Dependabot alerts. They're free on public repos.

## Shared ratings

Design: [CROWD-API.md](CROWD-API.md). Build plan: [plans/2026-10-30-local-api.md](plans/2026-10-30-local-api.md).

16. **The API and its deploy files, running locally.** Fastify, Drizzle and Postgres in `api/`, with the fixed Docker, Caddy and deploy files at the top of the repo. Built and tested locally; not deployed. The compose file and the GitHub workflow haven't run yet.
17. **Same-template flyer test.** Compare pHashes of flyers from the same template before the extension sends anything. They might collide, and they're already the main false positive. First result: one same-template pair came out 12 bits apart, safely above the 3-bit match limit. Test more pairs before relying on it.
18. **Voting in the extension.** Off by default, batched, and with the README, privacy policy and Firefox data permissions updated first. The list is in CROWD-API.md.
19. **Verdict downloads in the extension.** Match locally, then hide with a bar saying the crowd flagged it.
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
