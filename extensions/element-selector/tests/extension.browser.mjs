/**
 * End-to-end checks of the built extension in a real Chrome: the toolbar button, the picker on a
 * page with a strict Content-Security-Policy, the composer, the copied message, the draft.
 *
 * Run:  bun run build && bun run test:browser
 * Optional: CHROME_BIN=/path/to/chrome   BROWSER_SCREENSHOTS_DIR=/tmp   EXTENSION_DIR=/unzipped/release
 *           HEADFUL=1  — watch it run. A visible browser shares your clipboard, so Copy goes to
 *                        a stand-in then; add REAL_CLIPBOARD=1 to use (and replace) the real one.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, pause, serveFixtures, until } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const site = await serveFixtures(resolve(here, "fixtures"));
// EXTENSION_DIR points the suite at another copy of the build — an unzipped release, say.
const browser = await launch({ extensionDir: process.env.EXTENSION_DIR ?? resolve(here, "../dist") });
const checks = [];

const HOST = "adi-element-selector";
/** The content script's closed shadow root, reachable only from the content script's own world. */
const SHADOW = `chrome.dom.openOrClosedShadowRoot(document.querySelector("${HOST}"))`;
const rectOf = (expression) => `(() => { const r = (${expression}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`;
const q = (selector) => `document.querySelector(${JSON.stringify(selector)})`;

