# Safari on the Mac App Store

Written 2026-11-12, from research into Apple's current pages. Kevin has a paid developer account and no other Safari testers, so the plan is to submit straight to the Mac App Store and hold the release until launch. Some of Apple's pages wouldn't load, and claims from those are marked **unconfirmed**.

## What Apple says (confirmed from its pages)

- **Guideline 4.4:** an app that carries an extension "should include some functionality, such as help screens and settings interfaces where possible". 4.4.2: a Safari extension "should not claim access to more websites than strictly necessary". So the container app needs real help text, a link to the privacy policy (5.1.1(i)) and the button that opens Safari's Extensions settings, and the review notes should explain why it needs every site: it hides AI posts wherever you browse.
- **Whether a minimal "turn it on in Safari" app passes 4.2 (minimum functionality)** isn't settled on any Apple page. Make the app genuinely useful: what it does, how to turn it on, how sharing works, and links to Settings and the privacy policy.
- **Certificates:** Mac App Store builds need **Mac App Distribution** (or Apple Distribution) and **Mac Installer Distribution**. Kevin's Apple Development and Developer ID identities aren't valid for the store. Xcode's automatic signing, or Kevin in the developer portal, can create them.
- **Screenshots:** 16:10 (1280×800, 1440×900, 2560×1600 or 2880×1800), 1 to 10 of them, PNG or JPEG without alpha.
- **App Privacy:** "collected" means sent off the device and kept longer than needed to answer the request. On-device work, and an IP address that isn't stored or logged, aren't collection. Shared ratings are collected: likely "Other User Content" or "Product Interaction", for App Functionality, not linked to you, no tracking. The crowd list download collects nothing.
- **Review times:** half of submissions within 24 hours, 90% within 48.
- **TestFlight works on macOS,** with a 90-day build expiry. Internal testers, up to 100, need no review. Whether it handles an app carrying a Safari extension isn't stated.
- **Unlisted distribution exists:** submit as public, note it in Review Notes, then send Apple's request form. Once approved, the app is reachable only by link. Whether macOS qualifies isn't stated.

## Unconfirmed

- **Manual release:** an approved build waits in "Pending Developer Release" until Kevin releases it. That's how the release gets held for launch.
- **Export compliance:** set `ITSAppUsesNonExemptEncryption` to `NO` in both Info.plists, because it only uses HTTPS.
- **Privacy manifest:** a `PrivacyInfo.xcprivacy` may be needed in the app and the extension if they use required-reason APIs. Add one if the upload warns with ITMS-91053.
- **Apple's Safari-specific distribution page** didn't load. Read it before submitting.

## Steps

1. **Developer portal (Kevin, or Xcode's automatic signing):** register App IDs `com.hidetheslop.app` and `com.hidetheslop.app.extension`, plus the distribution certificates and Mac App Store provisioning profiles.
2. **The app (Xcode):**
   - help text, the privacy policy link and the Open Safari Settings button
   - `ITSAppUsesNonExemptEncryption`
   - a privacy manifest if needed
   - a version and build number
3. **App Store Connect (Kevin):** New App → macOS, the bundle ID, a SKU and the name **Hide the Slop**.
4. **Archive and upload (Xcode or the command line):** `xcodebuild archive`, then `-exportArchive` with `method app-store-connect`, then Transporter or `altool`.
5. **Listing (Kevin, drafted together):**
   - description, keywords and category (Utilities or Productivity)
   - support URL and privacy policy URL
   - screenshots at 2880×1800, with no Facebook branding, as the roadmap says for every store
   - App Privacy answers, the age rating, pricing Free, export compliance, and review notes covering how to turn it on, why it needs every site, and what's sent
6. **Choose manual release,** then submit for review.
7. **Optionally,** ask for unlisted distribution, after confirming with Apple Developer Support that macOS qualifies.

## Not decided yet

When to submit relative to the Chrome and Firefox listings, and whether to ask for unlisted distribution or just hold a public release until launch day.
