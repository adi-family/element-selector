# ADI Element Selector

A Chrome extension for telling an agent *which part of a page* you mean. Open it on any site,
write a message, and point at elements as you go — each one lands in the text as a chip. **Copy**
turns the result into a message that carries a verified path to every element, ready to paste
into an ADI chat.

```
Could you make this block [1] smaller? Also keep this container [2] centred.

---
Page: Field Notes · Blog — https://example.com/blog/ (viewport 1440×900)

[1] `article.post-card` — 604×143 at (192, 256) — “How we built the new editor A long look at…”
- selector: `article.post-card.featured`
- html: `<article class="post-card featured flex gap-4" data-post-id="42">`

[2] `div.container` — 960×501 at (160, 89) — “Measuring twice Why the second measurement…”
- selector: `div.container`
- html: `<div class="container">`
```

## Install

```sh
(cd packages/ui && bun install)     # once: the component library the panel is built on
cd extensions/element-selector
bun install
bun run build
```

Then in Chrome: `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose
`extensions/element-selector/dist`. Pin the ADI button to the toolbar — the ADI mark with a copy
glyph in its corner. After a rebuild, press the reload arrow on the extension's card.

## Use

| | |
| --- | --- |
| Open / hide the selector | the toolbar button, or `Alt+Shift+E` (change it at `chrome://extensions/shortcuts`) |
| Point at an element | **Select element** or `⌘E` / `Ctrl+E`, then click it |
| Pick a parent instead | while pointing, `↑` walks out to the parent, `↓` back in; `Enter` or a click takes the outlined element |
| Cancel pointing | `Esc` |
| Check a chip | hover it to outline its element on the page; click it to scroll the element into view |
| Remove a chip | `Backspace`, like any other character |
| Copy the message | **Copy** or `⌘↵` / `Ctrl+Enter` |
| Move the panel | drag its header |

The draft is kept in the extension's storage: it survives a reload or a navigation (open the
selector again and it is there), and one message can collect elements from several pages — each
element remembers the page it came from.

Pointing never reaches the page: no click, press or key is delivered to it, so links are not
followed and menus stay open. The wheel still scrolls whatever is under the pointer.

## What a path is made of

The selector matches exactly one element when it is picked (the suite checks this). It is built
from names a developer chose — an id, a test id or `data-slot`, a component class — and climbs
until it has passed through at least one of them, so it says where the element is rather than
just being unique today. Position (`:nth-of-type`) is used only where names run out.

Left out on purpose: generated names (`css-1x9k2ab`, CSS-module hashes, long digit runs), which
change between builds, and utility classes (`mt-4`, `items-center`), which describe styling and
are shared by unrelated elements. The full class list is still there, in the `html` line.
` >>> ` in a selector marks a shadow-root boundary. A form field is described by its label or
placeholder, never by what was typed into it. An element's text is quoted as the markup has it,
not as CSS shows it: a heading styled in capitals is still reported in the case the source uses.

## How it is put together

```
src/
  background.ts        service worker: injects the content script when the button is used
  content/             runs in the page: plain TypeScript, no dependencies, ~16 kB
    app.ts               the frame around the panel, the picking layer, the outline
    selector.ts          element → unique, readable CSS path
    utility-class.ts     tells utility classes from names
    describe.ts          everything the message says about an element
  panel/               the composer, an extension page shown in an iframe; React + @design-system/ui
    composer.ts          the contenteditable with chips
    format.ts            draft → the copied text
    draft-store.ts       the draft in chrome.storage
  shared/              the message model and the panel ↔ page protocol
```

- **Nothing runs on a page until the button is used.** The manifest asks for `activeTab`, not for
  access to every site; the content script is injected on demand.
- **The composer is an iframe of the extension's own page**, not markup in the host page. The
  page's CSS and scripts cannot reach it (a 62.5% root font size, a `* {}` rule, a keyboard
  shortcut handler all stay outside), a strict Content-Security-Policy does not block it, and
  the design system's components work in it unchanged. It imports `@design-system/ui` from
  source, like the showcase, and takes its theme tokens straight from the library's stylesheet.
