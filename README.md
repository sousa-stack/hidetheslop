# Hide the Slop

A Chrome, Firefox and Safari extension that hides AI-generated images, posts and ads. Safari is Mac only for now, and not released yet.

## What it catches

| Signal | Where | How reliable |
|---|---|---|
| The site's own AI label ("AI content", "AI info", "AI-generated", "Altered or synthetic content", "AI modified") | Facebook, Instagram, Threads, TikTok, YouTube, Pinterest | Exact. Only catches what the platform labeled. |
| AI hashtags and phrases (#aiart, #midjourney, "made with ChatGPT", "AI-generated flyer") | Same feeds plus X, Reddit, LinkedIn | Good. Also hides posts that talk about AI images. |
| AI metadata inside the image file: C2PA Content Credentials and IPTC "trainedAlgorithmicMedia", Midjourney, DALL·E, ChatGPT, Firefly, Stable Diffusion and ComfyUI settings, the AIGC label | Every site, including ad iframes | Exact when the metadata survived. Facebook and Instagram strip it on upload; restaurant sites, ad networks and image hosts often don't. |
| **The picture itself** (off until you turn it on in Settings): a small AI model scores every picture, video thumbnail, and a frame of videos with no thumbnail | Every site | Good on the glossy AI flyer look it was trained on: caught 83 of 93 AI pictures and wrongly flagged 8 of 131 real ones in testing (mostly human-made flyers built from templates). Everything it hides gets a Show bar, and your ratings there retrain it. |
| **The crowd's list** (on, but needs the picture check): pictures that 5 or more installs rated, with at least 4 in 5 saying AI | Every site | Exact copies and reposts. The list is downloaded whole every few hours and matched on your computer. Your own **Not AI** always wins. |
| Your blocklist: restaurant names, pages, @handles, words | Feeds | Exact. Right-click a post and pick **Always hide posts from this account…** |
| **Hide slop** button: rest the mouse on a big picture for half a second | Anywhere | Hides the post, keeps that image hidden, and teaches the picture check. It floats above the page, so the page's images aren't changed. Turn it off in Settings. |
| Right-click **Hide this as AI slop** | Anywhere | Same as the button. |
| Every sponsored post (off by default) | Instagram, X, Reddit, LinkedIn, YouTube, TikTok, Pinterest; Facebook best effort | The heavy option for ad slop. |

Without the picture check, an AI image with its metadata stripped that nobody labeled or hashtagged gets through. The picture check is for exactly those.

## The picture check

Turning it on downloads an 89 MB model (OpenAI's CLIP ViT-B/32, the int8 ONNX copy at `Xenova/clip-vit-base-patch32`) once, from this project's copy on Cloudflare or from Hugging Face. The download is pinned to one revision and checked against a SHA-256 hash. It runs on your computer in WebAssembly, about a quarter second per picture. CLIP turns each picture into 512 numbers, and a small classifier (`extension/src/vision-weights.json`) decides from those whether it looks AI-made. That classifier was trained on hand-sorted examples of real Facebook slop and real posts. **How sure before hiding** in Settings sets the cutoff (default 70%). Videos always need at least 90%, because the classifier was trained on still images.

Ready-made AI-image detectors did badly on flyers: one flagged half the human-made flyers, another missed half the AI ones. The comparison is in `eval/`. Its accuracy numbers come from example pictures that stay private, because they're real people's posts, so they can't be reproduced from a clone of this repo.

### Teaching it

When you click **Show** on something the picture check hid, it asks **was this AI?** Pick **AI, hide it** or **Not AI**. Right-click → **Hide this as AI slop** on something it missed counts as an AI rating. After each rating the classifier retrains on your computer in a fraction of a second, from the shipped examples (`extension/src/vision-examples.json`) plus your ratings. Each of your ratings counts three times. Your ratings stay in the browser. Settings shows how many you've made, and can forget them.

To fold your ratings into the version everyone gets: Settings → **Your ratings** → **Save to a file**. The file holds only each picture's 512-number summary, not the picture or its address. Then:

```bash
cd eval && node probe.mjs --with ~/Downloads/hidetheslop-ratings-YYYY-MM-DD.json --export
```

That reports how well it does with them and writes new `vision-weights.json` and `vision-examples.json`. Rebuild afterwards. To add image files instead, put them in `test-images/ai` or `test-images/real` and run the same command without `--with`.

Hidden posts leave a thin bar with a **Show** button. You can switch to removing them completely in Settings.

## Install

Build once (Node 18+):

```bash
cd extension && node build.mjs
```

This writes `extension/dist/chrome/` and `extension/dist/firefox/` with a zip for each, and `extension/dist/safari/`. `node build.mjs safari` builds just one.

**Chrome / Edge / Brave / Arc:** open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `extension/dist/chrome`.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `extension/dist/firefox/manifest.json`. A temporary add-on goes away when Firefox restarts. To keep it, sign the zip as an unlisted add-on at addons.mozilla.org (free, automatic) and install the signed `.xpi`. Or use Firefox Developer Edition with `xpinstall.signatures.required` set to `false`.

**Safari (Mac, Safari 27.2 or later):** Safari only takes extensions inside a Mac app, which lives in `safari/`. Copy `safari/Local.xcconfig.example` to `safari/Local.xcconfig` and put your Apple Developer team ID in it, then open `safari/Hide the Slop.xcodeproj` in Xcode and run the **Hide the Slop** scheme. Building runs `node build.mjs safari` and copies `dist/safari` into the app, so you never copy files by hand. The app's window has a button that opens Safari's Extensions settings: tick **Hide the Slop** there. For a quick try without Xcode, Safari's Settings → Developer → **Add Temporary Extension…** loads the `extension/dist/safari` folder until Safari quits.

If Firefox or Safari didn't grant site access at install, the welcome and settings pages show an **Allow on all websites** button. Safari grants access site by site, so the extension sees nothing until you allow it on all websites.

## Privacy

To check an image, the extension downloads that image again from the server the page already loaded it from, without cookies: once per picture, whole if the picture check is on, or just the first 512 KB for the metadata check alone. Hosts known to strip metadata (Facebook's and Instagram's) aren't downloaded just for that. Nothing is sent to any other server unless you turn on sharing. The only other downloads are the model, from this project's copy on Cloudflare or from Hugging Face, when you turn the picture check on, and, while the picture check is on, the crowd's list of confirmed AI pictures from `api.hidetheslop.com` every few hours. Everyone downloads the same list, and the extension matches pictures against it on your computer, so it never asks about any one picture. The server and Cloudflare see your IP address in transit. **Hide pictures the crowd flagged** in Settings turns it off and deletes the list. There are no analytics. Settings sync through your browser account, except in Safari, which keeps them on that Mac.

**Safari only:** before the first vote or list download in each run of its background, Safari's build sends one check to `hidetheslop.com/.well-known/origin-check`, a GET and a POST with nothing in them. Safari puts a random ID for the install in the `Origin` of an extension's requests, and the extension removes it; the check answers only whether an ID arrived, so a removal that didn't work keeps sending off instead of reaching the API. The website keeps no logs of it, and the API's server drops any `Origin` from any browser anyway.

**Sharing your ratings is optional, and off until you turn it on.** With it on, each rating you make goes to `api.hidetheslop.com`: a 64-bit hash of the picture, your answer, whether you rated it or hid it, and a per-picture code, 1 to 6 hours later and at most 5 at a time. If 3 or more installs rated that exact picture, the server can also ask for the numbers that describe it. The picture, its address, the page and any ID for you are never sent. The server and Cloudflare see your IP address in transit, and the server doesn't log it. Ratings already sent can't be taken back, because nothing ties them to you. The whole list is in the [privacy policy](https://hidetheslop.com/privacy) and [docs/CROWD-API.md](docs/CROWD-API.md).


## Develop

| Folder | What's in it |
|---|---|
| `extension/` | The extension. `src/` is the source; `build.mjs` adds each browser's manifest. |
| `api/` | The server for shared ratings and the crowd's list. |
| `safari/` | The Mac app that carries the Safari extension: an Xcode project that builds `extension/dist/safari` into it. |
| `site/` | [hidetheslop.com](https://hidetheslop.com), the privacy policy, and the Safari build's origin check (`worker.js`). |
| `eval/` | Scripts that compared detectors and train the picture classifier. `npm install` there, then `./get-models.sh`. |
| `brand/` | The logo. `extension/tools/make_icons.sh` makes the toolbar icons from it. |
| `test-images/` | Hand-sorted example pictures, **not in git**: they're real people's posts. The extension ships only their 512-number summaries. |

Paths below are inside `extension/` unless they start with `eval/`.

- `node --test test/meta.test.mjs` runs the metadata detector tests, and `test/download.test.mjs` runs the model download with the real file.
- `src/ort/` is onnxruntime-web (see `src/ort/VERSION`). `src/vision.js` runs the model. Chrome runs it in `offscreen.html`, because its background service worker can't. Firefox and Safari run it in the background page.
- `eval/test-vision.html` runs `background.js` and `vision.js` in a browser, with the real model and stubbed extension APIs. It checks the scores match the Mac test and that ratings retrain the classifier. Serve the top folder with `python3 -m http.server 8767` and open `http://localhost:8767/eval/test-vision.html`.
- `test/live.html` is for the installed extension in a real browser: a plain page of your `test-images` examples. Serve the top folder on port 8767 and open `/extension/test/live.html`.
- `test/harness.html` runs the real content script on a fake feed. Serve `extension/` with `python3 -m http.server 8765` and open `http://localhost:8765/test/harness.html`.
- `tools/make_icons.sh` remakes `src/icons/` from `../brand/logo-1024.png`.

When a site changes its layout, update its entry in `SITES` at the top of `src/content.js`.

Found a security problem? See [SECURITY.md](SECURITY.md). Working on the code, or an AI agent picking it up? Start with [CLAUDE.md](CLAUDE.md), then [docs/](docs/): architecture, testing, and the roadmap. What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

## License

The code is MIT, see [LICENSE](LICENSE). The logo and icons aren't: see [brand/README.md](brand/README.md). Built on:

- [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT, Microsoft), included in `extension/src/ort/`.
- [Noto Emoji](https://github.com/googlefonts/noto-emoji) (Google) for the robot in the logo, and a CC0 icon from [SVG Repo](https://www.svgrepo.com) for the red sign. See [brand/README.md](brand/README.md).
- [CLIP](https://github.com/openai/CLIP) ViT-B/32 (MIT, OpenAI), in the ONNX conversion by [Xenova](https://huggingface.co/Xenova/clip-vit-base-patch32). It's downloaded when you turn on the picture check, not included here.
