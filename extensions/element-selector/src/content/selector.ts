import { isUtilityClass } from "./utility-class";

/**
 * Builds the path to an element: a CSS selector that matches it and nothing else, kept as short
 * and as readable as the page allows. An agent reads it to learn where the element is, so it is
 * built from the names a developer chose (ids, test ids, component classes) wherever they exist,
 * and from position (`:nth-of-type`) only where they do not.
 */

/** Separates the steps of a selector that crosses a shadow-root boundary. */
export const SHADOW_STEP = " >>> ";

/** Attributes developers put on elements precisely so they can be found again. */
const ANCHOR_ATTRIBUTES = [
  "data-testid",
  "data-test-id",
  "data-test",
  "data-cy",
  "data-qa",
  "data-slot",
  "data-component",
];

const MAX_CLASSES = 2;

type Root = Document | ShadowRoot;

/** A name that needs no escaping and is short enough to be something a person wrote. */
function isPlainName(value: string): boolean {
  return value.length <= 48 && /^[A-Za-z][\w-]*$/.test(value);
}

/**
 * Names minted by a build step or a runtime (CSS-in-JS hashes, CSS-module suffixes, generated
 * ids). They change between builds, so a selector must not lean on them.
 */
function looksGenerated(value: string): boolean {
  if (/\d{4,}/.test(value)) return true;
  if (/^(css|sc|jss|jsx|svelte|emotion)-[A-Za-z0-9-]{4,}$/i.test(value)) return true;
  if (/^(jss|ember|radix)\d+$/i.test(value)) return true;
  if (/__[A-Za-z0-9_-]{5,}$/.test(value)) return true;
  // A dash- or underscore-separated piece that mixes letters and digits at hash length: `k9s2df`.
  return value.split(/[-_]/).some((piece) => piece.length >= 5 && /\d/.test(piece) && /[A-Za-z]/.test(piece) && !/^[A-Za-z]+\d{1,2}$/.test(piece));
}

export function isStableName(value: string): boolean {
  return isPlainName(value) && !looksGenerated(value);
}

/** The classes worth naming an element by, in the order the author wrote them. */
export function meaningfulClasses(element: Element): string[] {
  return Array.from(element.classList).filter((name) => isStableName(name) && !isUtilityClass(name));
}

/** The first anchor attribute the element carries, as a ready selector fragment. */
function anchorAttribute(element: Element): string | null {
  for (const name of ANCHOR_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value && value.length <= 64) return `[${name}="${CSS.escape(value)}"]`;
  }
  return null;
}

function count(root: ParentNode, selector: string): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Elements a page has one of, or few enough that their tag alone says where you are. */
const LANDMARKS = new Set(["body", "main", "header", "footer", "nav", "aside"]);

interface Step {
  text: string;
  /** Whether the step says what the element is, rather than only what kind and where. */
  named: boolean;
}

/** The element's own step of the path, before any positional disambiguation. */
function step(element: Element, root: Root): Step {
  const tag = CSS.escape(element.localName);
  if (element.id && isStableName(element.id) && count(root, `#${CSS.escape(element.id)}`) === 1) {
    return { text: `${tag}#${CSS.escape(element.id)}`, named: true };
  }
  const anchor = anchorAttribute(element);
  if (anchor) return { text: tag + anchor, named: true };
  // The rarest classes pin the element down soonest: one that three elements share says more
  // than one that fifty share. They are written in the order the author wrote them.
  const classes = meaningfulClasses(element)
    .map((name, position) => ({ name, position, uses: count(root, `.${CSS.escape(name)}`) }))
    .sort((a, b) => a.uses - b.uses)
    .slice(0, MAX_CLASSES)
    .sort((a, b) => a.position - b.position)
    .map(({ name }) => `.${CSS.escape(name)}`);
  // A custom element's tag is a component name in its own right.
  const named = classes.length > 0 || LANDMARKS.has(element.localName) || element.localName.includes("-");
  return { text: tag + classes.join(""), named };
}

/** Adds `:nth-of-type` when siblings would otherwise match the same step. */
function amongSiblings(element: Element, own: string): string {
  const parent = element.parentNode;
  if (!parent) return own;
  const siblings = Array.from(parent.children);
  const alike = siblings.filter((sibling) => {
    try { return sibling.matches(own); } catch { return false; }
  });
  if (alike.length <= 1) return own;
  const sameTag = siblings.filter((sibling) => sibling.localName === element.localName);
  return `${own}:nth-of-type(${sameTag.indexOf(element) + 1})`;
}

/**
 * A selector unique within the element's own tree (the document, or one shadow root).
 *
 * Unique is not enough: `button` is unique on a page with one button, and says nothing about
 * where it is and stops matching the day a second button appears. So the path keeps climbing
 * until it also passes through something with a name — and to the top of the tree if nothing has.
 */
function selectorWithin(element: Element, root: Root): string {
  const steps: string[] = [];
  let anchored = false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const own = step(current, root);
    anchored ||= own.named;
    steps.unshift(amongSiblings(current, own.text));
    const selector = steps.join(" > ");
    // Each step matches `current` among its siblings, so the one match can only be `element`.
    if (anchored && count(root, selector) === 1) return selector;
  }
  return steps.join(" > ");
}

/** The shadow root attached to an element, including a closed one where the browser allows it. */
export function shadowRootOf(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  if (!(element instanceof HTMLElement)) return null;
  try {
    // Content scripts may open closed roots; outside an extension the API simply is not there.
    return globalThis.chrome?.dom?.openOrClosedShadowRoot(element) ?? null;
  } catch {
    return null;
  }
}

/** The element's parent, stepping out of a shadow tree to its host. */
export function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** The full path to an element; one selector per tree, joined by {@link SHADOW_STEP}. */
export function selectorFor(element: Element): string {
  const steps: string[] = [];
  let current: Element | null = element;
  while (current) {
    const root = current.getRootNode();
    if (!(root instanceof Document || root instanceof ShadowRoot)) {
      // Detached from the page; a tree-relative path is the best that can be said.
      steps.unshift(selectorWithin(current, current.ownerDocument));
      break;
    }
    steps.unshift(selectorWithin(current, root));
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return steps.join(SHADOW_STEP);
}

/** Finds the element a {@link selectorFor} path points at, or null when the page has moved on. */
export function resolveSelector(selector: string, document: Document): Element | null {
  let root: Root | null = document;
  let found: Element | null = null;
  for (const part of selector.split(SHADOW_STEP)) {
    // The previous step had to be a shadow host for there to be a next one.
    if (!root) return null;
    try {
      found = root.querySelector(part);
    } catch {
      return null;
    }
    if (!found) return null;
    root = shadowRootOf(found);
  }
  return found;
}
