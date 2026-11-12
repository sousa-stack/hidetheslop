# Listing everywhere

Written 2026-11-12. Safari 1.11.0 is in Mac App Store review with manual release. Kevin wants Chrome, Firefox and Edge listed publicly too, and the whole thing live. This replaces the 2026-11-01 idea of unlisted listings first: the server, voting and verdicts are proven on real data, which is what that idea was waiting for.

Every outward step waits for Kevin: creating store accounts and paying a fee are his; pressing each store's final Submit is his, as with the App Store; deploying the site needs his yes.

## Decisions (recommended)

- **Public listings, live as each store approves.** Don't hold them for one launch day. Chrome's review is the slowest and least predictable, and holding approved listings gains nothing. Release the Mac app as soon as Apple approves it.
- **Order: Chrome, then Edge, then Firefox.** Chrome first because "read and change all sites" plus a new developer account means the longest review. Edge uses the same zip. Firefox reviews fastest.
- **The site's install buttons turn into links one at a time,** as each listing goes live. A link to a store page that isn't public yet is a dead end.
- **GitHub on the home page: a plain link, no star widget.** GitHub's star button (`buttons.github.io`) loads a script and an iframe from GitHub, which is a third-party request the privacy policy says the site doesn't make. A link with GitHub's mark and "Star it on GitHub" takes one more click and sends nothing. No live star count, for the same reason.

## 1. Checks before anything is submitted (agent)

