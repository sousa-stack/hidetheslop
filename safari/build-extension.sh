#!/bin/sh
# The Run Script phase of the extension target. Builds extension/dist/safari from the same
# source as Chrome and Firefox, then copies it into the extension's resources, so Xcode
# always ships the current build and there's no second copy of the code to drift.
#
# HTS_EXTENSION_DIR, set on the xcodebuild command line, copies that folder instead and
# skips the build. Only the local release-gate run uses it.
set -eu

REPO="$SRCROOT/.."
SOURCE="${HTS_EXTENSION_DIR:-}"
if [ -z "$SOURCE" ]; then
  # Xcode doesn't start Run Script phases with your shell's PATH, so node from nvm or
  # Homebrew has to be looked for.
  if ! command -v node >/dev/null 2>&1; then
    for dir in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
      [ -x "$dir/node" ] && PATH="$dir:$PATH"
    done
  fi
  command -v node >/dev/null 2>&1 || { echo "error: node isn't installed, or isn't where this script looks"; exit 1; }
  (cd "$REPO/extension" && node build.mjs safari)
  SOURCE="$REPO/extension/dist/safari"
fi

version="$(/usr/bin/plutil -extract version raw -o - "$SOURCE/manifest.json")"
if [ "$version" != "$MARKETING_VERSION" ]; then
  echo "error: the extension is $version but safari/Shared.xcconfig says MARKETING_VERSION = $MARKETING_VERSION"
  exit 1
fi

DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"
mkdir -p "$DEST"
# The privacy manifest gets there first, from Copy Bundle Resources, and the exclude keeps
# --delete from removing it. It's the only file there that isn't the web extension's.
rsync -a --delete --exclude PrivacyInfo.xcprivacy "$SOURCE/" "$DEST/"
echo "copied $SOURCE ($version) into the extension"
