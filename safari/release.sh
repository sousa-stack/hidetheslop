#!/bin/sh
# Archives the Safari app and sends it to App Store Connect: safari/release.sh
# With --no-upload it stops after exporting the signed package, for checking.
#
# The version comes from the built extension's manifest, and the build number is the date
# and time, both passed on the xcodebuild command line, so no tracked file changes for an
# upload and every build number is higher than the last.
#
# Signing is automatic. The archive is development-signed; -exportArchive re-signs it for
# the App Store, and the first export creates the distribution certificates and profiles
# through the Apple account Xcode is signed in to (that needs the Admin or Account Holder
# role). If Xcode's account can't be used, set HTS_ASC_KEY_PATH, HTS_ASC_KEY_ID and
# HTS_ASC_ISSUER_ID to an App Store Connect API key instead.
set -eu

cd "$(dirname "$0")"
SAFARI="$(pwd)"
REPO="$(cd .. && pwd)"

upload=yes
case "${1:-}" in
  "") ;;
  --no-upload) upload=no ;;
  *) echo "usage: safari/release.sh [--no-upload]" >&2; exit 2 ;;
esac

# The team ID stays in the git-ignored Local.xcconfig, and in the ExportOptions.plist made
# from it under build/, which git ignores too. It's never printed.
team="$(sed -n 's/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*\([A-Z0-9]*\).*/\1/p' Local.xcconfig 2>/dev/null | tail -n 1)"
[ -n "$team" ] || { echo "error: put your team ID in safari/Local.xcconfig (see Local.xcconfig.example)" >&2; exit 1; }

auth=""
if [ -n "${HTS_ASC_KEY_PATH:-}" ]; then
  : "${HTS_ASC_KEY_ID:?HTS_ASC_KEY_ID goes with HTS_ASC_KEY_PATH}" "${HTS_ASC_ISSUER_ID:?HTS_ASC_ISSUER_ID goes with HTS_ASC_KEY_PATH}"
  auth=yes
fi
# Run xcodebuild with the API key flags when there's a key, without echoing them.
xcb() {
  if [ -n "$auth" ]; then
    xcodebuild "$@" -authenticationKeyPath "$HTS_ASC_KEY_PATH" -authenticationKeyID "$HTS_ASC_KEY_ID" -authenticationKeyIssuerID "$HTS_ASC_ISSUER_ID"
  else
    xcodebuild "$@"
  fi
}

(cd "$REPO/extension" && node build.mjs safari)
version="$(/usr/bin/plutil -extract version raw -o - "$REPO/extension/dist/safari/manifest.json")"
build="$(date +%Y%m%d%H%M)"
echo "Hide the Slop $version, build $build"

out="$SAFARI/build/release/$version-$build"
archive="$out/Hide the Slop.xcarchive"
mkdir -p "$out"

xcb -project "Hide the Slop.xcodeproj" -scheme "Hide the Slop" -configuration Release \
  -destination "generic/platform=macOS" -archivePath "$archive" -allowProvisioningUpdates \
  MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build" archive

# manageAppVersionAndBuildNumber is off so the export keeps the numbers above instead of
# picking its own.
if [ "$upload" = yes ]; then destination=upload; else destination=export; fi
cat > "$out/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>$team</string>
	<key>destination</key>
	<string>$destination</string>
	<key>uploadSymbols</key>
	<true/>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
EOF

xcb -exportArchive -archivePath "$archive" -exportOptionsPlist "$out/ExportOptions.plist" \
  -exportPath "$out/export" -allowProvisioningUpdates

if [ "$upload" = yes ]; then
  echo "sent Hide the Slop $version ($build) to App Store Connect"
else
  echo "exported Hide the Slop $version ($build) to $out/export, not uploaded"
fi
