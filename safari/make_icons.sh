#!/bin/sh
# Makes the Mac app's icons from the logo, like extension/tools/make_icons.sh does for the
# extension: safari/make_icons.sh
set -e
cd "$(dirname "$0")"
set_dir="Hide the Slop/Assets.xcassets/AppIcon.appiconset"
for s in 16 32 128 256 512; do
  sips -s format png -z $s $s ../brand/logo-1024.png --out "$set_dir/mac-icon-$s@1x.png" >/dev/null
  d=$((s * 2))
  sips -s format png -z $d $d ../brand/logo-1024.png --out "$set_dir/mac-icon-$s@2x.png" >/dev/null
done
echo "icons written to $set_dir"
