# Chrome, Edge and Firefox listings

What goes into the Chrome Web Store, Microsoft Edge Add-ons and addons.mozilla.org (AMO) for Hide the Slop. Written 2026-11-12 for version 1.11.0, in the voice of [mac-app-store.md](mac-app-store.md): "you" and "your", "your robot", and the same tested numbers. Each field gives its limit from the store's docs (or says the docs don't give one) and the length of the text below it, counted in characters with line breaks included. Sources are at the end.

Edge uses the Chrome zip (`dist/hidetheslop-chrome-1.11.0.zip`); Firefox uses `dist/hidetheslop-firefox-1.11.0.zip`.

**Status:** Chrome submitted on 2026-11-12. Edge is put off: Edge can install from the Chrome Web Store, so the site's Edge button points at the Chrome listing until Edge has its own. Firefox submitted on 2026-11-12, with its icon, screenshots, homepage and tags. Record each item ID and listing URL here as it's created:

| Store | Item ID | Listing URL | Live |
|---|---|---|---|
| Chrome Web Store | ijoplnhgjdnkohkifananhbeonndcnll | https://chromewebstore.google.com/detail/ijoplnhgjdnkohkifananhbeonndcnll | Submitted 2026-11-12, in review |
| Edge Add-ons | | | Put off on 2026-11-12: Partner Center's sign-up was blocked by Microsoft's risk check. Edge installs from the Chrome listing until then |
| AMO | hidetheslop@hidetheslop.com | https://addons.mozilla.org/firefox/addon/hide-the-slop/ | Submitted 2026-11-12, awaiting review. Listed for Firefox, and for Firefox for Android because the manifest names an Android minimum |

## Two things to settle before uploading

- **Chrome's summary and Edge's short description are the manifest's `description`.** Neither store has a separate field you can type into: Chrome shows the manifest's `description` as the summary (132 characters at most), and Edge's short description is read-only and comes from the same place. Today it's `Hides AI-generated images, posts and ads: site AI labels, AI hashtags, and AI metadata inside images.` (101 characters), which fits but leaves out your robot and the crowd's list. The suggested summary below needs `description` changed in `extension/build.mjs` and the 1.11.0 zips rebuilt, the same way `minimum_chrome_version` went into 1.11.0. If you'd rather not, the current one is fine to ship.
- **The demo's flyers carry the AI note (2026-11-12).** A fresh install's robot scores Robot Rock 50.8% and Sunset Jazz 83.1%, so at 70% it would hide only one. `site/tools/mark-ai.mjs` writes the IPTC `trainedAlgorithmicMedia` note into both files, so a fresh install hides both with nothing turned on, which a headless Chrome check confirmed. Chrome's review got the older steps, which say only Sunset Jazz is hidden once the robot is on; the reviewer will see more hidden, not less.

## Chrome Web Store

### Store listing tab

