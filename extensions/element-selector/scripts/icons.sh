#!/bin/sh
# Renders the toolbar and store icons into public/icons/.
# Needs rsvg-convert (brew install librsvg). The PNGs are committed; run this only when the
# artwork changes.
set -eu
cd "$(dirname "$0")/.."
# 16 px has a drawing of its own; see the note in icon-small.svg.
rsvg-convert --width 16 --height 16 scripts/icon-small.svg --output public/icons/icon-16.png
for size in 32 48 128; do
  rsvg-convert --width "$size" --height "$size" scripts/icon.svg --output "public/icons/icon-$size.png"
done