- **Name check (roadmap item 15):** search the Chrome Web Store, addons.mozilla.org and Edge Add-ons for "Hide the Slop" and close variants, and the USPTO's search if it's quick. Report anything that could cause a takedown.
- **Fresh build:** `node build.mjs`, all tests from `CLAUDE.md`, and confirm the zips are 1.11.0 with no stray files (`.DS_Store`, test files).
- **onnxruntime-web is unmodified:** compare the hashes of every file in `src/ort/` (`ort.wasm.min.js`, and the `.mjs` and `.wasm` it loads) with the official `onnxruntime-web` 1.31.1 npm package. AMO checks third-party libraries by checksum against the official release, and the reviewer notes must link to that release. Downloading the npm tarball needs Kevin's OK (name, source, size).
- **`minimum_chrome_version: "109"`** in the Chrome manifest, the first version with `offscreen` (check this against Chrome's docs). 1.11.0 has never been in the Chrome store, so it goes into 1.11.0 rather than a new version, which would also put Safari's build out of step. Note it in `CHANGELOG.md`.
- **`web-ext lint`** on `dist/firefox`, if Kevin OKs the download. AMO runs the same linter on upload, so this only finds problems sooner.
- **Firefox retest (roadmap item 2):** Kevin loads 1.11.0 through `about:debugging` and checks a feed, the welcome page and Settings. Five minutes of his time; it's the only browser not retested since 1.5.1.

## 2. Store assets (agent, Kevin approves the look)

All in the poster look, with no Facebook branding, made from real screenshots of the extension, not generated art.

- **Five screenshots at 1280×800** (Chrome, Edge and AMO all take this size): the demo on hidetheslop.com with posts hidden behind bars; a bar's Show and the "was this AI?" question with its red and green answers; Settings, Pictures; the popup; the welcome page. Taken from Chrome with `dist/chrome` loaded, in a clean profile, at the real size. Strip metadata.
- **Chrome small promo tile, 440×280,** from the logo and the name, in the poster colors. No marquee.
- **Edge store logo,** from `brand/logo-1024.png`, at the size Partner Center asks for (300×300 last time it was documented; check).
- Show Kevin every image before it's uploaded.

## 3. Listing text (agent)

One file, `docs/store/browser-stores.md`, in the voice of `docs/store/mac-app-store.md` ("you", "your robot", honest numbers), with each store's limits checked against its current docs:

- **Chrome:** summary (132 characters), description, category, language, the **Privacy practices** tab (single purpose; a justification for `storage`, `contextMenus`, `alarms`, `offscreen` and the host permissions; remote code: none, the model is data checked by hash; data usage: **Website content**, because shared ratings are fingerprints of pictures on pages, matching the Firefox manifest's optional `websiteContent`, plus the three Limited Use certifications; remote code: the model is a fixed file checked by SHA-256, and `'wasm-unsafe-eval'` is only for the bundled WebAssembly), the privacy policy URL, support URL and the publisher's EU trader declaration (non-trader, as on Apple).
- **Edge:** description, short description, category, search terms, privacy policy URL, and notes for certification.
- **Firefox (AMO):** summary (250), description, categories, support site and email, privacy policy (AMO can host the text or link), the license (MIT), and reviewer notes: what `ort/` is and where its unmodified files come from, why every site, what's sent and when, and that `build.mjs` only copies files and writes the manifest, so no source upload is needed.
- Reviewer notes for all three: how to see it work without an account (the demo on hidetheslop.com), why it needs every site, and what's sent.

## 4. Kevin's accounts (one at a time, walked through)

1. **Chrome Web Store developer account** at the developer dashboard: sign in with the Google account he wants as publisher, pay the one-time fee, verify the contact email (hello@hidetheslop.com; the developer email can't be changed later, so choose deliberately), and set the publisher name to "Hide the Slop".
2. **Microsoft Partner Center, Edge program** (free): register with a Microsoft account.
3. **addons.mozilla.org developer account** (free): sign in with a Mozilla account and accept the agreement.

## Order

The website changes in sections 6 and 6b, including the reworded privacy policy, go live **before** anything is submitted, because reviewers read the policy. The install buttons stay "coming soon" until each store approves.

## 5. Submitting (agent fills in Kevin's Chrome, Kevin presses Submit)

For each store: upload the zip, fill every field from section 3, upload the images from section 2, set visibility to **Public**, don't defer publishing, then stop for Kevin's Submit. Record each item ID and listing URL in `docs/store/browser-stores.md`.

## 6. The website (agent builds, Kevin previews, deploys on his yes)

- **GitHub link:** a small GitHub mark (GitHub's own SVG, unmodified, set apart from the words, as GitHub's logo rules ask) next to "Star it on GitHub" under the install buttons, and "Source on GitHub" in the footer. Plain `<a href="https://github.com/sousa-stack/hidetheslop">`, no script, no iframe.
- **Install buttons:** each `.soon` becomes a link to its listing once that store has approved it, shown as that store's official badge (Kevin's idea, 2026-11-12): "Download on the Mac App Store", Chrome Web Store's, Mozilla's "Get the add-on" and Microsoft's "Get it from Microsoft Edge", all in their black versions, unmodified and at the sizes each store's guidelines allow. Apple doesn't allow the Safari icon on its own, so badges, not bare browser logos. Badges are local files, never hotlinked. Safari's is `https://apps.apple.com/app/id6834020766`, once Kevin releases it.
- Preview at desktop and phone widths in the browser pane, show Kevin, then `node build.mjs`, `node --test worker.test.mjs`, and `npx wrangler@4.156.0 deploy` on his yes. Check the live page afterwards (with NordVPN off, or through Cloudflare's own resolver).

## 6b. Counting, without tracking (before the buttons go live)

Kevin wants to know how many people visit the site and how many install each version, without tracking anyone.

**What gets counted: daily totals, never events.**
- **Visits:** `index.html` and `privacy.html` carry a plain `<img src="/hit/home" alt="" width="1" height="1">` (and `/hit/privacy`). No script. The Worker adds one to today's total for that page and answers with an empty 204 or a 1×1 GIF. Crawlers that don't load images aren't counted, which filters most bots for free. Requests whose user agent calls itself a bot aren't counted either; the user agent is read in memory to decide and never written.
- **Install clicks:** the store buttons link to `/get/chrome`, `/get/firefox`, `/get/edge` and `/get/safari`, which add one to today's total for that browser and redirect (302) to the listing.
- **Storage:** one SQLite-backed Durable Object holding rows of (day, name, count), incremented in place. Not Analytics Engine, which stores a timestamped row per event, close to the per-vote timestamps the API rules forbid. No IP, user agent, referrer, country or cookie is ever stored. Totals are kept indefinitely, since they're only totals.
- **Why not page-load counting in the Worker:** routing `/` through the Worker (`run_worker_first`) makes every visit count against the free plan's 100,000 Worker requests a day, and past that the home page itself would fail. With the image and the redirects, only the count can fail; the pages stay free static assets.
- **Reading it: private (Kevin's choice, 2026-11-12).** `/stats` answers only with the right token in an `Authorization: Bearer` header, compared in constant time, and is a plain 404 otherwise, including when no token is set. The token is a Worker secret (`STATS_TOKEN`, set with `wrangler secret put`), never in the repo. `site/tools/stats.sh` reads the token from the environment and prints the daily totals.
- **Check before building:** Durable Objects on the free Workers plan with wrangler 4.156.0, and their free request limits. If the free limits look tight for a launch spike, Workers Paid ($5 a month) removes the worry; that's Kevin's call. Observability stays off.
- **`worker.test.mjs`:** a hit adds exactly one to the right day and name and stores nothing else; a bot adds nothing; `/get/*` redirects to the right store and counts once; unknown names are refused rather than creating rows; the origin check behaves exactly as before.
- **Privacy policy, three places:** the "no analytics" line (20), the origin check's "keeps no logs" (32) and "a small script that keeps nothing" (69) all get reworded, plus a short paragraph: the site counts page views and install-button clicks as daily totals, and keeps nothing about who.

**Installs per version: the stores already count them, without anything new in the extension.**
- Chrome: the developer dashboard shows weekly users, installs and uninstalls, and users by item version.
- Firefox: AMO's statistics show daily users and downloads, by version.
- Edge: Partner Center's analytics show acquisitions and active users.
- Mac: App Store Connect Analytics shows first downloads and updates.
- GitHub: each release asset's download count, through `gh api`.
- A short "Where the numbers are" section in `docs/store/browser-stores.md` says where each one lives. The extension itself stays silent: no install pings, nothing new sent.

Not in this: counting crowd-list downloads on the API as a measure of active installs. It would be aggregate, but it touches the API's privacy rules, so it's Kevin's call later.

## 7. GitHub, in the same sitting (agent, through `gh` as `sousa-stack`)

- **Release `v1.11.0`:** tag the commit the zips were built from and attach both zips, so the repo has a download people can check against the stores (roadmap item 13).
- **Issue templates** for "A site broke" and "It got one wrong" (roadmap item 12), so the README, Settings and the site have somewhere to send people.
- README: install links as each store goes live, and the Mac App Store link.

## 8. After

- Update `docs/ROADMAP.md` "Where things stand", `CLAUDE.md` and `CHANGELOG.md` as each store goes live.
- Answer reviewer questions within a day. If a store rejects for the permission scope, the fallback to discuss with Kevin is `optional_host_permissions` with a per-site prompt, which would be a real change to how it works.

## Not in this

New features, retraining (roadmap item 1), splitting `content.js`, and CI. The robot is off by default, so its false positives don't shape first impressions; the AI labels, hashtags and the crowd list do.