**Name** (from the manifest; the store doesn't take it separately): `Hide the Slop`

**Summary** (132; from the manifest's `description`). Suggested, 128:

```text
Hide the AI slop in your feed. It runs on your computer, it's free and open source, and it never sends what you browse anywhere.
```

**Description** (Google's docs give no limit; plain text, no formatting). 2,101:

```text
Hide the Slop hides AI-generated posts, pictures and ads as you browse, so your feeds are back to things people made.

What it hides
• Posts the site itself labels as AI, like "AI info" on Facebook and Instagram.
• Posts with AI hashtags, like #aiart and #midjourney.
• Pictures carrying the hidden note AI tools leave inside the file.
• Pictures your robot thinks are AI-made. Your robot is a small AI model that runs on your computer. It's off until you turn it on, and it only looks: it never makes anything.
• Pictures enough other people have flagged as AI, matched on your computer against a list everyone downloads.
• Anything you choose: right-click a picture to hide it as AI slop, or to always hide posts from that account.
• Every sponsored post, if you turn that on.

Everything it hides leaves a thin bar with a Show button, so you can always look. When it gets one wrong, tell it: Show, then AI or Not AI. Each answer retrains your robot on your computer.

Your privacy
• It works on your computer. There are no accounts, no analytics and no ads.
• What you browse is never sent anywhere.
• To check a picture, it downloads that picture again from the site that showed it to you, without your cookies.
• Your robot is an 89 MB download, once, when you turn it on. While it's on, the crowd's list downloads every few hours, and everyone gets the same list.
• Sharing your ratings is off unless you turn it on. Then each picture you rate sends a fingerprint of the picture and your answer, never the picture, its web address or anything about you.

Why it asks to read and change your data on all websites: it hides AI posts wherever you browse, including inside ads, and feeds can't be listed ahead of time. It reads pages on your computer to find AI labels and to check pictures.

On the pictures it was tested on, your robot caught 83 of 93 AI pictures and wrongly flagged 8 of 131 real ones. It makes mistakes, which is why nothing gets hidden without a way to see it.

It's free and open source, at github.com/sousa-stack/hidetheslop. The privacy policy is at hidetheslop.com/privacy.
```

| Field | Value |
|---|---|
| Category | **Social Media & Networking** ("extensions designed to enhance social media platforms"). The other honest fit is **Functionality & UI**. Not Privacy & Security: it isn't a privacy tool, even though it's private |
| Language | **English** |
| Official URL | `hidetheslop.com`, once it's verified in Google Search Console from this dropdown. Optional |
| Homepage URL | https://hidetheslop.com |
| Support URL | https://hidetheslop.com |
| Mature content | Off |
| Screenshots, promo tile | See "Screenshots and images" below |

### Privacy practices tab

Google's docs don't give limits for these boxes. Each text below is under 1,000 characters; if the dashboard's counter says otherwise, shorten from the end.

**Single purpose description.** 448:

```text
Hide the Slop hides AI-generated content on the web pages you visit: posts, pictures, videos and ads that the site labels as AI, that carry AI hashtags or an AI note inside the file, or that look AI-made. Everything else it does serves that: its settings, an optional picture model that runs on your computer, your own ratings that correct it, and an optional shared list of pictures other people confirmed as AI, which is matched on your computer.
```

**Permission justifications**

`storage`. 449:

```text
Keeps your settings (which checks are on, your blocklist of accounts and words, paused sites) in storage.sync, so they follow your browser account. Keeps the rest in storage.local: your ratings of pictures, the addresses of pictures you hid by hand, your retrained picture classifier, the crowd's list of AI picture fingerprints while it's on, and, only if you turn on sharing, the ratings waiting to send and the secret that makes their vote codes.
```

`contextMenus`. 241:

```text
Adds two items to the right-click menu: "Hide this as AI slop", which hides the post or picture you clicked and counts as a rating for your picture model, and "Always hide posts from this account…", which adds that account to your blocklist.
```

`alarms`. 408:

```text
Two timers. One refreshes the crowd's list of AI picture fingerprints every 6 hours, and does nothing unless the picture check and the list are on. The other checks hourly for ratings waiting to send, and does nothing unless you've turned on sharing. Timers instead of sending on activity mean the list and your ratings never go out in step with your browsing: ratings leave 1 to 6 hours after you make them.
```

`offscreen`. 434:

```text
Chrome's extension service worker can't run the picture model, so it runs in an offscreen document (offscreen.html, reason WORKERS) using the onnxruntime-web WebAssembly bundled in the package. The document shows nothing: it only scores pictures for how AI-made they look and makes the fingerprints the crowd's list is matched on. It's created when your picture model has a picture to look at, which only happens after you turn it on.
```

Host permissions (`http://*/*`, `https://*/*`). 680:

```text
It hides AI posts and pictures wherever you browse, including feeds and ad frames on sites that can't be listed ahead of time, so the content script runs on every page. It reads each page on your computer to find the site's own AI labels and AI hashtags, and to look at pictures. Host access also lets it download a picture again, without cookies, from the server the page already loaded it from, to read the AI note inside the file and, if you've turned on the picture check, to score it. The same access reaches its own servers: the model at models.hidetheslop.com and, while it's on, the crowd's list at api.hidetheslop.com. Nothing about the pages you visit is sent to anyone.
```

**Are you using remote code?** Choose **No, I am not using remote code.** If a box asks why, 553:

```text
All JavaScript and WebAssembly is in the package, and nothing is evaluated from strings. The picture model is data, not code: an 89 MB ONNX file of CLIP ViT-B/32 that downloads once, when you turn the picture check on, from models.hidetheslop.com (or the same file, pinned to one revision, from Hugging Face if that copy is down). It's rejected unless its size and SHA-256 match the values fixed in vision.js. The bundled onnxruntime-web 1.31.1 runs it. The content security policy's 'wasm-unsafe-eval' is only there so that bundled WebAssembly can run.
```

**Data usage.** Google's docs don't list the categories; the names here are the dashboard's, so match them on the form.

- Tick **Website content** only. Shared ratings are perceptual-hash fingerprints of pictures on pages you visit, plus your answer, and only if you turn sharing on. Once 3 or more installs have rated the same picture, the server can also ask for the 512 numbers that describe it, which is derived from the same picture. This matches the Firefox manifest's optional `websiteContent`.
- Leave everything else unticked: no personally identifiable information, health, financial, authentication, personal communications, location, web history or user activity. Nothing ties a rating to you, the pictures' addresses and pages are never sent, and your IP address is seen in transit but not stored or logged.
- Tick all three certifications. The wording is the dashboard's, so check it on the form:
  - I do not sell or transfer user data to third parties, outside of the approved use cases.
  - I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  - I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://hidetheslop.com/privacy

The Limited Use policy also asks for "an affirmative statement" on a site about the extension that its use of data complies with Limited Use. The privacy policy says so under "Selling data" since 2026-11-12.

### Account

- **Publisher name:** Hide the Slop.
- **EU trader status:** **Non-trader**, as on Apple. It's free, sells nothing and has no ads. Google leaves the call to you; a trader has to publish a phone number and address on the listing.
- **Contact email:** hello@hidetheslop.com. It can't be changed later.

### Test instructions tab

No account is needed, so leave the username and password empty. Additional instructions, 1,637 (Google's docs give no limit):

```text
No account or sign-in is needed.

1. Install it. A welcome page opens; it has a demo of the hover button.
2. Open https://hidetheslop.com and scroll to "Try it". Both AI-made flyers are hidden straight away, with nothing turned on: their files carry the IPTC note AI tools leave inside a file, and the extension reads it. The dog is a real photo and stays.
3. On any page with pictures, right-click a picture and choose "Hide this as AI slop". Its post is hidden behind a thin bar with a Show button. Show brings it back.
4. Rest the mouse on a big picture for half a second: a "Hide slop" button appears in its corner and does the same.
5. To try the picture check: click the toolbar icon, open Settings, and under Pictures turn on "Hide AI pictures nobody labeled" (your robot). It downloads an 89 MB model once from models.hidetheslop.com, then scores pictures on your computer on any site, and hides those it's at least 70% sure are AI-made.
6. Hiding posts by the site's own AI labels and AI hashtags works on Facebook, Instagram, Threads, TikTok, YouTube, Pinterest, X, Reddit and LinkedIn feeds, which need their own accounts.

Why every site: it hides AI posts wherever you browse, including in ad frames and feeds that can't be listed ahead of time. It reads pages on your computer. Nothing about the pages you visit is sent anywhere.

Network use: pictures are downloaded again, without cookies, from the site that showed them. The model downloads once when you turn the robot on. While the robot is on, the crowd's list of AI picture fingerprints downloads from api.hidetheslop.com every few hours. Only if you turn on sharing in Settings do your ratings go to api.hidetheslop.com, as a picture fingerprint and your answer.

Source: https://github.com/sousa-stack/hidetheslop. Contact: hello@hidetheslop.com.
```

## Microsoft Edge Add-ons

Same zip as Chrome. Partner Center's pages, in order: Availability, Properties, Privacy, Store listings, then Notes for certification on Publish.

**Availability:** visibility **Public**, all markets.

**Properties**

| Field | Value |
|---|---|
| Category | **Social**, if the dropdown has it; otherwise **Productivity**. Microsoft's docs don't publish the list, so pick from the dropdown |
| Website | https://hidetheslop.com |
| Support contact detail | hello@hidetheslop.com |
| Mature content | Unticked |

**Privacy.** Partner Center now has the same sections as Chrome's Privacy practices tab: single purpose, a justification for each permission, remote code, data usage with its certifications, and the privacy policy URL. Paste the Chrome texts above unchanged, tick the same boxes (Website content only, and every certification, checking the wording on the form), and use https://hidetheslop.com/privacy.

**Store listing, English**

**Extension name** (read-only, from the manifest): `Hide the Slop`

**Short description** (read-only, from the manifest's `description`): whatever the zip says. See "Two things to settle".

**Description** (250 to 10,000): paste Chrome's description above unchanged (2,101).

**Search terms** (at most 7 terms, 30 characters each, 21 words in all; not shown to people). 7 terms, 18 words, the longest 17 characters:

```text
AI slop
AI image detector
hide AI images
AI art blocker
AI content filter
AI generated
feed filter
```

No other companies' names, and nothing from the name, which search already covers.

**Extension logo, screenshots, promo tile:** see "Screenshots and images".

**Notes for certification** (Microsoft's docs give no limit): paste Chrome's test instructions above unchanged (1,637).

## Firefox (addons.mozilla.org)

Upload `dist/hidetheslop-firefox-1.11.0.zip` as **On this site** (listed). For compatibility, tick **Firefox** only. The manifest has a `gecko_android` minimum, but it hasn't been tested on Firefox for Android, so leave Android off until it has.

**Name** (from the manifest): `Hide the Slop`

**Add-on URL:** `hide-the-slop` (free on 2026-11-12: AMO's API answered 404 for it).

**Summary** (250; AMO fills it from the manifest, and it can be edited). 241:

```text
Hides AI-generated posts, pictures and ads as you browse: posts the site labels as AI, AI hashtags, and pictures with an AI note in the file or that your robot thinks look AI-made. It runs on your computer, with no accounts and no analytics.
```

**Description** (no limit given). AMO takes a small set of Markdown: bold, italic, monospace, links, abbreviations, code blocks, blockquotes and lists. No HTML, and no headings, so section titles are bold. 2,220:

```text
Hide the Slop hides AI-generated posts, pictures and ads as you browse, so your feeds are back to things people made.

**What it hides**

- Posts the site itself labels as AI, like "AI info" on Facebook and Instagram.
- Posts with AI hashtags, like #aiart and #midjourney.
- Pictures carrying the hidden note AI tools leave inside the file.
- Pictures your robot thinks are AI-made. Your robot is a small AI model that runs on your computer. It's off until you turn it on, and it only looks: it never makes anything.
- Pictures enough other people have flagged as AI, matched on your computer against a list everyone downloads.
- Anything you choose: right-click a picture to hide it as AI slop, or to always hide posts from that account.
- Every sponsored post, if you turn that on.

Everything it hides leaves a thin bar with a Show button, so you can always look. When it gets one wrong, tell it: Show, then AI or Not AI. Each answer retrains your robot on your computer.

**Your privacy**

- It works on your computer. There are no accounts, no analytics and no ads.
- What you browse is never sent anywhere.
- To check a picture, it downloads that picture again from the site that showed it to you, without your cookies.
- Your robot is an 89 MB download, once, when you turn it on. While it's on, the crowd's list downloads every few hours, and everyone gets the same list.
- Sharing your ratings is off unless you turn it on, and Firefox asks you too. Then each picture you rate sends a fingerprint of the picture and your answer, never the picture, its web address or anything about you.

**Why it needs every website**

It hides AI posts wherever you browse, including inside ads, and feeds can't be listed ahead of time. It reads pages on your computer to find AI labels and to check pictures.

**How well it works**

On the pictures it was tested on, your robot caught 83 of 93 AI pictures and wrongly flagged 8 of 131 real ones. It makes mistakes, which is why nothing gets hidden without a way to see it.

It's free and open source, at [github.com/sousa-stack/hidetheslop](https://github.com/sousa-stack/hidetheslop). The full privacy policy is at [hidetheslop.com/privacy](https://hidetheslop.com/privacy).
```

| Field | Value |
|---|---|
| Categories (up to 2) | **Social & Communication** and **Photos, Music & Videos**, from AMO's current list. Not Privacy & Security, for the same reason as on Chrome |
| Tags | `content blocker`, `social media`, `facebook`, `reddit`, `pinterest`, `youtube`, `twitter`. AMO only takes tags from its own fixed list, which has no Instagram, TikTok or "AI" tag |
| Homepage | https://hidetheslop.com |
| Contributions URL | https://buymeacoffee.com/sousastack, the same link as the site and Settings |
| Support email | hello@hidetheslop.com |
| Support website | https://hidetheslop.com |
| License | **MIT** (pick it from the list; no custom text) |
| Requires payment, non-free services | No |
| Experimental | No |

**Privacy policy.** Mozilla no longer requires the policy to live on AMO and encourages linking to your own. AMO's field takes text rather than a URL, so paste this short version, which points at the full one. 595:

```text
Hide the Slop works on your computer. It has no accounts, no analytics and no ads, and it doesn't send what you browse to anyone.

Sharing your ratings is optional, off until you turn it on, and Firefox asks you too. With it on, each picture you rate sends a fingerprint of the picture, your answer and a vote code to api.hidetheslop.com, 1 to 6 hours later. The picture, its web address, the page and any ID for you are never sent. Nothing is sold.

The full policy, including what's downloaded and what's kept on your computer, is at [hidetheslop.com/privacy](https://hidetheslop.com/privacy).
```

**Data collection** (from the manifest, nothing to type): required `none`, optional `websiteContent`. Firefox shows no data collection at install, and asks for `websiteContent` when you turn on sharing in Settings or on the welcome page.

### Notes for Reviewers

AMO's form caps this at 3,000 characters (its docs don't say; the form does). 2,306:

```text
Source: https://github.com/sousa-stack/hidetheslop (MIT), in extension/. build.mjs only copies src/ and writes manifest.json: no bundler or minifier, so no source upload is needed.

ort/ is onnxruntime-web 1.31.1 (MIT), unmodified: byte-for-byte package/dist/ of the npm package (SHA-256 checked 2026-11-12).
- ort.wasm.min.js b8a78c408c40da65fdc8ba0846f7b2948e92a4c6d6b23cc8e4165e428ad95443
- ort-wasm-simd-threaded.mjs 30ed0b5cd1182ede931fea448afb567d4dc705ec957af09f108a2be5f770dac3
- ort-wasm-simd-threaded.wasm 4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d
https://www.npmjs.com/package/onnxruntime-web/v/1.31.1
It runs a picture model that is data, not code: an 89 MB ONNX file downloaded once, only when the picture check is turned on, from models.hidetheslop.com (or Hugging Face, pinned), rejected unless its SHA-256 matches vision.js. 'wasm-unsafe-eval' is only for this bundled WebAssembly.

Validator warnings: the 3 innerHTML ones (content.js 270, 296, 704) set fixed markup from the file inside the extension's own shadow roots; page text goes in through textContent. The import() one is inside the unmodified ort.wasm.min.js.

Why every site: it hides AI posts wherever you browse, including ad frames and feeds that can't be listed ahead of time. Pages are read locally.

What's sent:
- The model, once, when the picture check is turned on.
- While it's on, the crowd's list of AI picture fingerprints from api.hidetheslop.com every few hours; the same list for everyone, matched locally.
- Only with sharing on (optional websiteContent): each rating sends a perceptual hash, the answer and a per-picture vote code, 1 to 6 hours later. Never the picture, its URL, the page or an ID.
- origin-rules.json strips the moz-extension:// Origin from requests to its own server, so it can't act as a voter ID.

To test (no account):
1. Open https://hidetheslop.com, scroll to "Try it": both AI flyers are hidden with nothing turned on, because their files carry the IPTC trainedAlgorithmicMedia note. The dog stays.
2. Right-click any picture, "Hide this as AI slop": it's hidden behind a bar with Show.
3. Settings, Pictures: turn on "Hide AI pictures nobody labeled" to try the picture model.
4. Turn on sharing: Firefox asks for websiteContent.

Contact: hello@hidetheslop.com
```

## Where the numbers are

Every store counts installs itself, so the extension stays silent: no install pings, nothing new sent.

| Where | What it shows | How to get there |
|---|---|---|
| **Chrome** | Installs and uninstalls per day, by country, language and OS. Weekly users, by country, language, OS and **item version**. Version is only in the users report | Developer Dashboard, the item, Analytics. Pick the period from "Date range" |
| **Firefox** | Daily users, broken down by version, language, platform and Firefox version, and downloads from AMO, including by `utm_` source and campaign. Private to the add-on's authors | AMO, Manage My Submissions, then Statistics under the add-on |
| **Edge** | Weekly users, enabled vs. disabled, installs per day and listing page views, filtered by region, OS and language, for the last month, 3 or 6 months, or all time. Exports to CSV. Microsoft's docs show **no version breakdown** | Partner Center, the extension, Extension overview, Analytics |
| **Mac App Store** | First-time downloads, redownloads and updates. Per-version counts are in the App Downloads report, which has an App Version field | App Store Connect, Apps, Hide the Slop, Analytics; the reports through Analytics Reports |
| **GitHub releases** | Downloads of each zip attached to a release, all time | `gh api repos/sousa-stack/hidetheslop/releases --jq '.[] \| .tag_name as $t \| .assets[] \| "\($t) \(.name) \(.download_count)"'`, after checking `gh api user --jq .login` says `sousa-stack` |

## Screenshots and images

The images are in [`browser/`](browser/), made from real screenshots of the extension in the poster look, with no Facebook branding. Show Kevin each one before it's uploaded.

| Store | What it takes | From `browser/` |
|---|---|---|
| Chrome | 1 to 5 screenshots at 1280×800, a 440×280 small promo tile (optional), a 128×128 icon (from the zip) | The five screenshots and the small promo tile. No marquee |
| Edge | Up to 6 screenshots at 1280×800 or 640×480, a 1:1 logo (300×300 recommended, 128×128 at least), a 440×280 small tile (optional) | The five screenshots, the Edge logo and the small promo tile |
| AMO | Screenshots, 1280×800 recommended. The icon comes from the zip | The five screenshots |

## Sources

Chrome Web Store
- Listing fields: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Summary (132 characters) and descriptions: https://developer.chrome.com/docs/webstore/best-listing
- Manifest `description` (132 characters): https://developer.chrome.com/docs/extensions/reference/manifest/description
- Categories: https://developer.chrome.com/docs/webstore/best-practices
- Privacy practices tab: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use
- User data FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Test instructions: https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions
- Trader and non-trader: https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure and https://developer.chrome.com/docs/webstore/program-policies/trader-verification-faq
- Metrics: https://developer.chrome.com/docs/webstore/metrics

Microsoft Edge Add-ons
- Submission, including Privacy, description limits and search terms: https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension
- Analytics: https://learn.microsoft.com/microsoft-edge/extensions/publish/extensions-analytics

addons.mozilla.org
- Listing fields, summary (250), categories (up to 2): https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/
- Markdown in descriptions: https://blog.mozilla.org/addons/2025/03/03/markdown/
- Categories (live list): https://addons.mozilla.org/api/v5/addons/categories/
- Tags (live list): https://addons.mozilla.org/api/v5/addons/tags/
- Source code submission: https://extensionworkshop.com/documentation/publish/source-code-submission/
- Third-party libraries: https://extensionworkshop.com/documentation/publish/third-party-library-usage/
- Add-on policies: https://extensionworkshop.com/documentation/publish/add-on-policies/ and the version taking effect 2026-12-01: https://extensionworkshop.com/documentation/publish/add-on-policies-preview-2026-12/
- Built-in data consent (`websiteContent`): https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- Statistics: https://extensionworkshop.com/documentation/manage/monitoring-extension-usage-statistics/

Apple and GitHub
- App Store Connect metrics: https://developer.apple.com/help/app-store-connect/reference/app-metrics
- App Downloads report: https://developer.apple.com/documentation/analytics-reports/app-download
- Release asset download counts: https://docs.github.com/en/rest/releases/assets
