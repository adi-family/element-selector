#!/bin/sh
# Publishes the extension's source to https://github.com/adi-family/element-selector.
#
# That repository is a snapshot, not a mirror of this one: it gets the tracked files of
# extensions/element-selector and of packages/ui (the library the panel builds against, already
# public in adi-family/mono), a README and the privacy policy at its root, and SOURCE.json naming
# the commit they came from. Nothing else of this workspace is published.
#
# Usage: sh scripts/publish.sh [checkout]
#   checkout — a clone of the public repository; made on first use
#              (default: ~/.adi/mono/work/element-selector-public)
set -eu

extension=$(cd "$(dirname "$0")/.." && pwd)
workspace=$(git -C "$extension" rev-parse --show-toplevel)
checkout=${1:-"$HOME/.adi/mono/work/element-selector-public"}
remote=https://github.com/adi-family/element-selector.git

# What is published is what is committed; uncommitted edits would make SOURCE.json a lie.
if ! git -C "$workspace" diff --quiet HEAD -- extensions/element-selector packages/ui; then
  echo "Uncommitted changes under extensions/element-selector or packages/ui. Commit them first." >&2
  exit 1
fi
commit=$(git -C "$workspace" rev-parse HEAD)

if [ ! -d "$checkout/.git" ]; then
  git clone "$remote" "$checkout"
fi
if git -C "$checkout" rev-parse --verify --quiet HEAD >/dev/null; then
  git -C "$checkout" pull --ff-only --quiet
else
  # A repository with no commits yet: the first snapshot starts its main branch.
  git -C "$checkout" checkout --quiet -B main
fi

# Start from nothing, so a file deleted here disappears there too.
git -C "$checkout" ls-files -z | (cd "$checkout" && xargs -0 rm -f)
git -C "$workspace" ls-files extensions/element-selector packages/ui \
  | grep -v -e '\.tsbuildinfo$' -e '^extensions/element-selector/scripts/public/' \
  | rsync -a --files-from=- "$workspace/" "$checkout/"
cp "$extension/scripts/public/README.md" "$checkout/README.md"
cp "$extension/scripts/public/gitignore" "$checkout/.gitignore"
cp "$extension/store/privacy-policy.md" "$checkout/PRIVACY.md"
printf '{\n  "workspace": "design-system",\n  "commit": "%s"\n}\n' "$commit" > "$checkout/SOURCE.json"

git -C "$checkout" add -A
if git -C "$checkout" diff --cached --quiet; then
  echo "Nothing to publish: the public repository already matches $commit."
  exit 0
fi
git -C "$checkout" commit --quiet -m "Snapshot of design-system $(printf '%s' "$commit" | cut -c1-7)"
git -C "$checkout" push --quiet origin HEAD
echo "Published $(printf '%s' "$commit" | cut -c1-7) to $remote"
