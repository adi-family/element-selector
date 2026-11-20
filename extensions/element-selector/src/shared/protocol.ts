import type { ElementRef } from "./types";

/**
 * The panel iframe and the content script of the page it sits on talk over one long-lived
 * extension port (chrome.tabs.connect from the panel). A port, rather than window.postMessage,
 * because page script can both read and forge postMessage traffic on its own window; it cannot
 * touch an extension port.
 *
 * The port's name is this prefix plus a nonce the content script put in the iframe's URL hash,
 * so the content script accepts exactly the frame it created.
 */
export const PANEL_PORT_PREFIX = "adi-element-selector:";

/** The custom tag of the content script's host element. Never registered as a custom element. */
export const HOST_TAG = "adi-element-selector";

/** Keys the picker understands; the panel forwards them when it holds the keyboard focus. */
export type PickKey = "Escape" | "ArrowUp" | "ArrowDown" | "Enter";

export const PICK_KEYS: readonly PickKey[] = ["Escape", "ArrowUp", "ArrowDown", "Enter"];

/** How the panel names an element it wants shown on the page. */
export interface RefTarget {
  id: string;
  selector: string;
  url: string;
  /** The reference's number in the message, shown in the highlight's label. */
  number?: number;
}

export type PanelToPage =
  | { type: "pick:start" }
  | { type: "pick:cancel" }
  | { type: "pick:key"; key: PickKey }
  /** Outline an element while its chip is hovered; `null` removes the outline. */
  | { type: "highlight"; target: RefTarget | null }
  /** Scroll an element into view and flash it. */
  | { type: "reveal"; target: RefTarget }
  /**
   * The panel's layout changed. The frame takes the height; `grip` is the part of the panel's
   * header, in the panel's own coordinates, that should drag the frame around.
   */
  | { type: "layout"; height: number; grip: { left: number; top: number; width: number; height: number } }
  | { type: "close" };

export type PageToPanel =
  /** First message on a fresh port, and again every time the panel is brought back. */
  | { type: "shown" }
  | { type: "pick:state"; picking: boolean }
  | { type: "picked"; ref: ElementRef };
