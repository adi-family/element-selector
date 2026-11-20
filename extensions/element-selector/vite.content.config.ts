import path from "node:path";

import { defineConfig } from "vite";

// The content script: one classic script, no imports, no React. It is injected into arbitrary
// pages on demand (chrome.scripting.executeScript), so it stays small and dependency-free; the
// composer UI lives in the panel iframe instead.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    // Runs after the main build and adds content.js next to its output.
    emptyOutDir: false,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/content/index.ts"),
      formats: ["iife"],
      name: "adiElementSelector",
      fileName: () => "content.js",
    },
  },
});
