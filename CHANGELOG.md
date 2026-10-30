# Changelog

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
- Kevin's logo for all icons.
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
