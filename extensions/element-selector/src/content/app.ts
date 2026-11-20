import {
  HOST_TAG,
  PANEL_PORT_PREFIX,
  PICK_KEYS,
  type PageToPanel,
  type PanelToPage,
  type PickKey,
  type RefTarget,
} from "../shared/protocol";
import { randomId } from "../shared/random";
import type { ElementRef } from "../shared/types";
import { describe, labelFor } from "./describe";
import { parentAcrossShadow, resolveSelector, shadowRootOf } from "./selector";
import { PAGE_STYLES } from "./styles";

/** What the injected script keeps on its global, so a second injection can find the first. */
export interface Selector {
  toggle(): void;
  /** False once the extension was reloaded under a page that still holds the old script. */
  alive(): boolean;
}

const MARGIN = 16;
const MIN_HEIGHT = 120;
const INITIAL_HEIGHT = 190;
const TAG_HEIGHT = 20;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function div(className: string, hidden = false): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  node.hidden = hidden;
  return node;
}

/** The picking hint, built node by node: a page's Trusted Types policy may forbid innerHTML. */
function buildHint(): HTMLDivElement {
  const hint = div("hint", true);
  const key = (label: string) => Object.assign(document.createElement("kbd"), { textContent: label });
  const gap = () => Object.assign(document.createElement("span"), { textContent: "·" });
  hint.append("Click an element to add it", gap(), key("↑"), key("↓"), " parent / child", gap(), key("Esc"), " cancel");
  return hint;
}

