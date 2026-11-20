#!/bin/sh
# Builds the extension and zips it for the Chrome Web Store: release/adi-element-selector-<version>.zip,
# with manifest.json at the root of the archive, which is what the store's upload expects.
# The version comes from package.json; bump it there before every upload — the store refuses a
# version it has already seen.
set -eu
cd "$(dirname "$0")/.."

bun run typecheck
bun test tests
bun run build

version=$(bun -e 'console.log(require("./dist/manifest.json").version)')
archive="release/adi-element-selector-$version.zip"
mkdir -p release
rm -f "$archive"
# -X leaves out macOS extra attributes; the store rejects nothing for them, but they are noise.
(cd dist && zip -r -X -q "../$archive" . -x '.DS_Store' -x '*/.DS_Store')

echo
echo "Packaged $archive"
unzip -l "$archive"
