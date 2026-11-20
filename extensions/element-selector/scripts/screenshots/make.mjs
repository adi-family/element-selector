/**
 * Takes the Chrome Web Store screenshots: the built extension, driven in a real Chrome on a small
 * demo site, captured at the store's 1280×800.
 *
 * Run:  bun run build && bun run screenshots        → release/screenshots/*.png
 * Optional: CHROME_BIN=/path/to/chrome   SCHEME=light|dark (the panel's theme; default dark)
 *
 * Nothing is drawn on top afterwards — what the pictures show is what the extension does, and the
 * message in the last one is the text this very run copied.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, pause, serveFixtures, until } from "../../tests/harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const output = resolve(root, "release/screenshots");
const scheme = process.env.SCHEME === "light" ? "light" : "dark";

// The demo site answers on a name of its own, so the copied message shows an ordinary address
// rather than a loopback port.
const HOST = "fieldnotes.example";
const site = await serveFixtures(resolve(here, "site"));
const browser = await launch({ extensionDir: resolve(root, "dist"), hostRules: [`MAP ${HOST}:80 127.0.0.1:${site.port}`] });

const SHADOW = `chrome.dom.openOrClosedShadowRoot(document.querySelector("adi-element-selector"))`;
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
const centre = (expression) => `(() => { const r = (${expression}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;

try {
  const [pageTarget] = await browser.targets("page");
  const page = await browser.attach(pageTarget.targetId, "page");
  await page.send("Page.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });

  async function open(path) {
    await page.send("Page.navigate", { url: `http://${HOST}${path}` });
    await until(() => page.evaluate(`location.pathname === ${JSON.stringify(path)} && document.readyState === "complete"`), `page ${path}`);
  }
  async function shot(name) {
    // Let the outline, the frame's size and the fonts come to rest.
    await pause(350);
    const { data } = await page.send("Page.captureScreenshot", { format: "png" });
    const file = resolve(output, `${name}.png`);
    await writeFile(file, Buffer.from(data, "base64"));
    console.log(file);
  }

  await mkdir(output, { recursive: true });
  await open("/");
  await browser.clickAction(pageTarget.targetId);
  const frame = await until(async () => (await browser.targets("iframe")).find((target) => target.url.includes("/panel.html#")), "the panel frame");
  const panel = await browser.attach(frame.targetId, "panel");
  await panel.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await until(() => panel.evaluate(`Boolean(${q('[data-slot="selector-panel"]')})`), "the panel");
  // Copy goes to a stand-in: the last picture needs the text, and nobody's clipboard needs replacing.
  await panel.evaluate(`navigator.clipboard.writeText = async (text) => { window.__copied = text; }`);

  const inContent = (expression) => page.evaluateInExtension(browser.extensionId, expression);
  const picking = () => inContent(`!${SHADOW}.querySelector(".layer").hidden`);
  const editorText = () => panel.evaluate(`${q('[data-slot="selector-editor"]')}.textContent`);
  async function type(text) {
    for (const character of text) {
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: character, text: character });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: character });
    }
  }
  async function key(name, code) {
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: name, windowsVirtualKeyCode: code });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code });
  }
  async function startPick() {
    await panel.evaluate(`${q('[data-action="pick"]')}.click()`);
    await until(picking, "picking to start");
    await until(() => panel.evaluate(`${q('[data-action="pick"]')}.textContent.startsWith("Cancel")`), "the button to offer Cancel");
  }
  const moveTo = (point) => page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "none" });
  async function clickAt(point) {
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  }
  const chipCount = () => panel.evaluate(`document.querySelectorAll('[data-slot="element-chip"]').length`);

  // A headless window is inactive until its first key; let that one settle before the rest.
  await type("C");
  await until(async () => (await editorText()) === "C" && (await panel.evaluate("document.activeElement?.dataset.slot")) === "selector-editor", "the first key");
  await type("ould you make this card");

  // 1 — pointing at an element.
  await startPick();
  const card = await page.evaluate(centre(`${q("article.featured")}.querySelector("h2")`));
  await moveTo(card);
  await key("ArrowUp", 38); // from the heading out to the card itself
  await until(() => inContent(`${SHADOW}.querySelector(".tag").textContent.startsWith("article.post-card")`), "the card outlined");
  await shot("1-point-at-an-element");

  // 2 — the message, with a chip showing which element it stands for.
  await clickAt(card);
  await until(async () => (await chipCount()) === 1, "the first chip");
  await type("a bit smaller? Also give this intro");
  await startPick();
  await moveTo(await page.evaluate(centre(`${q(".intro h1")}`)));
  await key("ArrowUp", 38);
  await until(() => inContent(`${SHADOW}.querySelector(".tag").textContent.startsWith("section.intro")`), "the intro outlined");
  await key("Enter", 13);
  await until(async () => (await chipCount()) === 2, "the second chip");
  await type("more room above.");
  await pause(300);
  // Straight to the panel's own frame: no routing through the page, so no waiting for it.
  const chip = await panel.evaluate(centre(q('[data-slot="element-chip"][data-n="2"]')));
  await panel.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...chip, button: "none" });
  await until(() => inContent(`!${SHADOW}.querySelector(".box").hidden && ${SHADOW}.querySelector(".tag").textContent.startsWith("[2]")`), "the chip's element outlined");
  await shot("2-compose-the-message");

  // 3 — what Copy produced.
  await panel.evaluate(`${q('[data-action="copy"]')}.click()`);
  const message = await until(() => panel.evaluate("window.__copied"), "the copied message");
  await open("/result.html");
  await page.evaluate(`document.getElementById("message").textContent = ${JSON.stringify(message)}`);
  await shot("3-copy-for-your-agent");

  if (browser.errors.length) throw new Error(`Browser errors:\n${browser.errors.join("\n")}`);
} catch (error) {
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  await site.close();
}
