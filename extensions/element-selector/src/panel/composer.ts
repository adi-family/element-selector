import type { Draft, ElementRef, MessagePart } from "../shared/types";
import { numberRefs } from "./format";

/**
 * The message editor: a contenteditable whose content is text with element chips inline. The DOM
 * is the model while a message is being written — the browser owns typing, the caret and undo —
 * and this class reads it back into {@link MessagePart}s whenever something changes.
 *
 * Deliberately not React: a contenteditable re-rendered from state loses its caret on every key.
 * React mounts the empty element once and hands it over.
 */

const CHIP = '[data-slot="element-chip"]';

export interface ComposerEvents {
  onChange(draft: Draft): void;
  /** A chip came under the pointer, or (with `null`) the pointer left it. */
  onRefHover(ref: ElementRef | null, number: number): void;
  onRefClick(ref: ElementRef, number: number): void;
}

/** How short an element's text has to be to appear on its chip. */
const CHIP_TEXT_LIMIT = 24;

/**
 * What a chip says. An element with a name of its own shows it (`article.post-card`); one
 * without — a bare `button`, an `li` — shows what it reads, since that is how a person knows it.
 */
export function chipText(ref: ElementRef): string {
  const bare = !/[#.[]/.test(ref.label);
  return bare && ref.text && ref.text.length <= CHIP_TEXT_LIMIT ? `${ref.label} “${ref.text}”` : ref.label;
}

function createChip(ref: ElementRef): HTMLElement {
  const chip = document.createElement("span");
  chip.dataset.slot = "element-chip";
  chip.dataset.refId = ref.id;
  // One unit to the caret: Backspace removes the whole reference, never half of its label.
  chip.contentEditable = "false";
  chip.title = `${ref.selector}\n${ref.url}`;
  chip.textContent = chipText(ref);
  return chip;
}

function chipOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(CHIP) : null;
}

/** Reads the editor's DOM as message parts, whatever shape the browser's editing left it in. */
export function readParts(root: Node): MessagePart[] {
  const parts: MessagePart[] = [];
  const text = (value: string) => {
    if (!value) return;
    const last = parts.at(-1);
    if (last?.type === "text") last.text += value;
    else parts.push({ type: "text", text: value });
  };
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text(child.nodeValue ?? "");
      else if (child instanceof HTMLElement) {
        const id = child.dataset.refId;
        if (id) parts.push({ type: "ref", id });
        else if (child.tagName === "BR") text("\n");
        else {
          // A block the browser wrapped a line in: it starts on a line of its own.
          if (parts.length > 0 && /^(DIV|P)$/.test(child.tagName)) text("\n");
          walk(child);
        }
      }
    }
  };
  walk(root);
  return parts;
}

/** The character just before a collapsed range; "x" for a chip; null at the start of a line. */
function before(range: Range): string | null {
  const { startContainer: node, startOffset: offset } = range;
  if (node.nodeType === Node.TEXT_NODE && offset > 0) return (node.nodeValue ?? "")[offset - 1] ?? null;
  return edge(node.nodeType === Node.TEXT_NODE ? node.previousSibling : (node.childNodes[offset - 1] ?? null), -1);
}

function after(range: Range): string | null {
  const { startContainer: node, startOffset: offset } = range;
  const value = node.nodeValue ?? "";
  if (node.nodeType === Node.TEXT_NODE && offset < value.length) return value[offset] ?? null;
  return edge(node.nodeType === Node.TEXT_NODE ? node.nextSibling : (node.childNodes[offset] ?? null), 0);
}

function edge(node: Node | null, index: 0 | -1): string | null {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? "").at(index) ?? null;
  return node instanceof HTMLElement && node.dataset.refId ? "x" : null;
}

export class Composer {
  private readonly root: HTMLElement;
  private readonly events: ComposerEvents;
  private readonly listeners = new AbortController();
  /** Every reference this editor has seen, including ones whose chip was deleted: undo can bring a chip back. */
  private refs = new Map<string, ElementRef>();
  /** The last caret inside the editor. Picking moves focus to the page; the chip still lands here. */
  private caret: Range | null = null;
  private hovered: string | null = null;

  constructor(root: HTMLElement, events: ComposerEvents) {
    this.root = root;
    this.events = events;
    const { signal } = this.listeners;
    root.addEventListener("input", () => this.changed(), { signal });
    root.addEventListener("mouseover", (event) => this.hover(chipOf(event.target)), { signal });
    root.addEventListener("mouseleave", () => this.hover(null), { signal });
    root.addEventListener("click", (event) => {
      const chip = chipOf(event.target);
      const ref = chip && this.refs.get(chip.dataset.refId ?? "");
      if (chip && ref) this.events.onRefClick(ref, Number(chip.dataset.n) || 0);
    }, { signal });
    document.addEventListener("selectionchange", () => this.rememberCaret(), { signal });
    this.refresh();
  }

  destroy(): void {
    this.listeners.abort();
  }