export function createSelector(): Selector {
  const nonce = randomId();
  const host = document.createElement(HOST_TAG);
  // Closed: page script (and session recorders walking open roots) cannot reach inside.
  const shadow = host.attachShadow({ mode: "closed" });
  try {
    // A constructed sheet is not a <style> element, so no page CSP can refuse it.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PAGE_STYLES);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    shadow.append(Object.assign(document.createElement("style"), { textContent: PAGE_STYLES }));
  }
  // The top layer is the only place that is above a page's own dialogs and max-z-index widgets.
  host.setAttribute("popover", "manual");

  const layer = div("layer", true);
  const box = div("box", true);
  const tag = div("tag", true);
  const hint = buildHint();
  const frame = div("frame");
  const iframe = document.createElement("iframe");
  iframe.title = "ADI Element Selector";
  iframe.allow = "clipboard-write";
  iframe.src = `${chrome.runtime.getURL("panel.html")}#${nonce}`;
  const grip = div("grip");
  frame.append(iframe, grip);
  shadow.append(layer, box, tag, hint, frame);

  let port: chrome.runtime.Port | null = null;
  let visible = false;
  const position = { right: MARGIN, bottom: MARGIN };
  let height = INITIAL_HEIGHT;
  let drag: { x: number; y: number; right: number; bottom: number } | null = null;

  /** Elements picked in this document, so a chip can find its element even after its selector stopped matching. */
  const picked = new Map<string, WeakRef<Element>>();
  const idOf = new WeakMap<Element, string>();

  let highlighted: { element: Element; prefix: string } | null = null;
  let pick: {
    /** The element under the pointer and its ancestors, innermost first. */
    chain: Element[];
    index: number;
    point: { x: number; y: number } | null;
    /** Described on press, before the page can react to the click by tearing the element down. */
    pressed: { element: Element; ref: ElementRef } | null;
  } | null = null;
  let frameRequest = 0;

  function post(message: PageToPanel): void {
    try {
      port?.postMessage(message);
    } catch {
      port = null;
    }
  }

  // ── Frame ──────────────────────────────────────────────────────────────────────────────────

  function layout(): void {
    frame.style.height = `${Math.max(MIN_HEIGHT, height)}px`;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    position.right = clamp(position.right, 0, viewportWidth - frame.offsetWidth);
    position.bottom = clamp(position.bottom, 0, window.innerHeight - frame.offsetHeight);
    frame.style.right = `${position.right}px`;
    frame.style.bottom = `${position.bottom}px`;
  }

  /** (Re)enter the top layer, above anything the page promoted since. */
  function raise(): void {
    try {
      if (host.matches(":popover-open")) host.hidePopover();
      host.showPopover();
    } catch {
      // Not connected, or no Popover API: the host still sits at the maximum z-index.
    }
  }

  function show(): void {
    visible = true;
    // A page that rebuilt its <html> children took the host with it; put it back.
    if (!host.isConnected) document.documentElement.append(host);
    frame.hidden = false;
    raise();
    layout();
    iframe.focus();
    post({ type: "shown" });
  }

  function hide(): void {
    stopPick();
    hideHighlight();
    visible = false;
    frame.hidden = true;
    // The keyboard goes back to the page; nobody should be typing into a panel they cannot see.
    iframe.blur();
  }

  // ── Highlight ──────────────────────────────────────────────────────────────────────────────

  function placeHighlight(): void {
    if (!highlighted) return;
    const { element, prefix } = highlighted;
    if (!element.isConnected) {
      hideHighlight();
      return;
    }
    const rect = element.getBoundingClientRect();
    box.hidden = false;
    tag.hidden = false;
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    tag.textContent = `${prefix}${labelFor(element)}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`;

    // Above the element when there is room, below it otherwise, inside it as the last resort.
    let top = rect.top - TAG_HEIGHT - 4;
    if (top < 4) top = rect.bottom + 4;
    if (top + TAG_HEIGHT > window.innerHeight - 4) top = clamp(rect.top + 4, 4, window.innerHeight - TAG_HEIGHT - 4);
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    tag.style.top = `${top}px`;
    tag.style.left = `${clamp(rect.left, 4, viewportWidth - tag.offsetWidth - 4)}px`;
  }

  function showHighlight(element: Element, prefix = ""): void {
    highlighted = { element, prefix };
    placeHighlight();
  }

  function hideHighlight(): void {
    highlighted = null;
    box.hidden = true;
    tag.hidden = true;
  }

  /** Scrolling and resizing move the page under a fixed outline; follow it once per frame. */
  function onViewportChange(): void {
    if (frameRequest || !(highlighted || pick || visible)) return;
    frameRequest = requestAnimationFrame(() => {
      frameRequest = 0;
      if (visible) layout();
      if (pick?.point) hover(pick.point.x, pick.point.y);
      else placeHighlight();
    });
  }

  function find(target: RefTarget): Element | null {
    const known = picked.get(target.id)?.deref();
    if (known?.isConnected) return known;
    // A reference picked on another page says nothing about this one.
    const there = new URL(target.url, location.href);
    if (there.origin !== location.origin || there.pathname !== location.pathname) return null;
    return resolveSelector(target.selector, document);
  }

  function prefixOf(target: RefTarget): string {
    return target.number ? `[${target.number}] ` : "";
  }

  // ── Picking ────────────────────────────────────────────────────────────────────────────────

  /** The innermost element at a point, looking through the selector itself and into shadow trees. */
  function elementAt(x: number, y: number): Element | null {
    let element = document.elementsFromPoint(x, y).find((candidate) => candidate !== host) ?? null;
    for (let depth = 0; element && depth < 32; depth++) {
      const root = shadowRootOf(element);
      if (!root) break;
      const inner = root.elementsFromPoint(x, y).find((candidate) => candidate.getRootNode() === root);
      if (!inner) break;
      element = inner;
    }
    return element;
  }

  function lineage(leaf: Element): Element[] {
    const chain = [leaf];
    for (let current = parentAcrossShadow(leaf); current && current !== document.documentElement; current = parentAcrossShadow(current)) {
      chain.push(current);
    }
    return chain;
  }

  function hover(x: number, y: number): void {
    if (!pick) return;
    pick.point = { x, y };
    const leaf = elementAt(x, y);
    if (!leaf) {
      pick.chain = [];
      hideHighlight();
      return;
    }
    // Same innermost element: keep the level the arrow keys chose.
    if (pick.chain[0] !== leaf) {
      pick.chain = lineage(leaf);
      pick.index = 0;
    }
    showHighlight(pick.chain[pick.index]!);
  }

  function snapshot(element: Element): { element: Element; ref: ElementRef } {
    // The same element picked twice is one reference, so it keeps one number in the message.
    return { element, ref: describe(element, idOf.get(element)) };
  }

  function commit({ element, ref }: { element: Element; ref: ElementRef }): void {
    picked.set(ref.id, new WeakRef(element));
    idOf.set(element, ref.id);
    stopPick();
    iframe.focus();
    post({ type: "picked", ref });
  }

  function pickKey(key: PickKey): void {
    if (!pick) return;
    if (key === "Escape") {
      stopPick();
      iframe.focus();
      return;
    }
    const current = pick.chain[pick.index];
    if (!current) return;
    if (key === "Enter") {
      commit(snapshot(current));
      return;
    }
    pick.index = clamp(pick.index + (key === "ArrowUp" ? 1 : -1), 0, pick.chain.length - 1);
    showHighlight(pick.chain[pick.index]!);
  }

  function onPickKeyDown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey || !PICK_KEYS.includes(event.key as PickKey)) return;
    // The page must not scroll on the arrows or close its own dialog on Escape.
    event.preventDefault();
    event.stopImmediatePropagation();
    pickKey(event.key as PickKey);
  }

  function startPick(): void {
    if (pick || !visible) {
      // The panel assumed its request would succeed; tell it how things actually stand.
      post({ type: "pick:state", picking: pick !== null });
      return;
    }
    pick = { chain: [], index: 0, point: null, pressed: null };
    layer.hidden = false;
    hint.hidden = false;
    raise();
    window.addEventListener("keydown", onPickKeyDown, true);
    post({ type: "pick:state", picking: true });
  }

  function stopPick(): void {
    if (!pick) {
      post({ type: "pick:state", picking: false });
      return;
    }
    pick = null;
    layer.hidden = true;
    hint.hidden = true;
    hideHighlight();
    window.removeEventListener("keydown", onPickKeyDown, true);
    post({ type: "pick:state", picking: false });
  }

  /**
   * The layer covers the page, so the wheel would only ever scroll the viewport. Scroll the
   * nearest scrollable ancestor of whatever is under the pointer instead, as the page would have.
   */
  function onWheel(event: WheelEvent): void {
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1;
    const left = event.deltaX * unit;
    const top = event.deltaY * unit;
    for (let current = elementAt(event.clientX, event.clientY); current && current !== document.documentElement; current = parentAcrossShadow(current)) {
      if (current.scrollHeight <= current.clientHeight && current.scrollWidth <= current.clientWidth) continue;
      const style = getComputedStyle(current);
      if (!/(auto|scroll|overlay)/.test(style.overflowX + style.overflowY)) continue;
      const before = { left: current.scrollLeft, top: current.scrollTop };
      current.scrollBy({ left, top, behavior: "instant" });
      if (current.scrollLeft !== before.left || current.scrollTop !== before.top) {
        event.preventDefault();
        return;
      }
      // Already at its end in this direction: the scroll chains to the next ancestor.
    }
    // Nothing inner moved; the browser scrolls the viewport itself.
  }

  layer.addEventListener("pointermove", (event) => hover(event.clientX, event.clientY));
  layer.addEventListener("pointerleave", () => {
    if (!pick) return;
    pick.chain = [];
    pick.point = null;
    hideHighlight();
  });
  layer.addEventListener("pointerdown", (event) => {
    if (!pick || event.button !== 0) return;
    hover(event.clientX, event.clientY);
    const element = pick.chain[pick.index];
    pick.pressed = element ? snapshot(element) : null;
  });
  layer.addEventListener("mousedown", (event) => event.preventDefault());
  layer.addEventListener("click", () => {
    if (pick?.pressed) commit(pick.pressed);
  });
  layer.addEventListener("wheel", onWheel, { passive: false });
  // The page never hears about any of it: its click-outside handlers would close the very menu
  // being pointed at. (Registered last, so the handlers above have already run.)
  for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "dblclick", "auxclick", "contextmenu"]) {
    layer.addEventListener(type, (event) => event.stopPropagation());
  }
  // Dragging the frame by the panel's header.
  const endDrag = () => {
    drag = null;
    grip.classList.remove("dragging");
  };
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    grip.setPointerCapture(event.pointerId);
    grip.classList.add("dragging");
    drag = { x: event.clientX, y: event.clientY, ...position };
  });
  grip.addEventListener("pointermove", (event) => {
    if (!drag) return;
    position.right = drag.right - (event.clientX - drag.x);
    position.bottom = drag.bottom - (event.clientY - drag.y);
    layout();
  });
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  grip.addEventListener("lostpointercapture", endDrag);
  // Keeps the focus where it was (the editor, usually) and the page's text unselected.
  grip.addEventListener("mousedown", (event) => event.preventDefault());
  for (const type of ["pointerdown", "pointerup", "pointermove", "mousedown", "mouseup", "mousemove", "click", "dblclick"]) {
    grip.addEventListener(type, (event) => event.stopPropagation());
  }

  // A page's focus trap must not see focus arrive in the panel and pull it back.
  for (const type of ["focusin", "focusout"]) {
    frame.addEventListener(type, (event) => event.stopPropagation());
  }

  // ── Panel link ─────────────────────────────────────────────────────────────────────────────

  function onPanelMessage(message: PanelToPage): void {
    switch (message.type) {
      case "pick:start":
        startPick();
        break;
      case "pick:cancel":
        stopPick();
        break;
      case "pick:key":
        pickKey(message.key);
        break;
      case "highlight": {
        if (pick) break;
        const element = message.target && find(message.target);
        if (element) showHighlight(element, prefixOf(message.target!));
        else hideHighlight();
        break;
      }
      case "reveal": {
        const element = find(message.target);
        if (!element) break;
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        showHighlight(element, prefixOf(message.target));
        break;
      }
      case "layout":
        height = message.height;
        grip.style.left = `${message.grip.left}px`;
        grip.style.top = `${message.grip.top}px`;
        grip.style.width = `${message.grip.width}px`;
        grip.style.height = `${message.grip.height}px`;
        layout();
        break;
      case "close":
        hide();
        break;
    }
  }

  chrome.runtime.onConnect.addListener((incoming) => {
    // Only the frame created above knows the nonce. Anything else — the page embedding its own
    // copy of the panel, say — is turned away.
    if (incoming.sender?.id !== chrome.runtime.id || incoming.name !== PANEL_PORT_PREFIX + nonce) {
      incoming.disconnect();
      return;
    }
    port?.disconnect();
    port = incoming;
    incoming.onMessage.addListener(onPanelMessage);
    incoming.onDisconnect.addListener(() => {
      if (port !== incoming) return;
      port = null;
      stopPick();
    });
    if (visible) post({ type: "shown" });
  });

  window.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
  window.addEventListener("resize", onViewportChange, { passive: true });

  show();

  return {
    toggle: () => (visible ? hide() : show()),
    alive: () => {
      try {
        return Boolean(chrome.runtime?.id);
      } catch {
        return false;
      }
    },
  };
}
