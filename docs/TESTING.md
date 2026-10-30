# Testing

Run the quick checks after every change, and the real-browser checks after anything that touches how pages or pictures are handled. Every one of these has caught a real bug.

## Quick checks (seconds)

```bash
cd extension && node build.mjs && node --test test/meta.test.mjs
for f in src/*.js; do node --check "$f"; done
```

## Fake feed: `extension/test/harness.html`

This page runs the real `content.js` on a fake Instagram-style feed, with the extension APIs faked. It has:
- a post with a label, one with a hashtag, one with metadata, one caught by the picture check, and one from a blocked account
- a sponsored post, a normal post, and a post that appears later
- a Facebook-style post with unknown markup, next to a normal one
- a video

Serve the top folder and open it:

```bash
python3 -m http.server 8767 --directory ~/Projects/hidetheslop
```

Open `http://localhost:8767/extension/test/harness.html` and read each post's `data-hidetheslop` state. The expected results:
- **Hidden:** label, hashtag, metadata, visual, keyword, fbpost, reel, late.
- **Visible:** sponsored (the setting is off), normal, fbnormal.

`window.learned` records rating messages.

## Real model in a browser: `eval/test-vision.html`

This runs the real `background.js` and `vision.js` with the real model and stubbed APIs. It needs `eval/models/` (`cd eval && npm install && ./get-models.sh`) and `eval/browser-check.json` (`node browser-check.mjs`). Open `http://localhost:8767/eval/test-vision.html` and wait about a minute for `window.result`. It checks:
- **Scores** match the Mac (`maxDiff` around 0.001, `flips: 0`).
- **Rating** a picture moves its score and switching the rating replaces it.
- **Downloads:** each picture is fetched once for both checks, and zero times on hosts that strip metadata.

## Settings page: `extension/test/options-preview.html`

This shows the real `options.html` with faked APIs and sample data, and always loads fresh CSS and JS. Add `?empty` to see a fresh install. Use it for any design work. Kevin reviews design changes there in the in-app browser pane. Check both light and dark mode.

## The installed extension in Kevin's real Chrome

Kevin's Chrome profile is called **"Chrome - [removed]"** and is logged into Facebook. Use the Claude in Chrome tools: call `switch_browser` so he can click Connect in the right window, then work only in a new tab group.

- **Installing** has to be done by Kevin. Chrome won't let an agent open `chrome://extensions` or the file picker. He goes to `chrome://extensions` → Developer mode → Load unpacked → `~/Projects/hidetheslop/extension/dist/chrome`. After a rebuild he presses the reload arrow on the card.
- **Controlled check: `extension/test/live.html`.** Serve the top folder on port 8767 and open `http://localhost:8767/extension/test/live.html` in his Chrome. It shows 8 AI and 8 real examples from `test-images/` plus the Stable Diffusion fixture.
  - The installed extension should hide all 9 AI ones and none of the real ones.
  - These are training images, so this shows the pipeline works, not how accurate it is.
  - The server log shows downloads: each picture should be requested twice, once by the page and once by the extension.
- **Facebook:** open facebook.com in the new tab, scroll with waits, then read the state from the page. Useful things to look at:
  - `document.querySelectorAll('[data-hidetheslop]')`, plus each one's `title` or the bar text inside its shadow root.
  - How many `div[data-virtualized]` there are, which should be one per feed item.
  - When a site seems broken, walk up the ancestors of a feed image and list their attributes, to find the current post markers.
- **Ratings are real data.** Don't click **Hide slop** or **AI, hide it** on real posts just to test, because that saves a wrong rating in Kevin's browser. Rating a real false positive as **Not AI** is fine.
- Read and scroll only. Never post, react, comment or change anything on his Facebook account. Close your tabs when you're done.
