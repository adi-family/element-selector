import { PANEL_PORT_PREFIX, type PageToPanel, type PanelToPage } from "../shared/protocol";

/** The panel's connection to the content script of the page it is embedded in. */
export interface PageLink {
  post(message: PanelToPage): void;
  /** Returns the function that unsubscribes. */
  subscribe(listener: (message: PageToPanel) => void): () => void;
  close(): void;
}

export type LinkStatus = "connected" | "lost";

/**
 * Connects to the content script in this frame's own tab. `connected` is reported on the page's
 * first message, not on connecting: a port to a tab with nobody listening opens and then drops,
 * and only an answer proves the content script accepted this frame.
 *
 * `lost` is the normal outcome when the panel is opened anywhere but inside the selector's own
 * iframe — in a tab of its own, or embedded by a page — and the panel stays inert there.
 */
export function connectToPage(onStatus: (status: LinkStatus) => void): PageLink {
  const listeners = new Set<(message: PageToPanel) => void>();
  let port: chrome.runtime.Port | null = null;
  let closed = false;

  const lost = () => {
    port = null;
    if (!closed) onStatus("lost");
  };

  const open = async () => {
    // The content script put a nonce in the URL; without one, this frame is not its frame.
    const nonce = location.hash.slice(1);
    const tab = nonce ? await chrome.tabs.getCurrent() : undefined;
    if (closed) return;
    if (tab?.id === undefined) {
      lost();
      return;
    }
    let greeted = false;
    port = chrome.tabs.connect(tab.id, { frameId: 0, name: PANEL_PORT_PREFIX + nonce });
    port.onMessage.addListener((message: PageToPanel) => {
      if (!greeted) {
        greeted = true;
        onStatus("connected");
      }
      for (const listener of [...listeners]) listener(message);
    });
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it handled; an unanswered connect is expected, not an error.
      void chrome.runtime.lastError;
      lost();
    });
  };
  open().catch(lost);

  return {
    post(message) {
      try {
        port?.postMessage(message);
      } catch {
        lost();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      closed = true;
      port?.disconnect();
      port = null;
    },
  };
}
