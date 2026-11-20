import { randomId } from "../shared/random";
import { EMPTY_DRAFT, type Draft } from "../shared/types";

/**
 * The draft lives in extension storage, not in the page: navigating away destroys the panel, and
 * the message being written must survive that. One draft for the whole browser — a message can
 * collect elements from several pages and tabs — so a panel also listens for the other panels'
 * writes and shows them.
 */

const KEY = "draft";
const SAVE_DELAY_MS = 150;

interface Stored {
  draft: Draft;
  /** Which panel wrote it, so a panel can tell its own echo from another tab's edit. */
  writer: string;
}

const writer = randomId();

function isDraft(value: unknown): value is Draft {
  if (typeof value !== "object" || value === null) return false;
  const { parts, refs } = value as Partial<Draft>;
  return Array.isArray(parts) && typeof refs === "object" && refs !== null;
}

function unwrap(value: unknown): Stored | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Partial<Stored>;
  return isDraft(stored.draft) && typeof stored.writer === "string" ? (stored as Stored) : null;
}

export async function loadDraft(): Promise<Draft> {
  const items = await chrome.storage.local.get(KEY);
  return unwrap(items[KEY])?.draft ?? EMPTY_DRAFT;
}

let pending: Draft | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function flush(): void {
  clearTimeout(timer);
  if (!pending) return;
  const stored: Stored = { draft: pending, writer };
  pending = null;
  chrome.storage.local.set({ [KEY]: stored }).catch(() => {
    // Storage is unavailable only while the extension is being reloaded; the draft on screen stays.
  });
}

/** Saves soon. Typing produces a change per key; one write per pause is enough. */
export function saveDraft(draft: Draft): void {
  pending = draft;
  clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DELAY_MS);
}

// The page is going away and the panel with it: write what is still waiting.
window.addEventListener("pagehide", flush);

/** Calls back when another panel changed the draft. Returns the function that stops watching. */
export function watchDraft(listener: (draft: Draft) => void): () => void {
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local" || !(KEY in changes)) return;
    const stored = unwrap(changes[KEY]!.newValue);
    if (stored?.writer === writer) return;
    listener(stored?.draft ?? EMPTY_DRAFT);
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}
