import { readFileSync } from "node:fs";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The extension's two ES-module parts: the composer panel (an extension page, loaded in an iframe
// by the content script) and the background service worker. The content script is a separate
// build (vite.content.config.ts) because Chrome injects it as a classic script — one file, no
// imports — which a multi-entry ES build cannot produce.
const UI_SRC = path.resolve(import.meta.dirname, "../../packages/ui/src");

/**
 * Writes dist/manifest.json from ./manifest.json, taking the version from package.json — so a
 * release is one number changed in one place, and the two can never disagree.
 */
function extensionManifest(): Plugin {
  const manifestPath = path.resolve(import.meta.dirname, "manifest.json");
  const packagePath = path.resolve(import.meta.dirname, "package.json");
  return {
    name: "extension-manifest",
    buildStart() {
      this.addWatchFile(manifestPath);
      this.addWatchFile(packagePath);
    },
    generateBundle() {
      const { manifest_version, name, ...rest } = JSON.parse(readFileSync(manifestPath, "utf8"));
      const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
      const manifest = { manifest_version, name, version, ...rest };
      this.emitFile({ type: "asset", fileName: "manifest.json", source: `${JSON.stringify(manifest, null, 2)}\n` });
    },
  };
}

export default defineConfig({
  // Relative asset URLs: the panel is served from chrome-extension://<id>/, never from "/".
  base: "./",
  plugins: [react(), tailwindcss(), extensionManifest()],
  resolve: {
    alias: {
      // The library's TypeScript source, as in the showcase. The CSS-less barrel: panel.css owns
      // the Tailwind pipeline and pulls the library's tokens in itself.
      "@design-system/ui": path.resolve(UI_SRC, "components.ts"),
    },
    // packages/ui has its own node_modules/react; two React instances break hooks.
    dedupe: ["react", "react-dom", "lucide-react"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: path.resolve(import.meta.dirname, "panel.html"),
        background: path.resolve(import.meta.dirname, "src/background.ts"),
      },
      output: {
        // The manifest names the service worker, so it needs a stable file name at the root.
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
