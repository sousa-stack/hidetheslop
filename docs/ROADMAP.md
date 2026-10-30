# Roadmap

The goal is a polished public launch: Chrome Web Store, Firefox Add-ons, Edge, and a site at **hidetheslop.com** (Kevin owns the domain). The repo stays private until launch, then goes public as a portfolio piece.

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
   - **How:** ratings exported from Settings → `cd eval && node probe.mjs --with <file> --export`, or image files dropped in `test-images/`. Report the new leave-one-out numbers.
2. **Retest in Firefox.** Kevin last used it in Firefox around version 1.1. Since then 1.2–1.5 changed the background page (the model, ratings, one download). Test with `about:debugging`, then `test/live.html`.
3. **Host the model ourselves.** Put a copy on hidetheslop.com, checked by the same SHA-256 hash, and fall back to Hugging Face. Right now one Hugging Face account going away breaks the picture check.
4. **Privacy policy page.** Both stores require one, because the extension reads every site. The truth is simple:
   - Pictures are re-downloaded from where the page got them, without cookies.
   - The model comes from Hugging Face (or our mirror).
   - Nothing is sent anywhere else, and there are no analytics.

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

## The website

One static page on Cloudflare Pages or GitHub Pages, with no tracking:
- an install button that detects the visitor's browser
- a before-and-after feed demo
- how it works
- honest accuracy numbers
- the privacy promise
- an FAQ
- links to GitHub and donations
- the privacy policy, and the model mirror from item 3

## After launch: ideas

- **Shared ratings:** people opt in to send their rating embeddings (never pictures or URLs), and a small server retrains a shared classifier every week. It needs protection against people sending bad ratings on purpose. This is the most promising thing to charge for, since free users get the shipped model and paid users get weekly updates.
- **iPhone:** a Safari Web Extension, the same code wrapped by Xcode, sold as a $2–5 app. iPhone extensions get little memory, so the 89 MB model probably won't fit. Test Apple's MobileCLIP-S0 (about 12 MB) with the same eval, and check its license first, because it isn't a standard open-source one. iOS can't filter inside the Facebook or Instagram apps, only in Safari.
- **Android:** the Firefox build works in Firefox for Android once it's listed on Firefox Add-ons. Skip a native app that filters other apps, because Play Store rules make it risky.
- **Moderation tools:** a Discord bot, an API for group admins and moderators, or a Bluesky labeler built on the same model.
- **Money:** start with donations (GitHub Sponsors or Ko-fi) and the paid iPhone app. Add a subscription only once the shared model exists. No ads.