  getDraft(): Draft {
    const refs: Draft["refs"] = {};
    const parts = readParts(this.root).filter((part) => {
      if (part.type === "text") return true;
      const ref = this.refs.get(part.id);
      if (ref) refs[part.id] = ref;
      return Boolean(ref);
    });
    return { parts, refs };
  }

  /** Replaces the editor's content. Does not report a change: this is the draft arriving, not an edit. */
  setDraft(draft: Draft): void {
    this.refs = new Map(Object.entries(draft.refs));
    const nodes: Node[] = [];
    draft.parts.forEach((part, index) => {
      if (part.type === "ref") {
        const ref = this.refs.get(part.id);
        if (ref) nodes.push(createChip(ref));
        return;
      }
      // A newline that ends the content draws no line of its own, so it is not worth restoring.
      const value = index === draft.parts.length - 1 ? part.text.replace(/\n+$/, "") : part.text;
      if (value) nodes.push(document.createTextNode(value));
    });
    this.root.replaceChildren(...nodes);
    this.forgetCaret();
    this.hover(null);
    this.refresh();
  }

  /** Puts a reference where the caret was, with the spacing a person would have typed. */
  insertRef(ref: ElementRef): void {
    this.refs.set(ref.id, ref);
    const range = this.caretRange();
    range.deleteContents();

    const chip = createChip(ref);
    const previous = before(range);
    const next = after(range);
    const fragment = document.createDocumentFragment();
    if (previous !== null && !/\s/.test(previous)) fragment.append(" ");
    fragment.append(chip);
    // Text always follows a chip at the end of the message; without it the caret has nowhere to go.
    const tail = next === null || /[\p{L}\p{N}]/u.test(next) ? document.createTextNode(" ") : null;
    if (tail) fragment.append(tail);
    range.insertNode(fragment);

    const caret = document.createRange();
    caret.setStartAfter(tail ?? chip);
    caret.collapse(true);
    // Inserting split the text around the caret and left empty pieces behind; a live range
    // follows the merge.
    this.root.normalize();
    this.caret = caret;
    this.restoreCaret();
    chip.scrollIntoView({ block: "nearest" });
    this.changed();
  }

  clear(): void {
    this.root.replaceChildren();
    this.forgetCaret();
    this.hover(null);
    this.restoreCaret();
    this.changed();
  }

  /** Gives the editor the keyboard, with the caret where it was — or at the end of a fresh draft. */
  focus(): void {
    // The selection itself outranks the remembered caret: its change event may still be queued.
    this.rememberCaret();
    this.restoreCaret();
  }

  private restoreCaret(): void {
    this.root.focus({ preventScroll: true });
    const selection = document.getSelection();
    if (!selection) return;
    const range = this.caretRange();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /** After the content was replaced, the old caret (and a selection left collapsed at the start) mean nothing. */
  private forgetCaret(): void {
    this.caret = null;
    const selection = document.getSelection();
    if (selection?.anchorNode && this.root.contains(selection.anchorNode)) selection.removeAllRanges();
  }

  private caretRange(): Range {
    const saved = this.caret;
    if (saved && this.root.contains(saved.startContainer) && this.root.contains(saved.endContainer)) return saved.cloneRange();
    const range = document.createRange();
    range.selectNodeContents(this.root);
    range.collapse(false);
    // The browser keeps a <br> at the end of the last line; content belongs in front of it.
    const last = this.root.lastChild;
    if (last?.nodeName === "BR") range.setStartBefore(last);
    range.collapse(true);
    return range;
  }

  private rememberCaret(): void {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (this.root.contains(range.startContainer) && this.root.contains(range.endContainer)) this.caret = range.cloneRange();
  }

  private hover(chip: HTMLElement | null): void {
    const id = chip?.dataset.refId ?? null;
    if (id === this.hovered) return;
    this.hovered = id;
    const ref = id ? this.refs.get(id) : undefined;
    this.events.onRefHover(ref ?? null, Number(chip?.dataset.n) || 0);
  }

  /** Renumbers the chips and updates the empty state, after any change to the content. */
  private refresh(): void {
    const parts = readParts(this.root);
    const numbers = numberRefs(parts, Object.fromEntries(this.refs));
    for (const chip of this.root.querySelectorAll<HTMLElement>(CHIP)) {
      const number = numbers.get(chip.dataset.refId ?? "");
      if (number) chip.dataset.n = String(number);
      else delete chip.dataset.n;
    }
    // An emptied contenteditable is left holding a lone <br>.
    const blank = parts.every((part) => part.type === "text" && (part.text === "" || part.text === "\n"));
    this.root.dataset.empty = String(blank);
    // The hovered chip was deleted from under the pointer: no mouseleave will ever say so.
    if (this.hovered && !this.root.querySelector(`${CHIP}[data-ref-id="${CSS.escape(this.hovered)}"]`)) this.hover(null);
  }

  private changed(): void {
    this.refresh();
    this.events.onChange(this.getDraft());
  }
}
