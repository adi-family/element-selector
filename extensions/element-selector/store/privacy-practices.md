# Privacy practices tab — answers

What to paste into the Chrome Web Store dashboard's *Privacy practices* tab. Each matches what
the code does; change one only together with the other.

## Single purpose description

ADI Element Selector has one purpose: to let the user point at elements of the web page they are viewing and copy a text message that describes those elements, so it can be pasted into a chat with an AI agent.

The user opens a small composer on the current page, writes what they want changed, clicks the elements they mean, and presses Copy. The copied text contains their words plus, for each picked element, a CSS selector, its opening HTML tag, its visible text and its size, together with the page's address.

The extension does nothing until its toolbar button is pressed, does not change the page's own content, and does not send anything anywhere.

## activeTab justification

The extension works only on the tab where the user presses its toolbar button or its keyboard shortcut. activeTab gives it temporary access to that one tab at that moment, which it needs to show its composer on the page and to read the elements the user then clicks: their tag, attributes, visible text and size, and the page's address and title. Using activeTab instead of host permissions means the extension has no access to any site until the user invokes it, and none to other tabs.

## scripting justification

chrome.scripting.executeScript is used for one thing: when the user presses the toolbar button, the extension injects its own content script (content.js, bundled in the package) into the active tab. That script draws the composer frame and the element picker and reads the elements the user clicks. No remote code is loaded, and nothing is injected into a tab the user did not invoke the extension on.

## storage justification

chrome.storage.local keeps the message the user is composing: their text and the descriptions of the elements they picked (selector, opening tag, visible text, size, page address and title). This lets the draft survive a page reload or navigation and be continued in another tab. It is stored only on the user's device, is never transmitted, and is removed when the user clears the message.

## Remote code

No, I am not using remote code.

## Data usage

Tick:

- **Website content** — the text and markup of the elements the user clicks.
- **Web history** — the address and title of each page an element was picked on are part of the message and of the saved draft.

Leave the other seven unticked. Nothing is transmitted off the device, but the store's User Data
FAQ says handling must be disclosed even when data is only processed or stored locally, and names
"capturing data from a web page" and "URLs the browser interacts with" as user data.

Certify all three statements; all are true (nothing is sold, transferred, or used for anything
but the purpose above).

## Privacy policy URL

Required, for the same reason. The text is `privacy-policy.md` in this folder, published by
`scripts/publish.sh` as

    https://github.com/adi-family/element-selector/blob/main/PRIVACY.md
