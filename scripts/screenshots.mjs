/**
 * Captures the README screenshots from a running production build, with real analysis data.
 *
 *   node --experimental-websocket scripts/screenshots.mjs [http://localhost:3000]
 *
 * Needs the frontend and backend running, and GitHub reachable. Every image shows the real app
 * analyzing a real public repository; nothing is mocked or edited.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const REPO = process.env.SCREENSHOT_REPO ?? "pmndrs/zustand";
const OUT = new URL("../docs/images/", import.meta.url).pathname;
const CHROME =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334;

const profile = mkdtempSync(join(tmpdir(), "gitverse-shots-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let socket;
for (let i = 0; i < 50 && !socket; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    socket = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
  if (!socket) await sleep(200);
}
const ws = new WebSocket(socket);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};
const viewport = (width, height, mobile = false) =>
  send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
const shot = async (name) => {
  const { result } = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(result.data, "base64"));
  console.log(`saved docs/images/${name}.jpg`);
};
const go = async (path, wait = 2500) => {
  await send("Page.navigate", { url: `${BASE}${path}` });
  await sleep(wait);
};
const helpers = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const button = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
  const file = (name) => [...document.querySelectorAll('aside[aria-label="Files"] button')].find((b) => b.textContent.trim().startsWith(name));
  const waitFor = async (check, ms = 30000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await sleep(200); return check(); };
`;

await viewport(1440, 900);

// 1. Landing page.
await go("/", 3500);
await shot("landing");

// 2. The city for a real repository.
await go(`/explore/gh/${REPO}`, 1000);
await run(`(async () => { ${helpers}
  await waitFor(() => document.querySelector("main canvas"));
  await waitFor(() => document.querySelectorAll('[aria-label="Time travel"] [role=option]').length > 0);
  await sleep(2500);
})()`);
await shot("city");

// 3. A selected file, its dependencies traced in the city and the inspector.
await run(`(async () => { ${helpers}
  file("vanilla.ts").click(); await sleep(2500);
})()`);
await shot("dependencies");

// 4. The dependency graph view.
await run(`(async () => { ${helpers}
  button("Open as graph").click(); await sleep(1200);
})()`);
await shot("graph");
await run(`(async () => { ${helpers} button("Back to the city").click(); await sleep(400);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await sleep(1500); })()`);

// 5. A hotspot lens.
await run(`(async () => { ${helpers} button("Complexity").click(); await sleep(1500); })()`);
await shot("lens");
await run(`(async () => { ${helpers} button("Complexity").click(); await sleep(500); })()`);

// 6. AI Architect, answering from evidence.
await run(`(async () => { ${helpers}
  button("✦Ask AI").click(); await sleep(300);
  button("Which files are central").click();
  await waitFor(() => document.querySelector('article[aria-label="Answer"]'));
  await sleep(2500);
})()`);
await shot("ai-architect");

// 7. Time travel: an earlier analyzed commit, with what changed.
await run(`(async () => { ${helpers}
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  document.querySelector("#details-tab-details").click();
  const ready = () => [...document.querySelectorAll('[aria-label="Time travel"] [role=option]')]
    .filter((o) => o.getAttribute("aria-label").endsWith("analyzed.") && o.getAttribute("aria-selected") !== "true");
  await waitFor(() => ready().length > 0, 60000);
  ready()[Math.floor(ready().length / 2)].click();
  await waitFor(() => document.querySelector("header").innerText.includes("historical"), 60000);
  await sleep(3500);
})()`);
await shot("time-travel");

// 8. Mobile.
await viewport(390, 844, true);
await go(`/explore/gh/${REPO}`, 1000);
await run(`(async () => { ${helpers}
  await waitFor(() => document.querySelector("main canvas")); await sleep(3000);
})()`);
await shot("mobile");

ws.close();
const exited = new Promise((r) => chrome.once("exit", r));
chrome.kill();
await exited;
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {}
