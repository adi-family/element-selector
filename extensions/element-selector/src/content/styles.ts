/**
 * Styles for the few things the content script draws on the page itself: the frame around the
 * panel iframe, the picking layer, and the highlight. They live in a closed shadow root, so the
 * page's CSS cannot reach them and they cannot leak onto the page.
 *
 * Everything is in px, never rem: rem follows the page's root font size, and a site that sets
 * `html { font-size: 62.5% }` must not shrink the selector.
 */
export const PAGE_STYLES = `
:host {
  /* The page's own rules for the host lose to these: inside a shadow tree, !important wins. */
  all: initial !important;
  display: block !important;
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  overflow: visible !important;
  background: none !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
}

.layer {
  position: fixed;
  inset: 0;
  cursor: crosshair;
  pointer-events: auto;
}

.box {
  position: fixed;
  box-sizing: border-box;
  border: 1.5px solid #2563eb;
  border-radius: 3px;
  background: rgb(37 99 235 / 0.12);
  /* A light halo keeps the outline readable on dark and on blue surfaces. */
  box-shadow: 0 0 0 1px rgb(255 255 255 / 0.65);
  pointer-events: none;
}

.tag {
  position: fixed;
  max-width: min(420px, calc(100vw - 16px));
  box-sizing: border-box;
  padding: 2px 6px;
  border-radius: 4px;
  background: #2563eb;
  color: #fff;
  font: 500 11px/16px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.hint {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgb(23 23 23 / 0.94);
  color: #fafafa;
  font: 500 12px/18px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.28);
  pointer-events: none;
}

.hint kbd {
  display: inline-block;
  min-width: 16px;
  margin: 0 2px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgb(255 255 255 / 0.16);
  font: inherit;
  text-align: center;
}

.hint span {
  margin: 0 6px;
  opacity: 0.45;
}

.frame {
  position: fixed;
  box-sizing: border-box;
  width: 400px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.1),
    0 16px 40px -8px rgb(0 0 0 / 0.28),
    0 4px 12px -2px rgb(0 0 0 / 0.12);
  pointer-events: auto;
}

@media (prefers-color-scheme: dark) {
  .frame {
    background: #0a0a0a;
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 0.16),
      0 16px 40px -8px rgb(0 0 0 / 0.6),
      0 4px 12px -2px rgb(0 0 0 / 0.4);
  }
}

.frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

/* Lies over the panel's header and moves the frame. It is here, in the page's document, and not
   in the panel: a drag has to keep receiving the pointer after it leaves the panel's frame, and
   only an element of the document the frame moves in can count on that. */
.grip {
  position: absolute;
  cursor: grab;
  touch-action: none;
}

.grip.dragging {
  cursor: grabbing;
}

[hidden] {
  display: none !important;
}
`;
