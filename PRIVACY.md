# Privacy Policy — ADI Element Selector

Last updated: 20 November 2026

ADI Element Selector is a browser extension that lets you point at elements of a web page and
copy a message describing them, for pasting into a chat with an AI agent.

## What the extension handles

Nothing, until you press its toolbar button on a tab. From then on, on that tab only:

- **The elements you click.** For each one: a CSS selector that identifies it, its opening HTML
  tag with its attributes, the text it shows (shortened), and its size and position.
- **The page they are on.** Its address and title.
- **The message you write** in the extension's composer.

What you have typed into form fields on the page is not read. A field is described by its label
or placeholder only.

## Where it goes

- **To your clipboard**, when you press Copy.
- **To the extension's own storage on your device**, as the draft of the message you are
  writing, so that it survives a page reload and can be continued in another tab. Clearing the
  message removes it. Removing the extension removes everything it stored.

Nothing leaves your device. The extension makes no network requests, has no analytics or
tracking, loads no remote code, and has no server. We do not collect, receive, sell or share any
of your data, and nobody but you can read it.

## Permissions

- `activeTab` — access to the one tab on which you press the button, at that moment.
- `scripting` — to place the extension's own picker and composer on that tab.
- `storage` — to keep the draft on your device.

The extension asks for no access to any site in advance.

## Limited use

The extension's use of information complies with the Chrome Web Store User Data Policy, including
the Limited Use requirements. Information is used only to provide the single purpose described
above and is not transferred to anyone.

## Changes

If the extension's handling of data changes, this page will be updated before the change is
released.

## Contact

Questions about this policy: open an issue at
https://github.com/adi-family/element-selector/issues
