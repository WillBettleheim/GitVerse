/**
 * Measures real rendering in Chrome on the production build, over the DevTools protocol.
 *
 *   npm run build && npm run start   (in another terminal)
 *   node --experimental-websocket bench/browser.bench.mjs [http://localhost:3000]
 *
 * Uses the installed Google Chrome in new-headless mode with GPU rasterization (Metal through
 * ANGLE on macOS). Pages are the synthetic stress cities, opened with `?perf` so the app records
 * frame times. Numbers describe this machine only.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SIZES = (process.env.BENCH_SIZES ?? "100,500,1000,2500,5000").split(",").map(Number);
const CHROME =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

const profile = mkdtempSync(join(tmpdir(), "gitverse-bench-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    ...(process.env.BENCH_UNCAPPED ? ["--disable-gpu-vsync", "--disable-frame-rate-limit"] : []),
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome didn't start");
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails));
  return reply.result.result.value;
};

await send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
const gpu = await send("SystemInfo.getInfo");
const renderer = gpu.result?.gpu?.auxAttributes?.glRenderer ?? gpu.result?.gpu?.devices?.[0]?.deviceString;

const MEASURE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nav = performance.getEntriesByType("navigation")[0];
  for (let i = 0; i < 100 && !window.__GITVERSE_FIRST_FRAME_MS__; i++) await sleep(100);
  const firstFrameMs = window.__GITVERSE_FIRST_FRAME_MS__;
  const stats = () => window.__GITVERSE_RENDER_STATS__;
  const cinematic = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cinematic");
  cinematic.click();
  await sleep(1500);
  const before = stats().frame;
  const t0 = performance.now();
  await sleep(5000);
  const s = stats();
  const elapsed = (performance.now() - t0) / 1000;
  const ft = [...s.frameTimesMs].slice(-240).sort((a, b) => a - b);
  const pct = (p) => +ft[Math.min(ft.length - 1, Math.floor(ft.length * p))].toFixed(1);
  cinematic.click();
  await sleep(300);
  // Selecting the most connected file: highlight, traversal and arcs for it.
  const hub = [...document.querySelectorAll('aside[aria-label="Files"] button')].find((b) => b.querySelector('[class*="bg-cyan"]'));
  const s0 = performance.now();
  (hub ?? document.querySelector('aside[aria-label="Files"] li button'))?.click();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const selectMs = +(performance.now() - s0).toFixed(1);
  return {
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
    firstFrameMs,
    fps: +((s.frame - before) / elapsed).toFixed(1),
    p50: pct(0.5), p95: pct(0.95), p99: pct(0.99),
    calls: s.calls, triangles: s.triangles, lines: s.lines,
    geometries: s.geometries, programs: s.programs,
    heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
    tier: (document.body.innerText.match(/(high|medium|low) quality/) || [])[1],
    selectMs,
  };
})()`;

if (process.env.BENCH_LOW_POWER) {
  await send("Page.navigate", { url: `${BASE}/` });
  await sleep(500);
  await evaluate(`localStorage.setItem("gitverse:low-power", "1")`);
}
const rows = [];
for (const size of SIZES) {
  await send("Page.navigate", { url: `${BASE}/explore/demo/stress/${size}?perf` });
  await sleep(300);
  rows.push({ files: size, ...(await evaluate(MEASURE)) });
}
console.log(`Chrome headless (new), GPU: ${renderer ?? "unknown"}, viewport ${VIEWPORT.width}x${VIEWPORT.height} @${VIEWPORT.deviceScaleFactor}x`);
console.log(
  `${process.env.BENCH_LOW_POWER ? "LOW POWER MODE. Cinematic is off, so the city idles and renders on demand. " : ""}Continuous rendering (cinematic orbit) for 5 s per city. Times in ms. ${process.env.BENCH_UNCAPPED ? "Vsync and frame-rate limit off: fps shows headroom." : "Vsync on: fps is capped at the display rate."}`,
);
console.table(rows);
ws.close();
const exited = new Promise((r) => chrome.once("exit", r));
chrome.kill();
await exited;
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  // A leftover temporary profile is harmless.
}
