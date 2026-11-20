/**
 * What the browser checks need and nothing more: a Chrome with the built extension loaded, a
 * local site to try it on, and a small CDP client. No dependencies.
 *
 * Chrome is driven over --remote-debugging-pipe rather than a debugging port, because the two
 * commands this suite depends on exist only there: Extensions.loadUnpacked (branded Chrome no
 * longer honours --load-extension) and Extensions.triggerAction (a real click on the toolbar
 * button, which is the only thing that grants the extension `activeTab`).
 */
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

export const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/** Polls until `probe` answers something truthy; the browser is asynchronous everywhere. */
export async function until(probe, description, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await pause(25);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}${last ? ` (${last.message})` : ""}`);
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

/**
 * Serves the fixture site. Pages carry a strict Content-Security-Policy — no inline style, no
 * frames — unless the request says `?csp=off`: the selector has to work where a page's own
 * script could not have built it.
 */
export async function serveFixtures(directory) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/favicon.ico") {
      // Chrome asks for one on its own; a 404 would show up as a console error.
      response.writeHead(204).end();
      return;
    }
    const name = url.pathname === "/" || !extname(url.pathname) ? "page.html" : url.pathname.slice(1);
    try {
      const body = await readFile(join(directory, name));
      const headers = { "content-type": TYPES[extname(name)] ?? "application/octet-stream", "cache-control": "no-store" };
      if (name.endsWith(".html") && url.searchParams.get("csp") !== "off") {
        headers["content-security-policy"] = "default-src 'none'; script-src 'self'; style-src 'self'; frame-src 'none'";
      }
      response.writeHead(200, headers).end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    port,
    // Loopback counts as a secure context even over http…
    origin: `http://127.0.0.1:${port}`,
    // …and a name does not. launch() points this one at loopback, so the same site can be
    // visited as the plain-http, not-secure page that an app on a private name is.
    plainHttpOrigin: `http://${PLAIN_HTTP_HOST}:${port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

const PLAIN_HTTP_HOST = "plain-http.test";

export function defaultChromePath() {
  return process.env.CHROME_BIN ?? (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");
}

/**
 * Starts Chrome with a throwaway profile and loads the unpacked extension into it.
 * `hostRules` are extra --host-resolver-rules entries, such as `MAP example.test:80 127.0.0.1:8123`.
 */
export async function launch({ extensionDir, chromePath = defaultChromePath(), headless = !process.env.HEADFUL, hostRules = [] }) {
  const profile = await mkdtemp(join(tmpdir(), "adi-element-selector-"));
  const chrome = spawn(chromePath, [
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--window-size=1280,800",
    `--host-resolver-rules=${[`MAP ${PLAIN_HTTP_HOST} 127.0.0.1`, ...hostRules].join(", ")}`,
    ...(headless ? ["--headless=new"] : []),
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const [, , , toChrome, fromChrome] = chrome.stdio;

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  let buffered = Buffer.alloc(0);
  fromChrome.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (let end = buffered.indexOf(0); end !== -1; end = buffered.indexOf(0)) {
      const message = JSON.parse(buffered.subarray(0, end).toString("utf8"));
      buffered = buffered.subarray(end + 1);
      if (message.id) {
        const waiting = pending.get(message.id);
        if (!waiting) continue;
        pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.error) waiting.reject(new Error(`${waiting.method}: ${JSON.stringify(message.error)}`));
        else waiting.resolve(message.result);
      } else {
        for (const listener of listeners) listener(message);
      }
    }
  });

  function send(method, params = {}, sessionId) {
    const id = nextId++;
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      pending.set(id, { resolve: done, reject, timer, method });
      toChrome.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  /** Console errors and uncaught exceptions from every attached target, with where they came from. */
  const errors = [];

  /** Attaches to a target and answers a session that can evaluate script in it. */
  async function attach(targetId, label) {
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const contexts = new Map();
    const onEvent = (message) => {
      if (message.sessionId !== sessionId) return;
      const { method, params } = message;
      if (method === "Runtime.executionContextCreated") contexts.set(params.context.id, params.context);
      if (method === "Runtime.executionContextDestroyed") contexts.delete(params.executionContextId);
      if (method === "Runtime.executionContextsCleared") contexts.clear();
      if (method === "Runtime.exceptionThrown") {
        errors.push(`[${label}] ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`);
      }
      if (method === "Runtime.consoleAPICalled" && params.type === "error") {
        errors.push(`[${label}] ${params.args.map((item) => item.value ?? item.description).join(" ")}`);
      }
      if (method === "Log.entryAdded" && params.entry.level === "error") errors.push(`[${label}] ${params.entry.text}`);
    };
    listeners.add(onEvent);
    await send("Runtime.enable", {}, sessionId);
    await send("Log.enable", {}, sessionId).catch(() => {});

    async function evaluate(expression, contextId) {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
        ...(contextId ? { contextId } : {}),
      }, sessionId);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return result.result.value;
    }

    return {
      sessionId,
      send: (method, params) => send(method, params, sessionId),
      evaluate,
      /** Evaluates in the content script's isolated world — the only place its closed shadow root can be opened. */
      async evaluateInExtension(extensionId, expression) {
        const context = await until(
          () => [...contexts.values()].find((item) => item.auxData?.type === "isolated" && item.origin === `chrome-extension://${extensionId}`),
          "the content script's world",
        );
        return evaluate(expression, context.id);
      },
      detach: () => {
        listeners.delete(onEvent);
        return send("Target.detachFromTarget", { sessionId }).catch(() => {});
      },
    };
  }

  const { id: extensionId } = await send("Extensions.loadUnpacked", { path: resolve(extensionDir) });

  async function targets(type) {
    const { targetInfos } = await send("Target.getTargets", { filter: [{ type }] });
    return targetInfos;
  }

  // A click on the button is lost until the freshly installed worker has registered for it.
  const worker = await until(
    async () => (await targets("service_worker")).find((target) => target.url.startsWith(`chrome-extension://${extensionId}/`)),
    "the extension's service worker",
  );
  const background = await attach(worker.targetId, "background");
  await until(() => background.evaluate("chrome.action.onClicked.hasListeners()"), "the worker to listen for the button");
  await background.detach();

  return {
    extensionId,
    errors,
    send,
    attach,
    targets,
    /** A real click on the extension's toolbar button for the given page. */
    async clickAction(pageTargetId) {
      await until(async () => {
        // The action belongs to the tab; a page target is the document currently inside it, and
        // the two share nothing but the URL.
        const page = (await targets("page")).find((target) => target.targetId === pageTargetId);
        const tabs = await targets("tab");
        const tab = tabs.find((target) => target.url === page?.url) ?? tabs[0];
        try {
          await send("Extensions.triggerAction", { id: extensionId, targetId: tab.targetId });
          return true;
        } catch (error) {
          // Early in a fresh browser's life the tab exists before its window does.
          if (/not attached to a browser window/.test(error.message)) return false;
          throw error;
        }
      }, "the toolbar button to be clickable");
    },
    async close() {
      chrome.kill();
      await new Promise((done) => chrome.once("exit", done));
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
