# Changelog


## 1.10.1
- Settings has a Something wrong? row with an Email a report link. It opens your own email app with the version and browser filled in, and never the page you were on, because the repo is private and there's no public issues page yet.

## 1.10.0
- **Safari on the Mac,** for Safari 27.2 and later, from the same code as Chrome and Firefox. It runs your robot the way Firefox does, on the background page. It comes inside a small Mac app (`safari/`), whose one window tells you how to turn it on. Not released yet: it waits for a test run in a real Safari.
- In Safari, before the first rating or list download each time its background starts, the extension checks that Safari's per-install address really was taken off its requests, with two empty requests to a new address on hidetheslop.com that answers only whether one arrived. If it did, nothing is sent until the next start. Chrome and Firefox don't send it. The privacy policy says so.
- The notice when the extension can't see any pages says **Allow on all websites** in every browser, and in Safari points to Safari's own Websites setting if the button doesn't take. Safari grants access site by site, so a failed check there counts as no access.

None of the rest shows up in the extension:
- The API's Caddy drops the `Origin` header from every request, so the API never sees an extension's address from any browser, whatever the extension does.
- `site/worker.js` answers Safari's check at `hidetheslop.com/.well-known/origin-check` and nothing else: every page is still served without running a script, and the Worker's logs are off.
- `node build.mjs safari` builds one browser, and the Safari build has no zip, because Xcode builds the app.

## 1.9.0
- **Pictures the crowd flagged get hidden.** While your robot is on, the extension downloads the list of pictures that people who share their ratings confirmed as AI, every 6 hours, and hides any picture that matches, with a bar saying the crowd flagged it. This is on for people updating from 1.8.0 too. Everyone downloads the same list and matching happens on your computer, so nothing about what you look at is sent. The server and Cloudflare see your IP address while the list downloads. **Hide pictures the crowd flagged** in Settings turns it off and deletes the list, and so does turning your robot off.
- A picture you rated **Not AI** is never hidden by the crowd, even a copy of it at another address. Your answers are kept for that, shared or not, and **Forget them** clears them with your ratings.
- Your robot fingerprints each picture it already downloads, so a match costs no extra download: about 10 ms more per feed picture, and pictures over 12 megapixels are skipped. A shared rating now reuses that fingerprint instead of fetching the picture again.
- On Firefox, the rule that takes the extension's own address off requests to the API now covers the list download too.
- The privacy policy, README and Settings say what's downloaded.

## 1.8.0
- You can share your ratings with other people, in Settings or on the welcome page. It's off until you turn it on, on each browser separately. A rating you make while it's on sends a hash of the picture, your answer and a per-picture code, hours later and at most 5 at a time. The picture, its address and anything about you are never sent. Ratings from before you turned it on stay on your computer. See the privacy policy.
- Settings shows how many ratings are waiting, with a **Send now** link. Turning sharing off clears them, and so does forgetting your ratings.
- Firefox 140 or newer is now required, and 142 on Android, because sharing uses Firefox's own consent, which older versions don't have. Firefox asks you when you turn sharing on.
- The extension can now wake once an hour to send what's due, which needs the `alarms` permission. On Firefox it also has a rule that takes the extension's own address off requests to the API, because that address is unique to your install.
- The privacy policy, README and in-page copy say what's sent.

None of the rest shows up in the extension:
- `api/`: a server for pooling ratings without personal data or browsing history. See `docs/CROWD-API.md`.
- Docker, Caddy, deploy and hardening files for one droplet behind Cloudflare, none of it live yet.
- `scripts/local-stack.sh` runs the real production stack on a Mac and proves it through Caddy, including the real `deploy.sh` and `backup.sh` in a throwaway copy.
- `backup.sh` can put an encrypted copy of each dump in a private bucket, and mixes rows up first so a dump doesn't keep batches of votes together. `restore.sh` loads the newest dump into a new database, and moves `verdict_seq` forward so clients' cursors keep working.
- `deploy.sh` now validates a changed `Caddyfile` and restarts Caddy to apply it. Before, a deploy left the old config running.
- `CONFIRM_MIN_VOTES` can be lowered for testing, and the API warns at startup when it isn't 5. Expiry stays at the promised 5 votes.
- `extension/src/phash.js`: the exact perceptual hash for pooled ratings, checked in real browsers. A few reposts still land 4 bits apart. See `docs/CROWD-API.md`.
- Settings warns you when sharing is on and your robot is off, because **Hide slop** still hides the post but the rating can't count.
- The right-click menu no longer tries to add its items twice when installing and startup land together.
- A buy-me-a-coffee link with a drawn cup in the Settings footer, and the same on the website, instead of Buy Me a Coffee's widget, which would load their script on every visit.
- The bar on a hidden post has real buttons: red with a cross for AI, green with a tick for not AI, and an outlined Show. It notices a site's own dark mode, and the dashed border is now solid.
- A picture or video blurred in place, outside any post, gets a Show button when you rest your mouse on it. Before, there was no way to see it again.
- The hover button no longer appears on profile pictures. Facebook draws them as SVG, so it used to look straight past them to the cover photo.

