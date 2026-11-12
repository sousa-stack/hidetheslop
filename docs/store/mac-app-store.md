# Mac App Store listing

What's in App Store Connect for Hide the Slop on the Mac. Written 2026-11-12 for version 1.11.0. Field limits are App Store Connect's. Copy says "you" and "your", like the extension.

**Status:** 1.11.0, build 202611121133, was submitted for review on 2026-11-12 with manual release, so an approved version waits for Kevin. The listing below is what was entered.

## App Information

| Field | Value |
|---|---|
| Name | Hide the Slop |
| Subtitle (30) | Hide AI slop as you browse |
| Category | Primary **Utilities**, secondary **Productivity** |
| Content rights | **No**: the app doesn't contain, show or access third-party content. The extension hides things on pages you visit, but republishes nothing, and the model is downloaded, not bundled |
| Age rating | **None** for every content category, and **No** for unrestricted web access, user-generated content, messaging, advertising, contests and parental controls, which gives **4+**. It works inside Safari and doesn't browse the web itself |
| Privacy policy URL | https://hidetheslop.com/privacy |

## Version 1.11.0

**Promotional text (170)**
> Hide the AI slop in your feed. It runs on your Mac, it's free and open source, and it never sends what you browse anywhere.

**Description (4,000)**
> Hide the Slop is a Safari extension that hides AI-generated posts, pictures and ads as you browse, so your feeds are back to things people made.
>
> What it hides
> • Posts the site itself labels as AI, like "AI info" on Facebook and Instagram.
> • Posts with AI hashtags, like #aiart and #midjourney.
> • Pictures carrying the hidden note AI tools leave inside the file.
> • Pictures your robot thinks are AI-made. Your robot is a small AI model that runs on your Mac. It's off until you turn it on, and it only looks: it never makes anything.
> • Pictures enough other people have flagged as AI, matched on your Mac against a list everyone downloads.
>
> Everything it hides leaves a thin bar with a Show button, so you can always look. When it gets one wrong, tell it: Show, then AI or Not AI. Each answer retrains your robot on your Mac.
>
> Your privacy
> • It works on your computer. There are no accounts, no analytics and no ads.
> • What you browse is never sent anywhere.
> • Sharing your ratings is off unless you turn it on. Then each picture you rate sends a fingerprint of the picture and your answer, never the picture, its web address or anything about you.
>
> On the pictures it was tested on, your robot caught 83 of 93 AI pictures and wrongly flagged 8 of 131 real ones. It makes mistakes, which is why nothing gets hidden without a way to see it.
>
> It's free and open source, at github.com/sousa-stack/hidetheslop. To turn it on after installing, open the Hide the Slop app and follow its three steps.

**Keywords (100):** `ai,ai art,ai images,ai detector,ai content,feed,filter,blocker,privacy,safari extension`

No other companies' names (Apple rejects them in keywords), and no words from the app's name, which search already covers.

| Field | Value |
|---|---|
| Support URL | https://hidetheslop.com |
| Marketing URL | https://hidetheslop.com |
| Copyright | 2026 Kevin Sousa |
| What's new | First release on the Mac App Store |
| Sign-in required | No |
| Review contact | Kevin Sousa, hello@hidetheslop.com, and his phone number, which stays out of the repo |

**Screenshots:** three, in `docs/store/screenshots/`. See "Screenshots" below.

## App Privacy

App Store Connect → the app → App Privacy → Get Started. Answer the same as the build's `PrivacyInfo.xcprivacy`.

- **Do you collect data?** Yes.
- **Type:** User Content → **Other User Content**. These are the ratings you choose to share: a fingerprint of a picture, your answer, and a code that lets you change your answer.
- **Linked to the user's identity?** No.
- **Used for tracking?** No.
- **Purpose:** App Functionality only. Not advertising, marketing, analytics or personalization.
- Nothing else is collected. The crowd list download sends nothing about you. Your IP address is seen in transit, as with any request, but isn't stored or logged, so it isn't "collected" in Apple's sense.

## Export compliance

The build says `ITSAppUsesNonExemptEncryption = NO`. If App Store Connect asks anyway: the app uses encryption only through the system's HTTPS and for authentication and integrity (a hash check on the model download, and a keyed hash for vote codes). It has no proprietary or non-standard encryption, so it's exempt. Don't describe it as "only HTTPS".

## Review notes

> Hide the Slop is a Safari Web Extension. Its Mac app only explains it and opens Safari's settings.
>
> To try it: open the app, click Open Safari Settings, tick Hide the Slop under Extensions, and allow it on every website. Then open any site with AI images, or https://hidetheslop.com, which has a demo.
>
> Why it needs every website (4.4.2): it hides AI posts wherever you browse, including in feeds whose sites can't be listed ahead of time. It reads pages to find AI labels and to check pictures. Nothing about the pages you visit is sent anywhere.
>
> Why it uses declarativeNetRequestWithHostAccess: one rule strips the extension's own origin header from requests to its server, api.hidetheslop.com, so that server never sees an identifier for your Safari.
>
> Network use: the optional picture model downloads once from models.hidetheslop.com. If you turn on sharing, your ratings go to api.hidetheslop.com as a fingerprint and an answer. A list of flagged fingerprints downloads every few hours. No accounts, no analytics, no ads.
>
> Source: https://github.com/sousa-stack/hidetheslop. Contact: hello@hidetheslop.com.

## Release

Under "Version Release", choose **Manually release this version**. The approved version waits until Kevin releases it on launch day.

## Pricing and availability

Free, in all 175 countries and regions, from release. China mainland is included, but Apple only distributes there with an ICP filing, which the app doesn't have, so expect it not to appear there.

The EU Digital Services Act trader status is set on the account (Business → Compliance), not on the app.

## Screenshots

1440×900 JPEG, no transparency and no Facebook branding, in `docs/store/screenshots/`:
1. `1-mac-app.jpg`: the Mac app window.
2. `2-demo-feed.jpg`: the demo on hidetheslop.com in Safari, with a picture hidden behind the bar.
3. `3-settings.jpg`: Settings, with your robot on.
