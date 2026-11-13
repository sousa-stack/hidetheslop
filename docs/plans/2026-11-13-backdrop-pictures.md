# Leave backdrop pictures alone

Written 2026-11-13. Kevin saw the "Hide slop" hover button appear over a site's background picture, which was a real photo and plainly not slop. It's the first change for the next store update, after Chrome and Firefox approve 1.11.0, so it ships together with whatever else is ready then.

## Why it happens

`pictureAt()` in `extension/src/content.js` walks `document.elementsFromPoint()` top-down and takes the first `<img>` or `<video>` big enough, skipping everything above it. Skipping is deliberate: Facebook and others lay transparent boxes (often an empty link) over their photos. But a hero or page backdrop is also an `<img>` under other boxes, with the headline, text and buttons drawn on top, so the walk passes straight through the text and offers the button on the photo behind it. CSS `background-image` is never considered, so that isn't the cause.

## The rule

A picture is a **backdrop** when, at the point being looked at, something above it that isn't its own ancestor carries content: visible text, or a link, button, input or heading with text or an accessible name. Facebook's overlays are empty boxes and empty links, so they still pass, and the button still appears on feed photos.

- New `isBackdrop(pic, x, y, above)`: `above` is the list of elements `elementsFromPoint` returned before `pic`. For each one that isn't an ancestor of `pic` and isn't the extension's own chip: if its `innerText.trim()` is non-empty, or it is (or contains, near the point) a visible `a`, `button`, `input`, `select`, `textarea` or `h1`–`h6`, the picture is a backdrop. Text is read from the element itself, not the page, so the cost stays at a handful of elements per mouse move (already throttled to one per 80 ms).
- `pictureAt()` returns `null` for a backdrop. Blurred pictures (`data-hidetheslop="hidden"`) keep getting their Show button even if they turn out to be backdrops, so nothing becomes impossible to show again.
- **Pointer between words:** over a hero's empty area the hit list still includes the hero's text wrapper, a non-ancestor sibling of the picture whose `innerText` isn't empty, so the button stays off across the whole hero, not just over the letters.

## The picture check too (recommended)

Your robot and the AI-note check also look at backdrops today. A false positive there would hide a site's header, which is worse than an unwanted button. So `checkImage()` runs the same test once per picture, at the picture's visible centre (`elementsFromPoint` at the middle of its on-screen box, when it's on screen; when it isn't, defer to when it scrolls in, as now). A backdrop is skipped by the robot and the crowd list, but the **AI-note (metadata) check still runs**, because a note inside the file is proof, not a guess, and hiding a marked AI backdrop is right. Pictures you hid yourself (`blockedImages`) still hide.

## Not in this

- CSS `background-image`: never looked at, and stays that way.
- Feed sites in `SITES`: their posts already pass, because the overlays are empty. The tests below prove it stays so.

## Tests

- `extension/test/harness.html` gets three new cases, each with a big picture:
  1. **hero:** an absolutely positioned `<img>` with `object-fit: cover`, a headline, paragraph and button laid on top in a sibling wrapper. Hovering the headline and an empty spot in the hero shows no button; the robot doesn't score it.
  2. **overlay:** Facebook-style, an empty `<a>` and an empty `<div>` stacked over the `<img>`. The button appears, as now.
  3. **caption over photo:** a photo whose small caption overlaps only its bottom edge. Hovering the top half shows the button; hovering the caption doesn't. Its centre is clear, so the robot still checks it.
- The existing harness expectations in `docs/TESTING.md` stay as they are.
- A real Chrome check: load the build, hover a site with a hero photo (the one Kevin saw, if he can name it, else any big landing page with a full-bleed photo and headline) and a Facebook feed photo.
- `CHANGELOG.md` under a new version, and `version` bumped in `extension/build.mjs` and `safari/Shared.xcconfig` when the release is cut, not now.

## Changes after review (these override the plan above)

A Sonnet review on 2026-11-13 found the hit-test rule too risky on real feeds: carousel arrows, mute and ALT buttons, duration badges, TikTok and Reels caption layers over every `<video>`, Facebook's aria-labelled photo links and its "+3" tiles would all lose the button. It also missed narrow headline columns and `pointer-events: none` text layers. So:

- **Feed sites are untouched.** The rule only runs when the page isn't one of the `SITES` (`site` is null). The reported bug is on ordinary sites, and feeds already have their own post rules.
- **Geometry, worked out once per picture,** cached in a `WeakMap`, never on each mouse move. On a non-feed page a picture is a backdrop when it's big (at least 60% of the viewport's width, or of its own scrolling container's) and either:
  - it's laid out as a backdrop: `position` absolute or fixed, or a negative `z-index`, or `object-fit: cover` filling a parent it doesn't decide the size of; or
  - a block of text sits on top of it: a non-ancestor sibling subtree (looking up to 4 ancestors) whose box overlaps the picture and whose `textContent` has at least 20 non-space characters, so "+3", "ALT" and "0:15" don't count.
- `<video>` counts the same way, for hero videos that autoplay muted on a loop without controls. A video with controls is never a backdrop.
- The cache is dropped when the window is resized.
- **The picture check is out of scope.** A wrong skip there silently turns off your robot for a real picture, which is worse than a stray button. If a backdrop ever gets hidden for real, that's a separate change.
- A blurred picture keeps its Show button whatever the rule says.

**Tests,** in `extension/test/harness.html`, on a page treated as a non-feed site, each with a big picture:
1. hero `<img>` (absolute, `object-fit: cover`) under a centred headline column narrower than the picture: no button anywhere on it, including its edges.
2. the same with the text layer at `pointer-events: none`: no button.
3. Facebook-style empty `<a aria-label="…">` and empty `<div>` stacked over an `<img>`: button.
4. a "+3" tile: button.
5. an article photo inside the page's flow, with a short caption under it: button.
6. a corner `<button>` inside a full-size wrapper over a photo: button.
And on the pretend-Instagram feed the harness already has, the existing hover expectations still hold.

**After the build (2026-11-13):** absolute position alone was dropped from "laid out as a backdrop", because sites like those built with Next.js place an article's main photo that way. Only `position: fixed` and a negative `z-index` count; heroes are caught by the text-on-top rule. `backdrop.html` gained case 5b for it. 31 of 31 points pass in Chrome for Testing 156 and Firefox 160, and harness.html's 14 states and 6 hovers are unchanged.
