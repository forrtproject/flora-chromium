// Benchmark for the per-mutation scan gating (perf-scan-gating branch).
//
// Compares the REAL before and after builds:
//   BEFORE — a temporary worktree of the base branch (origin/fix-editable-guard,
//            the pre-optimisation pipeline), patched with the same tiny
//            `flora-perf-pass` timing hook and built.
//   AFTER  — this repo's current build (run `npm run build` first).
//
// Each build is loaded as a Chrome-for-Testing extension (same bootstrap as the
// visual harness, with the same hermetic storage seed + fetch blocking). The
// driver renders a large "Gmail-like" page (~2 MB DOM, thousands of elements,
// NO DOIs) and fires N synthetic mutations at a fixed interval, summing the
// time spent inside pageRenderChangeHandler per pass. A DOI-bearing article
// fixture is also measured on the AFTER build to show relevant pages still
// scan and badge correctly.
//
// Timing crosses out of the content script's isolated world via a
// `flora-perf-pass` DOM event, enabled only when <html data-flora-perf> is set
// (the benchmark sets it after load; production pages never have it).
//
// Run:  npm run build && npx tsx scripts/bench-scan-gating.ts

import {
  Browser as BrowserName,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
  resolveBuildId,
} from "@puppeteer/browsers";
import puppeteer, { type Browser, type Page, type Target } from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../tests/visual/server.js";
import {
  buildLocalSeed,
  buildSyncSeed,
  classifyPageRequest,
  isBlockedWorkerHost,
} from "../tests/visual/mocks.js";

declare const chrome: any;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BASE_REF = "origin/fix-editable-guard";

const N_MUTATIONS = 20;
const MUTATION_INTERVAL_MS = 400;

