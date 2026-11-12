# eval

Scripts that picked the picture-check approach and that train the classifier the extension ships. Set up once with:

```bash
cd eval
npm install         # onnxruntime-node and sharp, about 490 MB
./get-models.sh     # the CLIP models, about 380 MB, into models/
```

The example pictures are in `../test-images/ai` and `../test-images/real`. They're kept out of git because they're real people's posts, so the numbers below can't be reproduced from a clone of this repo.

| Script | What it does |
|---|---|
| `probe.mjs` | The main one. It turns every example into a CLIP embedding (cached in `embeddings-*.json`) and trains `../extension/src/train.js` on all but one, scoring the one left out, for every image. It prints accuracy at several cutoffs and lists the mistakes. `--with ratings.json` (repeatable) adds ratings exported from the extension's Settings. `--export` writes `vision-weights.json` and `vision-examples.json` into the extension. |
| `score.mjs <image>…` | Scores image files with the shipped weights, to check why something was or wasn't hidden. |
| `browser-check.mjs` | Writes `browser-check.json`, the expected score for every example, for `test-vision.html`. |
| `test-vision.html` | Runs the extension's real background code and model in a browser; see `../docs/TESTING.md`. |
| `quantize.mjs` | Picks the scale for the int8 vectors sent to `/v1/embeddings`, by rerunning leave-one-out on the shipped embeddings at each scale. Results are in `../docs/CROWD-API.md`. |
| `vote-check.mjs` | Runs the real extension in throwaway headless Chrome and Firefox against a local server, and prints what a vote really sends. See `../docs/TESTING.md`. |
| `phash-of.mjs <file>` | Prints a picture's hash the way the extension works it out, with the real `phash.js` in headless Chrome for Testing, so a reported picture can be blocked on the server. The runbook is in `../docs/CROWD-API.md`. |
| `sheet.mjs out.jpg <dir> <prefix>…` | A labelled thumbnail grid of chosen images, for eyeballing mistakes. |
| `compare.mjs` | The original comparison of three ready-made detectors, kept as a record. Their models were deleted; the comment at the top says how to get them back. |

## What we found (November 2026, 224 unique images: 93 AI, 131 real)

Each image was scored by a classifier that hadn't seen it, at a 70% cutoff. Duplicates were removed first, because a copy of the test picture in the training set inflates the score. The training settings were tuned on these same images, so treat these numbers as slightly optimistic.

| Approach | AI caught | Real wrongly flagged |
|---|---|---|
| **CLIP ViT-B/32 + logistic regression on our examples** (shipped) | **83 / 93** | **8 / 131** |
| CLIP ViT-L/14 + the same | 81 / 93 | 6 / 131 (and about 13× slower) |
| SigLIP AI-vs-human detector (Ateeqq) | 24 / 24 | 14 / 30 (flags nearly every flyer) |
| SwinV2 detector (haywoodsloan) | 12 / 24 | 4 / 30 (misses most AI flyers) |
| ViT detector (prithivMLmods) | scores everything about 80% | n/a |

The ready-made detectors were measured on an earlier set of 54 images. The model shipped before this retrain, trained on 57 images, caught 55 of 63 and flagged 8 of 86 on pictures it had never seen. Ready-made detectors learn "AI image versus photo", but most slop here is flyers, so what matters is the difference between a glossy AI flyer and a designed one. A general image model plus a classifier trained on our own examples handles that much better.

After retraining, run `probe.mjs` again and update these numbers, plus the ones in the top README.
