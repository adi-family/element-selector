/**
 * A random hex string. Not `crypto.randomUUID()`: that exists only in secure contexts, and the
 * content script lives in the context of the page it was injected into — a plain-http site, such
 * as an app on a private `.adi` name, is not one. `getRandomValues` works everywhere.
 */
export function randomId(bytes = 16): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