## 1.7.3
- Retrained on 224 unique pictures: 93 AI and 131 real. Overall accuracy is about the same: 83 of 93 AI caught and 8 of 131 real wrongly flagged, on a set with more hard pictures.
- Two held-out human-made flyers dropped from 93% and 32% to 7% and 9%, and AI flyers stayed at 14 of 15. They're from the same series as two pictures it trained on, so this is a good sign, not proof for other human flyers.

## 1.7.2
- The model downloads from a copy on Cloudflare, falling back to Hugging Face. Both are checked by the same hash, so the picture check no longer depends on one Hugging Face account.
- A privacy policy link on the welcome and Settings pages.

## 1.7.1
- Flat amber headers on the welcome, Settings and popup pages, without the dotted background.
- A simpler welcome page header: the logo and one line, instead of four callouts.

## 1.7.0
- A better picture check, retrained on 87 AI and 118 real pictures instead of 25 and 32. In testing it caught 78 of 87 AI pictures and wrongly flagged 6 of 118 real ones.
- The "How sure before hiding" setting now does something. Scores used to land on almost exactly 0% or 100%, because the classifier was too confident.
- If you've rated pictures, updating now rebuilds your own classifier on the new examples.

## 1.6.1
- A small "Made by Kevin Sousa and a clanker" credit at the foot of the welcome and Settings pages. It's a plain link, so nothing is sent unless you click it.
- Credit for the two icons in the logo, and their license texts, in `icons/NOTICE.txt`.

## 1.6.0
- A welcome page opens on first install. It shows what's already working, offers to turn on the picture check, which is off by default, and lets you try the Hide slop button. Firefox users who haven't granted site access can do that there too.
- Redesigned Settings page and popup, matching the welcome page: a printed-poster look with big words and ruled rows. Settings now fits on a phone.
- The popup shows whether your robot is on. On a page opened before the extension loaded, it offers a reload instead of saying "Not running on this page".
- Plainer wording in Settings: each switch now says what it does right now, starting with Hide when it's on and Show when it's off.

## 1.5.1
- Fixed a Firefox memory leak with the picture check on. Firefox stops the background page after 30 idle seconds and never freed the model's WebAssembly memory, so each wake-up left about 245 MB behind, up to 12 GB after 10 days. The model now runs in a worker, so its memory goes when the page does: about 60 to 90 MB while idle, about 410 MB while checking pictures.

## 1.5.0
- Each picture is downloaded once for both the metadata and picture checks, and Facebook and Instagram images aren't downloaded just for metadata.
- Stable onnxruntime-web 1.31.1 instead of a development build.
- `test/live.html`, for testing the installed extension in a real browser.

## 1.4.0
Found by testing on a real Facebook feed in Chrome:
- Facebook feed posts are now recognised again, as `div[data-virtualized]`. Hashtags, the blocklist and whole-post hiding work in the feed.
- Videos with no thumbnail are checked from a frame of the video. Videos need at least 90% confidence.
- Facebook's "Ad" label and its scrambled "Sponsored" are detected.

## 1.3.0
- A new logo for all icons, which Kevin made from two SVG Repo icons.
- A **Hide slop** button appears when you rest the mouse on a big picture; it does the same as right-click → Hide this as AI slop.
- Redesigned Settings page: larger text, the logo's red, round switches, cards, and the picture check up front.

## 1.2.0
- Renamed from Slop Stop to Hide the Slop.
- Ratings: Show → "was this AI?" → **AI, hide it** / **Not AI** retrains the classifier on your computer. Settings can export ratings to a file.

## 1.1.0
- The picture check: a CLIP image model on your computer and a classifier trained on hand-sorted examples.
- Facebook's "AI content" label, and a page-wide label search for layouts we don't know.

## 1.0.0
- Platform AI labels, AI hashtags, AI image metadata (C2PA, IPTC, generator tags), a blocklist, right-click hiding, and optionally hiding all sponsored posts.
