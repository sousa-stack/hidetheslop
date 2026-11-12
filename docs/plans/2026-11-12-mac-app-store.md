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

## Build spec (2026-11-12)

Kevin chose to submit Safari to the Mac App Store now. Xcode on this Mac is signed in to his Apple account, so `xcodebuild -allowProvisioningUpdates` with automatic signing can register the bundle IDs and create the Mac App Store certificates and profiles. Only the App Store Connect record, the listing and pressing Submit need him.

**The app's window,** `safari/Hide the Slop/Resources/Base.lproj/Main.html`, `Style.css` and `Script.js`:
- Keep what's there: the on/off state, the three steps and **Open Safari Settings**.
- Add, for guideline 4.4 and 5.1.1(i), in the poster look with "you" copy:
  - a short "What it does": hides posts with AI labels and tags, and pictures your robot thinks are AI, with a Show bar on everything it hides
  - "How you teach it"
  - "Sharing is off unless you turn it on", in a sentence
  - links to the **Privacy policy**, the website, **Email a problem** (the same `mailto:` as Settings, with the version) and the source on GitHub
- Links must open in your default browser or email app, not inside the app's window. Handle navigation in `ViewController.swift`, through `WKNavigationDelegate` and `NSWorkspace.shared.open`, for `https:` and `mailto:` only.
- It stays one window, with no web fonts and nothing loaded from the network. The CSP stays `default-src 'self'`.

**The project:**
- `MARKETING_VERSION` must match `extension/build.mjs`'s version, which is 1.11.0 now. Rather than keeping two copies, have `build-extension.sh` or a build setting read it from `dist/safari/manifest.json`, or fail the build when they differ.
- `CURRENT_PROJECT_VERSION`, the build number, goes up with every upload. An upload script increments it, or takes it as an argument.
- `ITSAppUsesNonExemptEncryption = NO` in both Info.plists, because it only uses HTTPS.
- `LSApplicationCategoryType = public.app-category.utilities`.
- A `PrivacyInfo.xcprivacy` in the app and the extension: no tracking, no tracking domains; collected data only as the extension really does it (shared ratings, under Other User Content or the closest type, not linked to you, for App Functionality); and required-reason APIs only if the code actually uses them (`UserDefaults`, file timestamps and so on). Check what the code calls rather than guessing.
- Release builds use automatic signing with the team from `Local.xcconfig`. Debug builds keep working as they do now.

**Archive and upload,** in a new `safari/release.sh`:
- Build the extension, then `xcodebuild archive` (Release, `-allowProvisioningUpdates`).
- `xcodebuild -exportArchive` with an `ExportOptions.plist` (method `app-store-connect`, automatic signing, the team read from `Local.xcconfig` at run time and never written to a tracked file), with upload `destination` set where supported, so the export uploads it.
- Print the version and build number. Never print credentials.
- A `--no-upload` flag stops after exporting, for checking.

**Tests:**
- The existing extension tests.
- A Debug build that still installs and runs as now.
- A Release archive that builds, `codesign --verify` passes, and the exported package validates with `xcrun altool --validate-app` or the export's own check, if possible without an App Store Connect record.
- A screenshot of the new window for Kevin, at the window's real size, taken with `screencapture` on the opened app.
- The uploaded build appearing in App Store Connect needs Kevin's app record first.

### Changes after review (these override the build spec above)

- **Builds are broken today:** `Shared.xcconfig` says 1.10.0 and `build.mjs` says 1.11.0, and `build-extension.sh` rightly refuses the mismatch. Bump the xcconfig to 1.11.0. `release.sh` reads the version from `extension/dist/safari/manifest.json` and passes `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION=$(date +%Y%m%d%H%M)` on the `xcodebuild` command line, so no tracked file changes per upload, and the build number always goes up.
- **Signing:** both targets already use automatic signing, so Debug isn't affected. The archive is development-signed, and distribution signing happens at `-exportArchive`. ExportOptions has `method=app-store-connect`, `signingStyle=automatic`, `teamID` from `Local.xcconfig` at run time, `destination=upload` (or `export` with `--no-upload`) and `uploadSymbols=true`. Optional App Store Connect API key flags come from environment variables, as a fallback when the Xcode account can't be used. The first export creates the distribution certificates and profiles, and needs Kevin's Admin or Account Holder role.
- **Entitlements:** drop `ENABLE_OUTGOING_NETWORK_CONNECTIONS` from the app (it loads only local files and opens links through `NSWorkspace`), and drop `ENABLE_USER_SELECTED_FILES` from both targets. The extension's `fetch` runs in Safari's web-extension process, so it should need no network entitlement. Prove it with a vote and a list download from the signed Release build.
- **Privacy manifest:** the Swift code uses no required-reason APIs. Add a `PrivacyInfo.xcprivacy` to each target's Copy Bundle Resources, with `NSPrivacyTracking` false, no tracking domains, no accessed API types, and one collected type: `NSPrivacyCollectedDataTypeOtherUserContent`, not linked, not tracking, for App Functionality. App Store Connect gets the same answers.
- **Export compliance:** `ITSAppUsesNonExemptEncryption = NO`, because HMAC and hash checks are authentication and integrity uses, which are exempt. The review notes and questionnaire must not claim "only HTTPS".
- **Links in the window:** a `WKNavigationDelegate` `decidePolicyFor` allows the first `file:` load and `about:blank`. For `https:` and `mailto:` it cancels and calls `NSWorkspace.shared.open`, and it cancels anything else. Plain `<a href>`, without `target=_blank`. `ViewController` passes the version into the page for the email link.
- **Don't quit after Open Safari Settings,** because a reviewer can take that for a crash. Keep the window open. Test with the extension off, and with Safari not yet launched.
- **Review notes** explain why it needs all sites (4.4.2) and `declarativeNetRequestWithHostAccess`.
- Check the icon set has a real 1024×1024 image, and how "Hide the Slop Extension" reads in Safari's list.
