# Hide the Slop

A Chrome and Firefox extension that hides AI-generated images, posts and ads.

## What it catches

| Signal | Where | How reliable |
|---|---|---|
| The site's own AI label ("AI content", "AI info", "AI-generated", "Altered or synthetic content", "AI modified") | Facebook, Instagram, Threads, TikTok, YouTube, Pinterest | Exact. Only catches what the platform labeled. |
| AI hashtags and phrases (#aiart, #midjourney, "made with ChatGPT", "AI-generated flyer") | Same feeds plus X, Reddit, LinkedIn | Good. Also hides posts that talk about AI images. |
| AI metadata inside the image file: C2PA Content Credentials and IPTC "trainedAlgorithmicMedia", Midjourney, DALL·E, ChatGPT, Firefly, Stable Diffusion and ComfyUI settings, the AIGC label | Every site, including ad iframes | Exact when the metadata survived. Facebook and Instagram strip it on upload; restaurant sites, ad networks and image hosts often don't. |
| **The picture itself** (off until you turn it on in Settings): a small AI model scores every picture, video thumbnail, and a frame of videos with no thumbnail | Every site | Good on the glossy AI flyer look it was trained on: caught 23 of 25 AI images and wrongly flagged 3 of 32 real ones in testing (mostly human-made flyers built from templates). Everything it hides gets a Show bar, and your ratings there retrain it. |
| Your blocklist: restaurant names, pages, @handles, words | Feeds | Exact. Right-click a post and pick **Always hide posts from this account…** |
| **Hide slop** button: rest the mouse on a big picture for half a second | Anywhere | Hides the post, keeps that image hidden, and teaches the picture check. It floats above the page, so the page's images aren't changed. Turn it off in Settings. |
| Right-click **Hide this as AI slop** | Anywhere | Same as the button. |
| Every sponsored post (off by default) | Instagram, X, Reddit, LinkedIn, YouTube, TikTok, Pinterest; Facebook best effort | The heavy option for ad slop. |

Without the picture check, an AI image with its metadata stripped that nobody labeled or hashtagged gets through. The picture check is for exactly those.

## The picture check

Turning it on downloads an 89 MB model (OpenAI's CLIP ViT-B/32, the int8 ONNX copy at `Xenova/clip-vit-base-patch32`) from Hugging Face once. The download is pinned to one revision and checked against a SHA-256 hash. It runs on your computer in WebAssembly, about a quarter second per picture. CLIP turns each picture into 512 numbers, and a small classifier (`extension/src/vision-weights.json`) decides from those whether it looks AI-made. That classifier was trained on hand-sorted examples of real Facebook slop and real posts. **How sure before hiding** in Settings sets the cutoff (default 70%). Videos always need at least 90%, because the classifier was trained on still images.

Ready-made AI-image detectors did badly on flyers: one flagged half the human-made flyers, another missed half the AI ones. The comparison is in `eval/`.

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

This writes `extension/dist/chrome/`, `extension/dist/firefox/` and a zip for each.

**Chrome / Edge / Brave / Arc:** open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `extension/dist/chrome`.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `extension/dist/firefox/manifest.json`. A temporary add-on goes away when Firefox restarts. To keep it, sign the zip as an unlisted add-on at addons.mozilla.org (free, automatic) and install the signed `.xpi`. Or use Firefox Developer Edition with `xpinstall.signatures.required` set to `false`.

If Firefox didn't grant site access at install, the settings page opens with an **Allow on all sites** button.

## Privacy

To check an image, the extension downloads that image again from the server the page already loaded it from, without cookies: once per picture, whole if the picture check is on, or just the first 512 KB for the metadata check alone. Hosts known to strip metadata (Facebook's and Instagram's) aren't downloaded just for that. Nothing is sent to any other server. The only other download is the model, from Hugging Face, when you turn the picture check on. There are no analytics. Settings sync through your browser account.

Shared ratings are planned, and aren't in the extension yet. They'll be off until you turn them on, and will send only what you explicitly rate, as a hash and a vote. Nothing stored will identify you. Checking pictures will stay on your device, so no server learns what you look at. The design is in [docs/CROWD-API.md](docs/CROWD-API.md).

## Develop

| Folder | What's in it |
|---|---|
| `extension/` | The extension. `src/` is the source; `build.mjs` adds each browser's manifest. |
| `api/` | The server for shared ratings, which the extension doesn't call yet. |
| `eval/` | Scripts that compared detectors and train the picture classifier. `npm install` there, then `./get-models.sh`. |
| `brand/` | The logo. `extension/tools/make_icons.sh` makes the toolbar icons from it. |
| `test-images/` | Hand-sorted example pictures, **not in git**: they're real people's posts. The extension ships only their 512-number summaries. |

Paths below are inside `extension/` unless they start with `eval/`.

- `node --test test/meta.test.mjs` runs the metadata detector tests.
- `src/ort/` is onnxruntime-web (see `src/ort/VERSION`). `src/vision.js` runs the model. Chrome runs it in `offscreen.html`, because its background service worker can't. Firefox runs it in the background page.
- `eval/test-vision.html` runs `background.js` and `vision.js` in a browser, with the real model and stubbed extension APIs. It checks the scores match the Mac test and that ratings retrain the classifier. Serve the top folder with `python3 -m http.server 8767` and open `http://localhost:8767/eval/test-vision.html`.
- `test/live.html` is for the installed extension in a real browser: a plain page of your `test-images` examples. Serve the top folder on port 8767 and open `/extension/test/live.html`.
- `test/harness.html` runs the real content script on a fake feed. Serve `extension/` with `python3 -m http.server 8765` and open `http://localhost:8765/test/harness.html`.
- `tools/make_icons.sh` remakes `src/icons/` from `../brand/logo-1024.png`.

When a site changes its layout, update its entry in `SITES` at the top of `src/content.js`.

Working on the code, or an AI agent picking it up? Start with [CLAUDE.md](CLAUDE.md), then [docs/](docs/): architecture, testing, and the roadmap. What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

## License

The code is MIT, see [LICENSE](LICENSE). The logo and icons aren't: see [brand/README.md](brand/README.md). Built on:

- [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT, Microsoft), included in `extension/src/ort/`.
- [CLIP](https://github.com/openai/CLIP) ViT-B/32 (MIT, OpenAI), in the ONNX conversion by [Xenova](https://huggingface.co/Xenova/clip-vit-base-patch32). It's downloaded when you turn on the picture check, not included here.
