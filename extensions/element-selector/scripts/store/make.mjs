/**
 * Makes the images the Chrome Web Store listing asks for, into release/store/:
 *
 *   store-icon-128.png        128×128 — the icon at 96×96 with 16 px of transparent padding
 *                              around it, which is how the store's image guidelines want it
 *   promo-small-440x280.png   the small promo tile
 *   promo-marquee-1400x560.png the marquee promo tile
 *
 * The tiles are 24-bit PNGs without an alpha channel, as the store requires.
 *
 * Run:  bun run build && bun run screenshots && bun run store-assets
 * Needs rsvg-convert and ImageMagick (brew install librsvg imagemagick). The marquee embeds the
 * first store screenshot, so take the screenshots first.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, pause, serveFixtures, until } from "../../tests/harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const output = resolve(root, "release/store");
const screenshot = resolve(root, "release/screenshots/1-point-at-an-element.png");
await mkdir(output, { recursive: true });

// ── Store icon ──────────────────────────────────────────────────────────────────────────────
const icon = resolve(output, "store-icon-128.png");
const artwork = execFileSync("rsvg-convert", ["--width", "96", "--height", "96", resolve(root, "scripts/icon.svg")]);
execFileSync("magick", ["-", "-background", "none", "-gravity", "center", "-extent", "128x128", `PNG32:${icon}`], { input: artwork });
console.log(icon);

// ── Promo tiles ─────────────────────────────────────────────────────────────────────────────
const TILES = [
  { page: "small.html", width: 440, height: 280, file: "promo-small-440x280.png" },
  { page: "marquee.html", width: 1400, height: 560, file: "promo-marquee-1400x560.png" },
];

const site = await serveFixtures(resolve(here, "site"));
const browser = await launch({ extensionDir: resolve(root, "dist") });
try {
  const [pageTarget] = await browser.targets("page");
  const page = await browser.attach(pageTarget.targetId, "page");
  await page.send("Page.enable");
  const shot = `data:image/png;base64,${(await readFile(screenshot)).toString("base64")}`;

  for (const tile of TILES) {
    // Photographed at twice the size and scaled down: smoother type than a 1× capture gives.
    await page.send("Emulation.setDeviceMetricsOverride", { width: tile.width, height: tile.height, deviceScaleFactor: 2, mobile: false });
    // csp=off: the marquee's screenshot arrives as a data: URL, which the fixture server's policy would refuse.
    await page.send("Page.navigate", { url: `${site.origin}/${tile.page}?csp=off` });
    await until(() => page.evaluate(`location.pathname === "/${tile.page}" && document.readyState === "complete"`), tile.page);
    await page.evaluate(`(async () => {
      const image = document.getElementById("shot");
      if (image) { image.src = ${JSON.stringify(shot)}; await image.decode(); }
      await document.fonts.ready;
    })()`);
    await pause(200);
    const { data } = await page.send("Page.captureScreenshot", { format: "png" });
    const raw = resolve(output, `.${tile.file}`);
    const file = resolve(output, tile.file);
    await writeFile(raw, Buffer.from(data, "base64"));
    // PNG24 with the alpha channel removed: the store rejects tiles that have one.
    execFileSync("magick", [raw, "-filter", "Lanczos", "-resize", `${tile.width}x${tile.height}!`, "-background", "#0a0a0a", "-alpha", "remove", "-alpha", "off", `PNG24:${file}`]);
    await rm(raw);
    console.log(file);
  }
  if (browser.errors.length) throw new Error(`Browser errors:\n${browser.errors.join("\n")}`);
} catch (error) {
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  await site.close();
}
