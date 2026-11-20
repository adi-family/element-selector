import { HOST_TAG } from "../shared/protocol";
import { createSelector, type Selector } from "./app";

/**
 * Entry point of the injected script. The background worker injects this file every time the
 * toolbar button is used; the script's world outlives each injection, so the first run builds
 * the selector and every later one finds it here and toggles it.
 */
const KEY = "__adiElementSelector";
const scope = globalThis as typeof globalThis & { [KEY]?: Selector };

function run(): void {
  const existing = scope[KEY];
  try {
    if (existing?.alive()) {
      existing.toggle();
      return;
    }
  } catch {
    // Left behind by a previous version of the extension; replaced below.
  }
  // An orphaned selector can no longer talk to its panel. Clear its remains before starting over.
  document.querySelectorAll(HOST_TAG).forEach((stale) => stale.remove());
  try {
    scope[KEY] = createSelector();
  } catch (error) {
    // Documents that are not HTML (a bare SVG or XML file) cannot host the selector.
    console.warn("ADI Element Selector could not start on this document.", error);
  }
}

run();
