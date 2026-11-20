/**
 * The message model shared by the content script (which picks elements) and the panel (which
 * composes with them). Everything here is plain JSON: it crosses an extension port and is stored
 * in chrome.storage as the draft.
 */

/** What the picker records about one element — enough for an agent to find it again. */
export interface ElementRef {
  id: string;
  /** Short label for the chip: `article.post-card`. */
  label: string;
  /** Unique CSS selector, verified when picked. ` >>> ` marks a shadow-root boundary. */
  selector: string;
  /** The opening tag with its attributes, trimmed to a sensible length. */
  html: string;
  /** Visible text, whitespace collapsed and truncated. Absent when the element has none. */
  text?: string;
  /** Position and size in the viewport at the moment it was picked, in CSS pixels. */
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  /** The page it was picked on. A message can reference elements from several pages. */
  url: string;
  title: string;
}

export type MessagePart = { type: "text"; text: string } | { type: "ref"; id: string };

/** A message being composed: text interleaved with element references. */
export interface Draft {
  parts: MessagePart[];
  refs: Record<string, ElementRef>;
}

export const EMPTY_DRAFT: Draft = { parts: [], refs: {} };
