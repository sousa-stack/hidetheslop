# Hide the Slop: guide for agents

A Chrome and Firefox (Manifest V3) extension that hides AI-generated posts, pictures and ads. Personal open-source project by Kevin Sousa (GitHub `sousa-stack`), heading for a public launch at hidetheslop.com. User-facing docs are in [README.md](README.md). This file is for whoever works on the code next.

Read these before changing things:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces talk to each other, storage keys, the picture classifier.
- [docs/TESTING.md](docs/TESTING.md): every test, and how to test the installed extension on real Facebook.
- [docs/ROADMAP.md](docs/ROADMAP.md): what's done, what's left before launch, ideas after it.
- [CHANGELOG.md](CHANGELOG.md): what each version changed and why.

## Repo rules (the owner's, not suggestions)

- **Never commit `test-images/`.** It holds real people's Facebook posts. Only their 512-number embeddings ship (`extension/src/vision-examples.json`). `.gitignore` covers it; check `git status` before every commit anyway.
- **Commit and push only when Kevin asks.** So far he has chosen to work directly on `main`.
- **No `gh`.** Push with plain git over SSH. The remote is `git@github.com:sousa-stack/hidetheslop.git`, which uses his personal key through the plain `github.com` host.
- **Commit identity is set in this repo only:** `Kevin Sousa <[removed]>`. His global git identity belongs to his employer ([removed]), so never change the global config or commit from another checkout.
- End commit messages with the `Co-Authored-By:` line the session asks for. Commit messages here are a short summary plus a bullet list of what changed and why.
- **Ask before downloading anything** (models, npm packages), saying the name, the source and the size.

## Layout

```
extension/          the extension
  src/              source; loaded as-is, no bundler
  build.mjs         writes dist/chrome and dist/firefox (+ zips); holds the version number
  test/             unit test, fake-feed harness, live page, settings preview
  tools/            make_icons.sh (icons from brand/logo-1024.png)
eval/               scripts that compared detectors and train the picture classifier
brand/              logo-1024.png (Kevin drew it; don't replace it with generated art)
test-images/        private example pictures (ai/, real/). Not in git
docs/               architecture, testing, roadmap
```

## Build and check

```bash
cd extension && node build.mjs                 # builds both browsers
cd extension && node --test test/meta.test.mjs # metadata detector tests
```

There's no linter or CI yet; that's on the roadmap. `dist/` is ignored. Bump `version` in `extension/build.mjs` for every user-visible change.

To load it: Chrome uses `chrome://extensions` → Developer mode → Load unpacked → `extension/dist/chrome`. Firefox uses `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `extension/dist/firefox/manifest.json`. After a rebuild in Chrome, press the reload arrow on the card, then reload the page you're testing.

## Code conventions

- Plain JavaScript, no build step, no dependencies in the extension. Shared code is a `var` global in its own file (`SLOP_API`, `SlopMeta`, `SlopTrain`, `SlopVision`), listed in the right order in the manifest or HTML.
- The same source runs in both browsers. Use `SLOP_API` (that's `browser`, or else `chrome`) and promise-style calls. For `onMessage` replies, call `sendResponse` and `return true`; don't return a promise.
- Comments explain *why* in a sentence or two, in the voice of the existing code. Match the surrounding density.
- Page UI we inject (bars, the hover button) lives in shadow DOM, so site CSS can't touch it. Never modify the page's own images.
- Settings defaults are in `extension/src/common.js`. A new setting needs a default there and a control in `options.html`/`options.js`. The options page wires every `input[data-key]` checkbox automatically.
- Colors are CSS variables in `extension/src/ui.css`. The accent is the logo's red: `#c80000` in light mode, `#f04848` in dark.

## Things that have bitten us

- **Facebook changes its markup.** Feed posts are `div[data-virtualized]`; offscreen ones are empty placeholders with `data-virtualized="true"`. The old `aria-posinset` and `role="article"` markers mostly don't match the feed any more. Feed ads say "Ad" through a hidden `aria-labelledby` target, or spell "Sponsored" as jumbled one-letter fragments. Site rules are the `SITES` list at the top of `content.js`. When a site breaks, look at its real DOM (see docs/TESTING.md) before guessing.
- **Chrome's service worker can't run the model.** It runs in `offscreen.html`, while Firefox runs it in the background page. Both paths have to be tested.
- **Firefox doesn't draw `::before` on `<input>`.** That's why the Settings switches are drawn with a gradient.
- **The in-app browser pane, when hidden, doesn't report what's on screen**, so IntersectionObserver never fires. The harness replaces IntersectionObserver for this reason. Treat timing numbers from a hidden pane as meaningless.
- **Browsers cache the test server's files.** Use a new port, or the cache-busting in `test/options-preview.html`, when a change "doesn't show up".
- The classifier was trained on stills, so videos need at least 90% confidence (`MIN_VIDEO_SCORE` in `content.js`).
- `content.js` reads `globalThis.__slopTestHost` so the harness can pretend to be Instagram. Content scripts run in an isolated world, so real pages can't set it.