- **Panel and page talk over an extension port**, never `window.postMessage`, which page script
  could read and forge. The content script accepts only the frame it created (a nonce in the
  frame's URL). The panel shows nothing until that handshake succeeds, so a page that embeds
  `panel.html` itself gets an inert note rather than the draft.
- What the content script draws on the page lives in a closed shadow root, in the top layer.
- It works on plain-http sites too (an app on a private `.adi` name is one). Those are not
  secure contexts, so the content script avoids the APIs that exist only in one, and Copy falls
  back to a selection-based copy wherever the Clipboard API is refused.

## Develop

```sh
bun run dev            # rebuild on change; reload the extension in chrome://extensions to pick it up
bun run typecheck
bun test tests         # the message format and the class heuristics
bun run build && bun run test:browser
```

`test:browser` drives the built extension in a real Chrome: it loads `dist/`, clicks the real
toolbar button, and picks, types, copies and reloads on a fixture site that serves a strict CSP
and hostile CSS. `CHROME_BIN` picks the browser, `BROWSER_SCREENSHOTS_DIR` saves screenshots,
`HEADFUL=1` shows the browser. Headless Chrome has a clipboard of its own, so the suite copies for
real without touching yours; a visible browser shares yours, so Copy goes to a stand-in there
unless `REAL_CLIPBOARD=1`.

`bun run icons` re-renders `public/icons/` from `scripts/icon.svg` and, for the 16-pixel size,
`scripts/icon-small.svg` (needs `rsvg-convert`). The icon is the ADI mark with a copy glyph in the
corner: what the extension does is put a message on the clipboard.

## Publish

```sh
bun run package        # typecheck, unit tests, build → release/adi-element-selector-<version>.zip
```

The zip has `manifest.json` at its root, which is what the Chrome Web Store upload expects. The
version comes from `package.json` (the build writes it into the manifest); the store refuses a
version it has already seen, so bump it before every upload. To check the very archive you are
about to upload: unzip it somewhere and run `EXTENSION_DIR=/that/folder bun run test:browser`.

`manifest.json` needs nothing more to be accepted. Two optional fields are yours to decide:
`homepage_url` (a public page for the extension) and `author` (`{ "email": "…" }`).

What the store asks for outside the manifest, with answers that match what the code does:

| Field | Answer |
| --- | --- |
| Description | `store/description.txt`, ready to paste |
| Category | Developer Tools |
| Language | English |
| Store icon, promo tiles | `bun run store-assets` → `release/store/` (see below) |
| Screenshots | `bun run screenshots` writes three at the store's 1280×800 into `release/screenshots/` (see below) |
| Single purpose | Lets the user point at elements of the current page and copy a message describing them, for pasting into an AI agent's chat. |
| `activeTab` | The selector opens only on the tab where the user presses the toolbar button, and reads only the elements they then click. |
| `scripting` | Injects the extension's own bundled content script into that tab when the button is pressed. Nothing is injected otherwise. |
| `storage` | Keeps the message being written, on this device, so it survives a page reload. |
| Remote code | No. Everything is in the package. |
| Data usage | Tick **Website content** (the picked elements' text and markup) and **Web history** (the address and title of each page an element was picked on). Nothing is transmitted, but the store's User Data FAQ requires handling to be disclosed even when it is local. Certify all three statements. |
| Privacy policy | Required for the same reason. `https://github.com/adi-family/element-selector/blob/main/PRIVACY.md` — `store/privacy-policy.md`, published by `scripts/publish.sh` |

### The public repository

```sh
sh scripts/publish.sh     # commit first; it publishes what is committed
```

The source is public at <https://github.com/adi-family/element-selector>: a snapshot of this
folder and of `packages/ui`, with the privacy policy at its root as `PRIVACY.md` (the URL the
store listing points at). Run the script after any change that should be public — a change to
the privacy policy above all.

### Screenshots

```sh
bun run build && bun run screenshots     # → release/screenshots/1-…png, 2-…png, 3-…png
```

The script drives the built extension in a real Chrome on a small demo site
(`scripts/screenshots/site/`) and captures pointing at an element, the composed message with a
chip outlining its element, and the text Copy produced — the text of that very run, not a mock-up.
`SCHEME=light` takes them with the panel's light theme. Re-run it whenever the panel's look or the
message format changes.

### Store icon and promo tiles

```sh
bun run store-assets     # after the screenshots → release/store/
```

- `store-icon-128.png` — the icon at 96×96 with 16 px of transparent padding on every side, as
  the store's image guidelines ask. (The icons inside the package fill their canvas; the toolbar
  wants that.)
- `promo-small-440x280.png` and `promo-marquee-1400x560.png` — the promo tiles, 24-bit PNG with
  no alpha channel. They are drawn as two small pages in `scripts/store/site/`; the marquee
  embeds the first screenshot. Needs ImageMagick as well as `rsvg-convert`.

## Limits

- Elements inside an `<iframe>` cannot be picked; the frame itself can.
- Things that exist only while hovered (tooltips, hover menus) disappear when pointing starts,
  because the page no longer sees the pointer. Things opened by a click stay.
- A page's modal `<dialog>` makes everything outside it inert, the selector's panel included.
- Browser pages (`chrome://…`, the Web Store) refuse every extension; the button shows `!`.

## Next

The message is copied for now. Sending it straight to an agent — choosing an existing chat or
starting a new one — belongs in the panel: it is already an extension page, so it can call the
ADI app once the manifest is given that host. The draft is structured (`shared/types.ts`), so
nothing has to be parsed back out of the copied text.
