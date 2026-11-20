import { randomId } from "../shared/random";
import type { ElementRef } from "../shared/types";
import { isStableName, meaningfulClasses, selectorFor } from "./selector";

const TEXT_LIMIT = 80;
const ATTRIBUTE_LIMIT = 120;
const HTML_LIMIT = 400;
const LABEL_LIMIT = 40;

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isFormControl(element: Element): boolean {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

/**
 * A short structural name for the chip and the highlight: the tag plus the one name that best
 * says what the element is. Generated and utility classes are left out — `button.css-1x9k2ab`
 * and `div.flex` name nothing — so an element without a real name is just its tag.
 */
export function labelFor(element: Element): string {
  const tag = element.localName;
  if (element.id && isStableName(element.id)) return clip(`${tag}#${element.id}`, LABEL_LIMIT);
  const [named] = meaningfulClasses(element);
  if (named) return clip(`${tag}.${named}`, LABEL_LIMIT);
  for (const attribute of ["data-slot", "data-testid"]) {
    const value = element.getAttribute(attribute);
    // `button[data-slot="button"]` says nothing the tag has not said already.
    if (value && value !== tag && value.length <= 24) return `${tag}[${attribute}="${value}"]`;
  }
  return tag;
}

const UNREAD = new Set(["script", "style", "noscript", "template"]);

function isRendered(element: Element): boolean {
  // An element with `display: contents` has no box of its own, but its children are shown.
  return (element.checkVisibility?.({ checkVisibilityCSS: true }) ?? true) || getComputedStyle(element).display === "contents";
}

/**
 * The text inside an element as the markup has it, visible parts only, read just far enough to
 * fill the limit. Not `innerText`: that applies CSS `text-transform`, so a heading styled in
 * capitals would be reported as "ENGINEERING" when the source — where an agent will look for
 * it — says "Engineering".
 */
function readableText(root: Element, limit: number): string {
  const blocks = new Map<Element, Element>();
  /** The nearest ancestor that starts a line of its own; text from two of them needs a space between. */
  const blockOf = (parent: Element): Element => {
    const known = blocks.get(parent);
    if (known) return known;
    let block = parent;
    while (block !== root && block.parentElement && /^(inline|contents|ruby)/.test(getComputedStyle(block).display)) {
      block = block.parentElement;
    }
    blocks.set(parent, block);
    return block;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof Element)) return NodeFilter.FILTER_ACCEPT;
      if (UNREAD.has(node.localName) || !isRendered(node)) return NodeFilter.FILTER_REJECT;
      return node.localName === "br" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  let text = "";
  let last: Element | undefined;
  for (let node = walker.nextNode(); node && text.length < limit + 40; node = walker.nextNode()) {
    const block = node instanceof Element ? undefined : blockOf(node.parentElement ?? root);
    // A <br>, or a step from one block into another, is a break the reader sees.
    if (block !== last || !block) text += " ";
    last = block ?? last;
    text += (node.nodeValue ?? "").replace(/\s+/g, " ");
  }
  return collapse(text);
}

/**
 * What a person would read off the element. Never a form control's value — that is whatever the
 * user typed into the page, and it has no business in a message they are about to paste elsewhere.
 */
function textOf(element: Element): string | undefined {
  let text: string | null | undefined;
  if (isFormControl(element)) {
    text = element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? element.getAttribute("name");
  } else if (element instanceof HTMLImageElement) {
    text = element.alt;
  } else if (!(element instanceof HTMLElement) && element.getAttribute("aria-label")) {
    // An SVG shape or icon: its label says what it is better than its <title> and <desc> would.
    text = element.getAttribute("aria-label");
  } else {
    text = readableText(element, TEXT_LIMIT);
  }
  const collapsed = collapse(text ?? "");
  return collapsed ? clip(collapsed, TEXT_LIMIT) : undefined;
}

/** The opening tag as written, with long attribute values cut and typed-in values left out. */
function openingTag(element: Element): string {
  const control = isFormControl(element);
  const attributes = Array.from(element.attributes)
    .filter(({ name }) => name !== "nonce" && !(control && name === "value"))
    .map(({ name, value }) => {
      const shown = clip(collapse(value), ATTRIBUTE_LIMIT);
      return shown === "" ? name : `${name}="${shown.replaceAll('"', "&quot;")}"`;
    });
  const tag = `<${element.localName}${attributes.length ? ` ${attributes.join(" ")}` : ""}>`;
  return clip(tag, HTML_LIMIT);
}

/** Records everything the message will say about an element, as it is right now. */
export function describe(element: Element, id: string = randomId(4)): ElementRef {
  const rect = element.getBoundingClientRect();
  const text = textOf(element);
  return {
    id,
    label: labelFor(element),
    selector: selectorFor(element),
    html: openingTag(element),
    ...(text ? { text } : {}),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    url: location.href,
    title: collapse(document.title),
  };
}
