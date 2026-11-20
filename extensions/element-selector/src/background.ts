/**
 * Background service worker. Its whole job: when the toolbar button (or its keyboard shortcut) is
 * used, inject the content script into that tab. The script toggles itself — the first injection
 * opens the selector, a later one into the same document hides or shows it again — so there is
 * no state to keep here, which matters because a service worker is stopped whenever it is idle.
 *
 * Injecting on demand is what lets the manifest ask for `activeTab` instead of access to every
 * site: the extension can touch a page only after the user invoked it there.
 */

const BLOCKED_TITLE = "ADI Element Selector cannot run on this page";

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void toggle(tab.id);
});

async function toggle(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    // Browser pages (chrome://…), the Web Store and the PDF viewer refuse every extension.
    await flagBlocked(tabId);
  }
}

/** Say why nothing happened, on the button itself, then put it back. */
async function flagBlocked(tabId: number): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b91c1c" });
    await chrome.action.setBadgeText({ tabId, text: "!" });
    await chrome.action.setTitle({ tabId, title: BLOCKED_TITLE });
    setTimeout(() => {
      // An empty text clears the badge; an empty title restores the manifest's default.
      chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
      chrome.action.setTitle({ tabId, title: "" }).catch(() => {});
    }, 3000);
  } catch {
    // The tab closed in the meantime.
  }
}
