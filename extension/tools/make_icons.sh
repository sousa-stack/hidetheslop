#!/bin/sh
# Makes the toolbar/store icons from the logo: tools/make_icons.sh
set -e
cd "$(dirname "$0")/.."
for s in 16 32 48 128; do
  sips -s format png -z $s $s ../brand/logo-1024.png --out src/icons/icon-$s.png >/dev/null
done
echo "icons written to src/icons"