// ── Large DOI-free "Gmail-like" fixture (~2 MB, thousands of elements) ───────
function buildGmailLikeHtml(): string {
  const rows: string[] = [];
  for (let i = 0; i < 3500; i++) {
    rows.push(
      `<div class="zA" role="listitem" id="row-${i}">` +
        `<div class="yW"><span class="yP">Sender Name ${i}</span></div>` +
        `<div class="xY"><div class="y6"><span class="bog">Subject line ${i}: quarterly sync notes and action items</span>` +
        `<span class="y2"> — Body preview number ${i}, meeting at 9:30 about budget v10.2 and the $10.50 refund; ` +
        `see attachment and reply by Friday. Reference ${i} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.</span></div></div>` +
        `<div class="xW"><span class="xS">10:${(i % 60).toString().padStart(2, "0")} AM</span></div>` +
        `</div>`,
    );
  }
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inbox</title></head>` +
    `<body><div id="app" role="main"><div class="Cp"><div class="ae4">${rows.join("")}</div></div></div></body></html>`
  );
}

// Page-context driver: collects flora-perf-pass events; fires synthetic
// mutations; waits for the debounced passes; reports totals.
const DRIVER = `
window.__floraPerf = { passes: [], kinds: [], total: 0 };
document.addEventListener('flora-perf-pass', (e) => {
  const d = e.detail || {};
  window.__floraPerf.passes.push(typeof d.ms === 'number' ? d.ms : 0);
  window.__floraPerf.kinds.push(d.kind || 'full');
  window.__floraPerf.total++;
});
// Readiness probe: add one throwaway node and wait until the extension's
// handler emits a perf event for it — proves observer + perf bridge are live.
window.__waitReady = async (timeoutMs) => {
  const start = Date.now();
  const probe = document.createElement('div');
  probe.textContent = 'probe node with no identifiers';
  document.body.appendChild(probe);
  while (window.__floraPerf.total === 0 && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 100));
  }
  return window.__floraPerf.total > 0;
};
window.__runBurst = async (n, interval) => {
  window.__floraPerf.passes = [];
  window.__floraPerf.kinds = [];
  const container = document.querySelector('.ae4') || document.body;
  for (let i = 0; i < n; i++) {
    const row = document.createElement('div');
    row.className = 'zA';
    row.innerHTML = '<div class="yW"><span class="yP">Late sender ' + i + '</span></div>' +
      '<div class="xY"><span class="y2">Newly streamed message ' + i +
      ', no identifiers here, just chatter about lunch and the 10:45 standup.</span></div>';
    container.appendChild(row);
    await new Promise(r => setTimeout(r, interval));
  }
  // Allow the final debounced (300ms) pass plus slow passes to finish.
  await new Promise(r => setTimeout(r, 1500));
  const p = window.__floraPerf.passes;
  const sum = p.reduce((a, b) => a + b, 0);
  return { count: p.length, sum, max: p.length ? Math.max(...p) : 0, each: p, kinds: window.__floraPerf.kinds };
};
`;

// ── BEFORE build: temp worktree of the base ref + the same timing hook ───────
function prepareBaseExtension(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "flora-bench-base-"));
  execFileSync("git", ["worktree", "add", "--detach", "--force", dir, BASE_REF], { cwd: REPO_ROOT });
  // Resolve the REAL node_modules (a git worktree's own may be empty — Node
  // resolves deps by walking up to the main checkout) and expose it in the
  // temp worktree, which sits in /tmp with nothing up-tree.
  const require = createRequire(import.meta.url);
  const nodeModules = path.resolve(path.dirname(require.resolve("esbuild/package.json")), "..");
  symlinkSync(nodeModules, path.join(dir, "node_modules"));

  // Patch the base content script with the identical instrumentation wrapper.
  const idx = path.join(dir, "src", "content-general", "index.ts");
  const src = readFileSync(idx, "utf-8");
  const anchor = "async function pageRenderChangeHandler(): Promise<void> {";
  if (!src.includes(anchor)) throw new Error("base index.ts anchor not found — update the bench patch");
  const patched = src.replace(
    anchor,
    [
      "async function pageRenderChangeHandler(): Promise<void> {",
      '    if (!(document.documentElement?.hasAttribute?.("data-flora-perf") ?? false)) return __origRenderPass();',
      "    const __t0 = performance.now();",
      "    try { await __origRenderPass(); } finally {",
      '        document.dispatchEvent(new CustomEvent("flora-perf-pass", { detail: { ms: performance.now() - __t0, kind: "full" } }));',
      "    }",
      "}",
      "async function __origRenderPass(): Promise<void> {",
    ].join("\n"),
  );
  writeFileSync(idx, patched);
  const tsxCli = require.resolve("tsx/cli");
  execFileSync(process.execPath, [tsxCli, "esbuild.config.ts"], { cwd: dir, stdio: "inherit" });
  return dir;
}

function removeBaseExtension(dir: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: REPO_ROOT });
  } catch {
    /* best effort */
  }
}

// ── Chrome bootstrap + hermetic seeding (mirrors tests/visual/run.ts) ────────
async function ensureChrome(): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error("Unsupported platform for Chrome for Testing");
  const cacheDir = path.join(os.homedir(), ".cache", "puppeteer");
  const buildId = await resolveBuildId(BrowserName.CHROME, platform, "stable");
  const execPath = computeExecutablePath({ browser: BrowserName.CHROME, buildId, cacheDir });
  if (!existsSync(execPath)) await install({ browser: BrowserName.CHROME, buildId, cacheDir });
  return execPath;
}

async function launchWithExtension(execPath: string, extDir: string): Promise<Browser> {
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: false,
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
    ],
  });
  const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker", {
    timeout: 20000,
  });
  await blockWorkerFetches(swTarget);
  const worker = await swTarget.worker();
  if (!worker) throw new Error("service worker unavailable");
  await worker.evaluate(
    async (local: Record<string, unknown>, sync: Record<string, unknown>) => {
      await chrome.storage.local.set(local);
      await chrome.storage.sync.set(sync);
    },
    buildLocalSeed(),
    buildSyncSeed(),
  );
  return browser;
}

async function blockWorkerFetches(target: Target): Promise<void> {
  const cdp = await target.createCDPSession();
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on("Fetch.requestPaused", (event) => {
    const { requestId, request } = event as { requestId: string; request: { url: string } };
    if (isBlockedWorkerHost(request.url)) {
      cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {});
    } else {
      cdp.send("Fetch.continueRequest", { requestId }).catch(() => {});
    }
  });
}

async function interceptPageRequests(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const verdict = classifyPageRequest(req.url());
    if (verdict === "allow") req.continue().catch(() => {});
    else if (verdict === "abort") req.abort().catch(() => {});
    else
      req
        .respond({ status: verdict.status, contentType: verdict.contentType, body: verdict.body })
        .catch(() => {});
  });
}

// ── Measure one page in one build ─────────────────────────────────────────────
interface BurstResult {
  count: number;
  sum: number;
  max: number;
  each: number[];
  kinds: string[];
}

async function measure(browser: Browser, url: string): Promise<{ burst: BurstResult; badges: number }> {
  const page: Page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await interceptPageRequests(page);
    await page.evaluateOnNewDocument(DRIVER);
    await page.bringToFront();
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.bringToFront();
    // Enable the perf hook AFTER parse (an attribute set pre-parse on the
    // provisional documentElement is discarded when the real <html> lands).
    // The hook is checked per-pass at runtime, so post-load is early enough.
    await page.evaluate(() => document.documentElement.setAttribute("data-flora-perf", ""));
    const ready = await page.evaluate(() => (window as any).__waitReady(15000));
    if (!ready) throw new Error(`extension never ran an observed pass on ${url}`);
    const burst = (await page.evaluate(
      (n, interval) => (window as any).__runBurst(n, interval),
      N_MUTATIONS,
      MUTATION_INTERVAL_MS,
    )) as BurstResult;
    const badges = await page.evaluate(
      () =>
        document.querySelectorAll(".flora-inline-badge, .flora-doi-label, .flora-notice-pill")
          .length,
    );
    return { burst, badges };
  } finally {
    await page.close().catch(() => {});
  }
}

function fmt(r: BurstResult): string {
  const avg = r.count ? r.sum / r.count : 0;
  const byKind = r.kinds.reduce<Record<string, number>>((acc, k) => {
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const kinds = Object.entries(byKind)
    .map(([k, n]) => `${n}x ${k}`)
    .join(", ");
  return (
    `passes=${r.count}  total=${r.sum.toFixed(1)}ms  avg=${avg.toFixed(2)}ms/pass  ` +
    `max=${r.max.toFixed(2)}ms  [${kinds}]`
  );
}

async function main(): Promise<void> {
  if (!existsSync(path.join(REPO_ROOT, "dist", "background.js"))) {
    throw new Error("dist/ missing — run `npm run build` first");
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), "flora-bench-fixtures-"));
  const gmailHtml = buildGmailLikeHtml();
  writeFileSync(path.join(tmp, "gmail-like.html"), gmailHtml);
  const server = await startServer([tmp, path.join(REPO_ROOT, "tests", "fixtures")]);
  const gmailUrl = `${server.origin}/gmail-like.html`;
  const articleUrl = `${server.origin}/article-with-dois.html`;

  console.log(`\nGmail-like fixture: ${(Buffer.byteLength(gmailHtml) / 1_000_000).toFixed(2)} MB HTML, ~3500 rows, 0 DOIs`);
  console.log(`Driver: ${N_MUTATIONS} mutations @ ${MUTATION_INTERVAL_MS}ms, 300ms handler debounce\n`);

  const execPath = await ensureChrome();

  console.log(`Building BEFORE extension from ${BASE_REF} …`);
  const baseDir = prepareBaseExtension();
  let beforeSum = 0;
  try {
    // BEFORE — base branch pipeline, every mutation runs the full scan.
    {
      const browser = await launchWithExtension(execPath, baseDir);
      try {
        const before = await measure(browser, gmailUrl);
        console.log(`BEFORE (${BASE_REF})`);
        console.log(`  gmail-like: ${fmt(before.burst)}`);
        beforeSum = before.burst.sum;
      } finally {
        await browser.close().catch(() => {});
      }
    }

    // AFTER — this branch's build.
    {
      const browser = await launchWithExtension(execPath, REPO_ROOT);
      try {
        const after = await measure(browser, gmailUrl);
        console.log(`AFTER  (perf-scan-gating)`);
        console.log(`  gmail-like: ${fmt(after.burst)}`);
        const saved = beforeSum - after.burst.sum;
        const factor = after.burst.sum > 0 ? beforeSum / after.burst.sum : Infinity;
        console.log(
          `\nMain-thread time in render passes over the burst: ` +
            `${beforeSum.toFixed(1)}ms → ${after.burst.sum.toFixed(1)}ms ` +
            `(${saved.toFixed(1)}ms saved, ${factor.toFixed(1)}x less)\n`,
        );

        // Relevant page still scans + badges correctly on the AFTER build.
        const article = await measure(browser, articleUrl);
        console.log(`AFTER, DOI-bearing article fixture:`);
        console.log(`  article-with-dois: ${fmt(article.burst)}  → FLoRA elements on page: ${article.badges}`);
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } finally {
    removeBaseExtension(baseDir);
    await server.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
