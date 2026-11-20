# ADI Element Selector

A Chrome extension for telling an AI agent *which part of a page* you mean: open it on any site,
write what you want changed, point at elements as you go, and copy a message that carries a
verified path to every one of them.

- **The extension:** [`extensions/element-selector/`](extensions/element-selector/) — start with
  its [README](extensions/element-selector/README.md).
- **Privacy policy:** [PRIVACY.md](PRIVACY.md)

## Build

```sh
(cd packages/ui && bun install)                 # the component library the panel is built on
cd extensions/element-selector
bun install
bun run build                                   # → dist/, load it from chrome://extensions
```

`bun run package` makes the zip for the Chrome Web Store; `bun test tests` and
`bun run test:browser` run the unit tests and the end-to-end suite in a real Chrome.

## What is in this repository

```
extensions/element-selector/   the extension
packages/ui/                   @design-system/ui, ADI's React component library; the extension's
                               panel imports its source and its theme tokens
SOURCE.json                    the commit of ADI's design-system workspace this snapshot was taken from
```

This repository is a published snapshot. Development happens in ADI's design-system workspace,
and `packages/ui` is the same library that ships in
[adi-family/mono](https://github.com/adi-family/mono/tree/main/apps/primary-ui/packages/ui).
Issues are welcome here.
