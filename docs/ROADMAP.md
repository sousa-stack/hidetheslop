# Roadmap

The goal is a polished public launch: Chrome Web Store, Firefox Add-ons, Edge, and a site at **hidetheslop.com** (Kevin owns the domain). The repo stays private until launch, then goes public as a portfolio piece.

Hide the Slop stays free and open source, on every platform we can reach. It should pay for its own server, and a little on top is a bonus. Pooled ratings are how it gets better, and that has to happen without collecting personal data or browsing history. The design is in [CROWD-API.md](CROWD-API.md).

## Order of work

1. **Build the API and shared ratings locally,** with no server bill yet (items 16–18).
2. **Fix the deploy scripts** and use the Hide the Slop name everywhere (item 16).
3. **Work through the launch list below,** and add the donation links and privacy policy.
4. **Start the droplet just before launch,** with voting in the first public release. Ratings made before voting ships can't be shared later without downloading each picture again.
5. **Turn on verdict downloads** once pictures start reaching the 5-voter threshold.

## Done

- Real Chrome tested on Kevin's live Facebook feed (1.4, 1.5). The picture check, whole-post hiding, video frames, Show → rate, and the hover button all work there.
- Speed is fine: the page-wide label search takes about 1 ms on Facebook.
- One download per picture. Hosts that strip metadata aren't downloaded just for the metadata check.
- Stable onnxruntime-web 1.31.1 instead of a dev build.
- Kevin's logo, the redesigned Settings page, MIT license, README.

## Before launch: must do

1. **More training examples.** This is the biggest risk to people's first impression.
   - **Current set:** 25 AI and 32 real images, nearly all from one feed and area.
   - **Gaps:** cartoon or caricature-style AI (an AI van wrap got through), video frames, ordinary ads (a music-software screen recording was wrongly flagged), and human-made template flyers (still the main false positives).
   - **Target:** 200 or more of each kind.
   - **How:** ratings exported from Settings → `cd eval && node probe.mjs --with <file> --export`, or image files dropped in `test-images/`. Report the new leave-one-out numbers. Early testers can do this with **Save to a file**, which exports only embeddings, because few pictures will reach 3 raters while there are few users.
   - **Clean up:** `test-images/` has one near-identical pair with the same label, which slightly flatters the leave-one-out score.
2. **Retest in Firefox.** Kevin last used it in Firefox around version 1.1. Since then 1.2–1.5 changed the background page (the model, ratings, one download). Test with `about:debugging`, then `test/live.html`.
   - **Memory:** the 12 GB leak Kevin saw in Firefox's WebExtensions process was ours, and 1.5.1 fixes it. He confirmed it in real use in Firefox and Chrome on 2026-10-31. It's untested on Firefox versions older than 159, and the extension's minimum is 128.
3. **Host the model ourselves.** Put a copy on hidetheslop.com, checked by the same SHA-256 hash, and fall back to Hugging Face. Right now one Hugging Face account going away breaks the picture check.
4. **Privacy policy page.** Both stores require one, because the extension reads every site. The truth is simple:
   - Pictures are re-downloaded from where the page got them, without cookies.
   - The model comes from Hugging Face (or our mirror).
   - There are no analytics.
   - Until shared ratings ship, nothing is sent anywhere else. Once they ship, the policy must say what `CROWD-API.md` says we send, including that the server and Cloudflare see an IP address in transit.

## Before launch: should do

5. **Welcome page on install.** Explain the three ways it hides slop, and offer to turn on the picture check, which is off by default and an 89 MB download. Show the hover button.
6. **Popup redesign** to match Settings: red, larger text, picture-check status, and a "report a broken site" link.
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

## Shared ratings

Design: [CROWD-API.md](CROWD-API.md). Build plan: [plans/2026-10-30-local-api.md](plans/2026-10-30-local-api.md).

16. **The API and its deploy files, running locally.** Fastify, Drizzle and Postgres in `api/`, with the fixed Docker, Caddy and deploy files at the top of the repo. Built and tested locally; not deployed. The compose file and the GitHub workflow haven't run yet.
17. **Same-template flyer test.** Compare pHashes of flyers from the same template before the extension sends anything. They might collide, and they're already the main false positive.
18. **Voting in the extension.** Off by default, batched, and with the README, privacy policy, store listings and Firefox data permissions updated in the same release. The list is in CROWD-API.md.
19. **Verdict downloads in the extension.** Match locally, then hide with a bar saying the crowd flagged it. Comes after enough pictures reach 5 voters.
20. **Go live.** Follow Kevin's checklist in CROWD-API.md.
21. **Donations.** GitHub Sponsors and Ko-fi, a small link in Settings, and a public "server costs this month" line on the site.
22. **Verdicts without the model,** for people who never turned the picture check on. It would mean downloading Facebook pictures again, which 1.5 stopped doing, so weigh that first.

## The website

One static page on Cloudflare Pages or GitHub Pages, with no tracking scripts or cookies:
- an install button that detects the visitor's browser
- a before-and-after feed demo
- how it works
- honest accuracy numbers
- the privacy promise
- an FAQ
- links to GitHub and donations
- the privacy policy, and the model mirror from item 3

## Counting visits and installs

Set this up at launch, using numbers the platforms already collect. Nothing here adds tracking to the extension, which stays free of analytics.

- **Site visits:** Cloudflare's own traffic numbers, which need no script or cookie. If they're too coarse, its cookieless Web Analytics is the next step, and the privacy policy would need to mention it.
- **Installs and active users:** the Chrome Web Store, Firefox Add-ons and Edge developer dashboards.
- **Direct downloads:** the download counts on GitHub Releases, once item 13 is done.
- **One place to look:** a monthly note of these numbers, or a simple page later. Never count people through the API: the verdict list is cached, and keeping it unable to identify anyone is the point.

## After launch: ideas

- **Retraining from shared ratings:** use embeddings collected by the API to ship better model versions as ordinary releases. Don't merge people's local models.
- **iPhone:** a Safari Web Extension, the same code wrapped by Xcode, sold as a $2–5 app with the source still open. iPhone extensions get little memory, so the 89 MB model probably won't fit. Test Apple's MobileCLIP-S0 (about 12 MB) with the same eval, and check its license first, because it isn't a standard open-source one. The verdict list may also work there without a model, though matching still has to download each picture to hash it. iOS can't filter inside the Facebook or Instagram apps, only in Safari.
- **Android:** the Firefox build works in Firefox for Android once it's listed on Firefox Add-ons. Skip a native app that filters other apps, because Play Store rules make it risky.
- **Moderation tools:** a Discord bot, an API for group admins and moderators, or a Bluesky labeler built on the same model. Build these only when someone asks, and check them against store policy first, because the model learns from votes.
- **Money:** donations first, then the paid iPhone app, with moderator tools as a bonus. Never sell the votes or the dataset: Chrome's Limited Use policy bans it even when aggregated. No ads, and no subscription for the extension.