try {
  const [pageTarget] = await browser.targets("page");
  const page = await browser.attach(pageTarget.targetId, "page");
  await page.send("Page.enable");
  let panel;
  let panelTargetId;

  const inContent = (expression) => page.evaluateInExtension(browser.extensionId, expression);
  const inPanel = (expression) => panel.evaluate(expression);

  async function open(path, origin = site.origin) {
    const url = `${origin}${path}`;
    await page.send("Page.navigate", { url });
    await until(() => page.evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === "complete" && Boolean(window.heard)`), `page ${url}`);
  }

  /** Clicks the toolbar button and attaches to the panel frame it opens. */
  async function openSelector() {
    await browser.clickAction(pageTarget.targetId);
    const frame = await until(async () => (await browser.targets("iframe")).find((target) => target.url.includes("/panel.html#")), "the panel frame");
    panelTargetId = frame.targetId;
    panel = await browser.attach(frame.targetId, "panel");
    await until(() => inPanel(`Boolean(${q('[data-slot="selector-panel"]')})`), "the panel to connect to the page");
  }

  async function mouse(type, point, extra = {}) {
    await page.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "none", ...extra });
  }
  async function click(point) {
    await mouse("mouseMoved", point);
    await mouse("mousePressed", point, { button: "left", clickCount: 1 });
    await mouse("mouseReleased", point, { button: "left", clickCount: 1 });
  }
  /** A key press. With `text`, the press also types it, as Enter does a line break. */
  async function key(name, modifiers = 0, text) {
    const codes = { Escape: 27, Enter: 13, ArrowUp: 38, ArrowDown: 40, Backspace: 8, e: 69 };
    const code = name.length === 1 ? `Key${name.toUpperCase()}` : name;
    const base = { key: name, code, windowsVirtualKeyCode: codes[name], modifiers };
    await page.send("Input.dispatchKeyEvent", text ? { type: "keyDown", text, ...base } : { type: "rawKeyDown", ...base });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  const MOD = process.platform === "darwin" ? 4 : 2;
  /** Types as a keyboard does, a key press per character, into whatever has the focus. */
  async function type(text, session = page) {
    for (const character of text) {
      await session.send("Input.dispatchKeyEvent", { type: "keyDown", key: character, text: character });
      await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: character });
    }
  }

  /** The centre of a page element, in viewport coordinates. */
  async function pagePoint(selector, at = { x: 0.5, y: 0.5 }) {
    const rect = await page.evaluate(rectOf(q(selector)));
    return { x: rect.x + rect.width * at.x, y: rect.y + rect.height * at.y };
  }
  /**
   * The frame follows the panel's content height, and the two live in different processes: for a
   * moment after the message wraps onto a new line, the frame has its new size and the panel
   * still draws its old layout. A person takes far longer than that to reach for the mouse; a
   * script does not, and would press on one layout and release on the other.
   */
  async function settled() {
    await until(async () => {
      const frame = await inContent(rectOf(`${SHADOW}.querySelector(".frame")`));
      const inner = await inPanel(`({
        height: innerHeight,
        wanted: ${q('[data-slot="selector-header"]')}.offsetHeight + ${q('[data-slot="selector-footer"]')}.offsetHeight
          + Math.min(${q('[data-slot="selector-editor"]')}.offsetHeight, 280),
      })`);
      return Math.round(frame.height) === inner.height && inner.height === inner.wanted;
    }, "the frame and the panel to agree on a size");
    // Agreeing is not yet having drawn it: Chrome routes a click by the last frame it composited.
    const painted = "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))";
    await inPanel(painted);
    await page.evaluate(painted);
    await inPanel(painted);
  }
  /** The centre of something inside the panel, in the page's viewport coordinates. */
  async function panelPoint(selector) {
    await settled();
    const frame = await inContent(rectOf(`${SHADOW}.querySelector(".frame")`));
    const rect = await inPanel(rectOf(q(selector)));
    return { x: frame.x + rect.x + rect.width / 2, y: frame.y + rect.y + rect.height / 2 };
  }
  /** Moves the pointer over something in the panel and waits until the panel agrees it is there. */
  async function hoverPanel(selector) {
    let nudge = 0;
    await until(async () => {
      const point = await panelPoint(selector);
      // A repeated move to the same spot is not an event; shift it by a hair each try.
      await mouse("mouseMoved", { x: point.x + (nudge ^= 1), y: point.y });
      return inPanel(`${q(selector)}.matches(":hover")`);
    }, `the pointer over ${selector}`);
    return panelPoint(selector);
  }
  async function clickPanel(selector) {
    const point = await hoverPanel(selector);
    await mouse("mousePressed", point, { button: "left", clickCount: 1 });
    await mouse("mouseReleased", point, { button: "left", clickCount: 1 });
  }
  const overlay = () => inContent(`(() => {
    const root = ${SHADOW};
    const box = root.querySelector(".box");
    const r = box.getBoundingClientRect();
    return {
      picking: !root.querySelector(".layer").hidden,
      hint: !root.querySelector(".hint").hidden,
      highlighted: !box.hidden,
      box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      tag: root.querySelector(".tag").textContent,
      frameHidden: root.querySelector(".frame").hidden,
    };
  })()`);
  const rounded = async (selector) => {
    const r = await page.evaluate(rectOf(q(selector)));
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const chips = () => inPanel(`[...document.querySelectorAll('[data-slot="element-chip"]')].map((chip) => chip.dataset.n + ":" + chip.textContent)`);
  const editorText = () => inPanel(`${q('[data-slot="selector-editor"]')}.textContent`);
  const pickButton = () => inPanel(`${q('[data-action="pick"]')}.textContent`);
  const heard = () => page.evaluate("window.heard");
  const startPick = async () => {
    await clickPanel('[data-action="pick"]');
    await until(async () => (await overlay()).picking, "picking to start");
  };
  async function screenshot(name) {
    if (!process.env.BROWSER_SCREENSHOTS_DIR) return;
    await pause(200);
    const path = resolve(process.env.BROWSER_SCREENSHOTS_DIR, `element-selector-${name}.png`);
    const shot = await page.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(shot.data, "base64"));
    console.log(`Screenshot: ${path}`);
  }
  async function check(name, run) {
    await run();
    checks.push(name);
    console.log(`PASS ${name}`);
  }

  // What Copy puts on the clipboard. Headless Chrome keeps a clipboard of its own, so the real
  // API is exercised there without replacing what the developer had copied. A visible browser
  // shares the system clipboard, so there a stand-in catches the text unless REAL_CLIPBOARD asks.
  const realClipboard = !process.env.HEADFUL || Boolean(process.env.REAL_CLIPBOARD);
  if (realClipboard) {
    await browser.send("Browser.grantPermissions", { origin: site.origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  }
  async function copied() {
    if (!realClipboard) return inPanel("window.__copied");
    // Reading needs the focus, which the panel has; take it for the length of the read.
    return page.evaluate("(window.focus(), navigator.clipboard.readText())");
  }
  async function standInClipboard() {
    if (realClipboard) return;
    await inPanel(`navigator.clipboard.writeText = async (text) => { window.__copied = text; }`);
  }

  await open("/blog/");
  const before = await heard();

  await check("The toolbar button opens the selector on a page with a strict CSP", async () => {
    await openSelector();
    const state = await inContent(`(() => {
      const host = document.querySelector("${HOST}");
      const root = ${SHADOW};
      const frame = root.querySelector(".frame").getBoundingClientRect();
      return {
        display: getComputedStyle(host).display,
        topLayer: host.matches(":popover-open"),
        iframeBorder: getComputedStyle(root.querySelector("iframe")).borderTopWidth,
        right: document.documentElement.clientWidth - frame.right,
        bottom: innerHeight - frame.bottom,
        width: frame.width,
      };
    })()`);
    // The fixture's stylesheet hides the host and reddens every iframe; neither may take effect.
    assert.deepEqual(state, { display: "block", topLayer: true, iframeBorder: "0px", right: 16, bottom: 16, width: 400 });
    const look = await inPanel(`({
      background: getComputedStyle(document.body).backgroundColor,
      rootFont: getComputedStyle(document.documentElement).fontSize,
      focused: document.activeElement?.dataset.slot,
      copyDisabled: ${q('[data-action="copy"]')}.disabled,
    })`);
    assert.match(look.background, /^oklch\(/, "the design system's tokens are applied");
    assert.equal(look.rootFont, "16px", "the page's 62.5% root font size stays outside the panel");
    assert.equal(look.focused, "selector-editor", "the editor is ready to type in");
    assert.equal(look.copyDisabled, true, "nothing to copy yet");
    await screenshot("open");
  });

  await check("The editor takes the caret back when the browser window gains focus", async () => {
    // A headless window starts out inactive. The first key activates it, and Chrome drops the
    // frame's focused element on the way — as it can when a person switches back to the browser.
    await type("x");
    await until(async () => (await inPanel("document.activeElement?.dataset.slot")) === "selector-editor" && (await editorText()) === "x", "the caret back in the editor");
    await key("Backspace");
    await until(async () => (await editorText()) === "", "an empty editor again");
    // From here on the window counts as focused, which is how a person's browser is.
    await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  });

  await check("Typing goes to the editor and the frame grows with the message", async () => {
    const small = (await inContent(rectOf(`${SHADOW}.querySelector(".frame")`))).height;
    await type("Could you make this block");
    await until(async () => (await editorText()) === "Could you make this block", "typed text");
    await inPanel(`document.execCommand("insertText", false, "\\n\\n\\n\\n\\n")`);
    await until(async () => (await inContent(rectOf(`${SHADOW}.querySelector(".frame")`))).height > small + 60, "the frame to grow");
    for (let i = 0; i < 5; i++) await key("Backspace");
    await until(async () => (await inContent(rectOf(`${SHADOW}.querySelector(".frame")`))).height === small, "the frame to shrink back");
    assert.equal(await editorText(), "Could you make this block");
    assert.equal((await heard()).keydown, before.keydown, "the page hears none of the typing");
  });

  await check("Picking outlines what is under the pointer and the arrows walk to its parents", async () => {
    await startPick();
    await until(async () => (await pickButton()) === "CancelEsc", "the button to offer Cancel");
    assert.equal((await overlay()).hint, true);

    await mouse("mouseMoved", await pagePoint("article.featured h2"));
    await until(async () => (await overlay()).highlighted, "an outline");
    let state = await overlay();
    assert.deepEqual(state.box, await rounded("article.featured h2"));
    assert.match(state.tag, /^h2 {2}\d+ × \d+$/);

    await key("ArrowUp");
    state = await overlay();
    assert.deepEqual(state.box, await rounded("article.featured"), "ArrowUp selects the parent");
    assert.match(state.tag, /^article\.post-card {2}/);
    await key("ArrowUp");
    assert.match((await overlay()).tag, /^section\.posts {2}/);
    await key("ArrowDown");
    assert.deepEqual((await overlay()).box, await rounded("article.featured"), "ArrowDown steps back in");
    await screenshot("picking");
  });

  await check("A click adds the element to the message and never reaches the page", async () => {
    const point = await pagePoint("article.featured h2");
    await mouse("mousePressed", point, { button: "left", clickCount: 1 });
    await mouse("mouseReleased", point, { button: "left", clickCount: 1 });
    await until(async () => (await chips()).length === 1, "a chip");
    assert.deepEqual(await chips(), ["1:article.post-card"]);
    assert.equal(await editorText(), "Could you make this block article.post-card ", "spaced as a person would type it");
    const state = await overlay();
    assert.equal(state.picking, false, "picking ends with the pick");
    assert.equal(state.highlighted, false);
    await until(async () => (await pickButton()) === `Select element${process.platform === "darwin" ? "⌘E" : "Ctrl+E"}`, "the button to offer picking again");
    assert.deepEqual(await heard(), before, "the page saw no click, press or key");
    assert.equal(await page.evaluate("location.pathname"), "/blog/", "the link under the pointer was not followed");
    assert.equal(await inPanel("document.activeElement?.dataset.slot"), "selector-editor", "focus is back in the editor");
  });

  await check("The message continues after the chip, and Escape leaves picking empty-handed", async () => {
    await type("smaller? Also keep this container");
    await key("e", MOD);
    await until(async () => (await overlay()).picking, "the shortcut to start picking");
    await key("Escape");
    await until(async () => !(await overlay()).picking, "Escape to cancel");
    assert.equal((await chips()).length, 1);
    assert.equal(await inPanel("document.activeElement?.dataset.slot"), "selector-editor");
  });

  await check("Enter picks the outlined element; the same element keeps its number", async () => {
    await startPick();
    // The gap between the columns belongs to the container itself.
    const gap = await page.evaluate(`(() => { const a = ${q(".posts")}.getBoundingClientRect(); const b = ${q("#sidebar")}.getBoundingClientRect(); return { x: (a.right + b.left) / 2, y: a.top + 40 }; })()`);
    await mouse("mouseMoved", gap);
    await until(async () => (await overlay()).tag.startsWith("div.container"), "the container outlined");
    await key("Enter");
    await until(async () => (await chips()).length === 2, "a second chip");
    await type("centred, and");
    await startPick();
    await click(await pagePoint("article.featured", { x: 0.9, y: 0.1 }));
    await until(async () => (await chips()).length === 3, "a third chip");
    assert.deepEqual(await chips(), ["1:article.post-card", "2:div.container", "1:article.post-card"]);
    await type("untouched.");
  });

  await check("Hovering a chip outlines its element; clicking it scrolls the element into view", async () => {
    await hoverPanel('[data-slot="element-chip"][data-n="2"]');
    await until(async () => (await overlay()).highlighted, "the chip's element outlined");
    let state = await overlay();
    assert.deepEqual(state.box, await rounded(".container"));
    assert.match(state.tag, /^\[2\] div\.container {2}/);
    await hoverPanel('[data-slot="selector-footer"]');
    await until(async () => !(await overlay()).highlighted, "the outline to go with the pointer");

    await page.evaluate(`${q("article.featured")}.style.marginBottom = "1600px"; scrollTo(0, 1500)`);
    await clickPanel('[data-slot="element-chip"][data-n="1"]');
    await until(() => page.evaluate(`(() => { const r = ${q("article.featured")}.getBoundingClientRect(); return scrollY < 700 && r.top >= 0 && r.bottom <= innerHeight; })()`), "the element scrolled into view");
    await until(async () => JSON.stringify((await overlay()).box) === JSON.stringify(await rounded("article.featured")), "the outline to follow the scroll");
    await page.evaluate(`${q("article.featured")}.style.marginBottom = ""; scrollTo(0, 0)`);
    await hoverPanel('[data-slot="selector-footer"]');
  });

  let message;
  await check("Copy produces a message with a verified path to every element", async () => {
    await standInClipboard();
    await clickPanel('[data-action="copy"]');
    await until(async () => (await inPanel(`${q('[data-action="copy"]')}.textContent`)) === "Copied", "the Copied state");
    message = await copied();
    const article = await rounded("article.featured");
    const container = await rounded(".container");
    const viewport = await page.evaluate("`${innerWidth}×${innerHeight}`");
    const lines = message.split("\n");
    assert.deepEqual(lines.slice(0, 5), [
      "Could you make this block [1] smaller? Also keep this container [2] centred, and [1] untouched.",
      "",
      "---",
      `Page: Field Notes · Blog — ${site.origin}/blog/ (viewport ${viewport})`,
      "",
    ]);
    assert.deepEqual(lines.slice(5, 9), [
      `[1] \`article.post-card\` — ${article.width}×${article.height} at (${article.x}, ${article.y}) — “How we built the new editor A long look at the parts nobody sees. Read more”`,
      "- selector: `article.post-card.featured`",
      '- html: `<article class="post-card featured flex gap-4" data-post-id="42">`',
      "",
    ]);
    assert.match(lines[9], new RegExp(`^\\[2\\] \`div\\.container\` — ${container.width}×${container.height} at \\(${container.x}, ${container.y}\\) — “Measuring twice Why the second .{1,60}…”$`));
    assert.deepEqual(lines.slice(10), ["- selector: `div.container`", '- html: `<div class="container">`']);
    // The paths are the point: each must find exactly the element that was picked.
    for (const [selector, expected] of [["article.post-card.featured", "article.featured"], ["div.container", ".container"]]) {
      assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length === 1 && ${q(selector)} === ${q(expected)}`), true, selector);
    }
    await screenshot("composed");
  });

  await check("Enter breaks the line, Backspace removes a chip whole, and the shortcut copies", async () => {
    await clickPanel('[data-action="clear"]');
    await until(async () => (await editorText()) === "", "an empty editor");
    await type("one");
    await key("Enter", 0, "\r");
    await type("two");
    await startPick();
    await click(await pagePoint(".brand"));
    await until(async () => (await chips()).length === 1, "a chip");
    await type("x");
    // The editor's content as written, with each chip shown as [chip].
    const content = () => inPanel(`[...${q('[data-slot="selector-editor"]')}.childNodes].map((node) => node.nodeType === 3 ? node.nodeValue : node.dataset?.refId ? "[chip]" : node.nodeName === "BR" ? "\\n" : "").join("")`);
    await until(async () => (await content()) === "one\ntwo [chip] x", "text after the chip");
    for (const expected of ["one\ntwo [chip] ", "one\ntwo [chip]", "one\ntwo "]) {
      await key("Backspace");
      await until(async () => (await content()) === expected, `the content to be ${JSON.stringify(expected)}`);
    }
    assert.equal((await chips()).length, 0, "one Backspace took the whole chip");
    await key("Enter", MOD);
    await until(async () => (await copied()) === "one\ntwo", "the two lines copied");
  });

  await check("A component's data-slot names it, unless it only repeats the tag", async () => {
    await clickPanel('[data-action="clear"]');
    await until(async () => (await chips()).length === 0, "an empty editor");
    for (const [selector, count] of [['[data-slot="badge"]', 1], ['[data-slot="button"]', 2]]) {
      await startPick();
      await click(await pagePoint(selector));
      await until(async () => (await chips()).length === count, "a chip");
    }
    assert.deepEqual(await chips(), ['1:span[data-slot="badge"]', "2:button “Sign in”"]);
    await clickPanel('[data-action="copy"]');
    await until(async () => /\[2\]/.test(await copied()), "the message");
    const text = await copied();
    assert.match(text, /\[1\] `span\[data-slot="badge"\]` — .* — “Beta”\n- selector: `span\[data-slot="badge"\]`\n/);
    assert.match(text, /\[2\] `button` — .* — “Sign in”\n- selector: `button\[data-slot="button"\]`\n/);
  });

  await check("Elements without a name of their own, form fields and shadow trees get usable paths", async () => {
    const pick = async (point) => {
      const count = (await chips()).length;
      await startPick();
      await click(point);
      await until(async () => (await chips()).length === count + 1, "another chip");
    };
    await clickPanel('[data-action="clear"]');
    await until(async () => (await chips()).length === 0, "an empty editor");
    await pick(await pagePoint("#email"));
    await pick(await pagePoint("#sidebar form button"));
    await pick(await pagePoint("#pane li:nth-of-type(2)"));
    // The widget's button sits at its left edge.
    await pick(await page.evaluate(`(() => { const r = ${q("fancy-widget")}.getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`));
    await clickPanel('[data-action="copy"]');
    await until(async () => (await copied()) !== message && /\[4\]/.test(await copied()), "the new message");
    const text = await copied();
    const selectors = [...text.matchAll(/^- selector: `(.+)`$/gm)].map((match) => match[1]);
    assert.deepEqual(selectors, [
      "input#email",
      // Its only classes are a generated one and utilities, so position names it.
      "aside#sidebar > form > button",
      "div#pane > ul > li:nth-of-type(2)",
      "fancy-widget >>> button.widget-action",
    ]);
    assert.match(text, /\[1\] `input#email` — .* — “you@example\.com”\n/, "a field is described by its placeholder");
    assert.doesNotMatch(text, /typed-secret/, "what the user typed into the page is never copied");
    assert.match(text, /- html: `<input id="email" type="email" name="email" placeholder="you@example\.com">`/);
    assert.match(text, /\[2\] `button` — .* — “Subscribe”/, "a generated class is no name");
    assert.deepEqual(await chips(), ["1:input#email", "2:button “Subscribe”", "3:li “Two”", "4:button.widget-action"]);
    assert.match(text, /\[4\] `button\.widget-action` — .* — “Inside the shadow”/);
    for (const selector of selectors.slice(0, 3)) {
      assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`), 1, selector);
    }
  });

  await check("The wheel scrolls the pane under the pointer while picking", async () => {
    await startPick();
    const point = await pagePoint("#pane");
    await mouse("mouseMoved", point);
    await mouse("mouseWheel", point, { deltaX: 0, deltaY: 90 });
    await until(() => page.evaluate(`${q("#pane")}.scrollTop === 90`), "the inner pane to scroll");
    assert.equal(await page.evaluate("scrollY"), 0, "the page itself stays put");
    await key("Escape");
    await until(async () => !(await overlay()).picking, "picking to stop");
  });

  await check("Clear can be undone, and the header drags the frame", async () => {
    const draft = await editorText();
    await clickPanel('[data-action="clear"]');
    await until(async () => (await editorText()) === "", "an empty editor");
    await clickPanel('[data-action="undo-clear"]');
    await until(async () => (await editorText()) === draft, "the message back");
    assert.equal((await chips()).length, 4);

    const start = await inContent(rectOf(`${SHADOW}.querySelector(".frame")`));
    const grip = await panelPoint('[data-slot="selector-header"] h1');
    await mouse("mouseMoved", grip);
    await mouse("mousePressed", grip, { button: "left", clickCount: 1 });
    await mouse("mouseMoved", { x: grip.x - 300, y: grip.y - 200 }, { button: "left", buttons: 1 });
    await mouse("mouseReleased", { x: grip.x - 300, y: grip.y - 200 }, { button: "left", clickCount: 1 });
    await until(async () => {
      const now = await inContent(rectOf(`${SHADOW}.querySelector(".frame")`));
      return Math.round(start.x - now.x) === 300 && Math.round(start.y - now.y) === 200;
    }, "the frame to follow the drag");
    await screenshot("dragged");
  });

  await check("The toolbar button hides the selector and brings it back as it was", async () => {
    const draft = await editorText();
    await browser.clickAction(pageTarget.targetId);
    await until(async () => (await overlay()).frameHidden, "the selector hidden");
    const keys = (await heard()).keydown;
    await type("q");
    await until(async () => (await heard()).keydown === keys + 1, "the keyboard to be back with the page");
    await browser.clickAction(pageTarget.targetId);
    await until(async () => !(await overlay()).frameHidden, "the selector shown again");
    assert.equal(await editorText(), draft);
    assert.equal((await browser.targets("iframe")).length, 1, "the same panel, not a second one");
    await clickPanel('[data-slot="selector-header"] button');
    await until(async () => (await overlay()).frameHidden, "Close to hide it");
  });

  await check("The draft survives a reload, and its chips still find their elements", async () => {
    await pause(250); // the draft is saved shortly after the last change
    await open("/blog/");
    assert.equal(await page.evaluate(`Boolean(${q(HOST)})`), false, "nothing is injected until the button is used");
    await panel.detach();
    await openSelector();
    await until(async () => (await chips()).length === 4, "the saved draft");
    assert.deepEqual(await chips(), ["1:input#email", "2:button “Subscribe”", "3:li “Two”", "4:button.widget-action"]);
    // This page never picked anything: the outline comes from resolving the saved selector.
    await hoverPanel('[data-slot="element-chip"][data-n="4"]');
    await until(async () => (await overlay()).highlighted, "the saved reference outlined");
    assert.match((await overlay()).tag, /^\[4\] button\.widget-action {2}/);
    await hoverPanel('[data-slot="selector-footer"]');
  });

  await check("Two tabs share the draft: what is written in one appears in the other", async () => {
    const first = panel;
    const { targetId } = await browser.send("Target.createTarget", { url: `${site.origin}/second/` });
    const secondPage = await browser.attach(targetId, "second page");
    await secondPage.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await until(() => secondPage.evaluate(`document.readyState === "complete" && Boolean(window.heard)`), "the second tab");
    await browser.clickAction(targetId);
    const frame = await until(async () => (await browser.targets("iframe")).find((target) => target.url.includes("/panel.html#") && target.targetId !== panelTargetId), "a second panel");
    const second = await browser.attach(frame.targetId, "second panel");
    const chipsIn = (session) => session.evaluate(`document.querySelectorAll('[data-slot="element-chip"]').length`);
    await until(async () => (await chipsIn(second)) === 4, "the draft in the second tab");
    await until(() => second.evaluate(`document.activeElement?.dataset.slot === "selector-editor"`), "the second editor focused");
    // The new tab's window is as inactive as the first one was: let its first key activate it
    // and the caret settle before typing on at a machine's pace.
    await type(" ", secondPage);
    await until(() => second.evaluate(`document.activeElement?.dataset.slot === "selector-editor" && ${q('[data-slot="selector-editor"]')}.textContent.endsWith(" ")`), "the second window to settle on its editor");
    await type("— from the other tab", secondPage);
    const shows = (session) => session.evaluate(`${q('[data-slot="selector-editor"]')}.textContent.endsWith(" — from the other tab")`);
    const reads = (session) => session.evaluate(`${q('[data-slot="selector-editor"]')}.textContent + " | focus: " + (document.activeElement?.dataset.slot ?? document.activeElement?.tagName)`);
    const orReport = (session) => async (error) => { throw new Error(`${error.message} — it reads ${JSON.stringify(await reads(session))}`); };
    await until(() => shows(second), "the typing to arrive in the second tab's editor").catch(orReport(second));
    await until(() => shows(first), "the first tab to show it").catch(orReport(first));
    assert.equal(await chipsIn(first), 4);
    await second.detach();
    await secondPage.detach();
    await browser.send("Target.closeTarget", { targetId });
    await browser.send("Target.activateTarget", { targetId: pageTarget.targetId });
  });

  await check("A plain-http site, which is not a secure context, works the same", async () => {
    // Apps on private names are served over plain http. There the page — and the content script
    // with it — has no crypto.randomUUID and no Clipboard API.
    await panel.detach();
    await open("/blog/", site.plainHttpOrigin);
    assert.equal(await page.evaluate("isSecureContext"), false);
    await openSelector();
    await until(async () => (await chips()).length === 4, "the draft");
    await clickPanel('[data-action="clear"]');
    await until(async () => (await editorText()) === "", "an empty editor");
    await type("Over plain http");
    await startPick();
    await click(await pagePoint(".brand"));
    await until(async () => (await chips()).length === 1, "a chip");
    await clickPanel('[data-action="copy"]');
    await until(async () => (await inPanel(`${q('[data-action="copy"]')}.textContent`)) === "Copied", "the Copied state");
    // The clipboard cannot be read from a page that is not secure; go and look from one that is.
    await pause(250);
    await panel.detach();
    await open("/blog/");
    if (realClipboard) {
      assert.deepEqual((await copied()).split("\n").slice(0, 4), [
        "Over plain http [1]",
        "",
        "---",
        `Page: Field Notes · Blog — ${site.plainHttpOrigin}/blog/ (viewport ${await page.evaluate("`${innerWidth}×${innerHeight}`")})`,
      ]);
    }
    await openSelector();
    await until(async () => (await chips()).length === 1, "the draft from the other site");
  });

  await check("A page that embeds the panel itself gets an inert note, never the draft", async () => {
    await panel.detach();
    await open(`/blog/?csp=off&rogue=${browser.extensionId}`);
    const frame = await until(async () => (await browser.targets("iframe")).find((target) => target.url.endsWith("/panel.html")), "the page's own copy of the panel");
    const rogue = await browser.attach(frame.targetId, "rogue panel");
    await until(() => rogue.evaluate(`Boolean(${q('[data-slot="selector-detached"]')})`), "the inert note");
    assert.equal(await rogue.evaluate(`Boolean(${q('[data-slot="selector-editor"]')})`), false);
    assert.doesNotMatch(await rogue.evaluate("document.body.textContent"), /plain http|brand/i);
    await rogue.detach();
  });

  await check("A browser page refuses the selector and the button says so", async () => {
    await page.send("Page.navigate", { url: "chrome://version/" });
    await until(() => page.evaluate(`location.href === "chrome://version/" && document.readyState === "complete"`), "chrome://version");
    await browser.clickAction(pageTarget.targetId);
    const worker = (await browser.targets("service_worker")).find((target) => target.url.startsWith(`chrome-extension://${browser.extensionId}/`));
    const background = await browser.attach(worker.targetId, "background");
    await until(() => background.evaluate(`chrome.tabs.query({ active: true }).then(([tab]) => chrome.action.getBadgeText({ tabId: tab.id })).then((text) => text === "!")`), "the badge");
    assert.equal(await page.evaluate(`Boolean(${q(HOST)})`), false);
  });

  // The frame-src note Chrome logs for the page's own blocked frames is not ours to answer for.
  assert.deepEqual(browser.errors, [], "browser exceptions and console errors");
  console.log(`\n${checks.length} element-selector browser scenarios passed; no exceptions or console errors.`);
} catch (error) {
  console.error(`Browser check failed after ${checks.length} completed scenarios.`);
  console.error(browser.errors.length ? `Collected browser errors:\n${browser.errors.join("\n\n")}` : "No browser errors were collected.");
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  await site.close();
}
