// Visual-regression harness for FLoRA.
//
// Loads the REAL built extension into Chrome for Testing, renders each fixture
// page over http://127.0.0.1, screenshots the full page, and pixel-diffs
// against a committed baseline. Two modes:
//
//   npm run test:visual          compare against baselines, exit 1 on any diff
//   npm run test:visual:update   regenerate baselines (never fails on diff)
//
// See tests/visual/README.md for the full picture. The extension is loaded
// from the REPO ROOT (manifest.json there references dist/*), so run
// `npm run build` first.

import {
  Browser as BrowserName,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
  resolveBuildId,
} from "@puppeteer/browsers";
import puppeteer, { type Browser, type CDPSession, type Page, type Target } from "puppeteer-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";
import {
  buildLocalSeed,
  buildSyncSeed,
  classifyPageRequest,
  isBlockedWorkerHost,
  RETRACTION_MAP,
  RET_MAP_KEY,
} from "./mocks.js";

// `chrome` is referenced only inside page/worker `evaluate` callbacks, which
// execute in the browser (not here). Declared so this Node-side script type-checks.
declare const chrome: any;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const VISUAL_DIR = __dirname;
const NEW_FIXTURES_DIR = path.join(VISUAL_DIR, "fixtures");
const REUSED_FIXTURES_DIR = path.join(REPO_ROOT, "tests", "fixtures");
const BASELINE_DIR = path.join(VISUAL_DIR, "baselines");
const OUTPUT_DIR = path.join(VISUAL_DIR, "output");

// ── Determinism knobs ───────────────────────────────────────────────────────
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1 };
// pixelmatch per-pixel colour threshold, and the fraction of pixels allowed to
// differ before a fixture counts as a regression.
const PIXEL_THRESHOLD = 0.1;
const MAX_DIFF_FRACTION = 0.001; // 0.1% of pixels

// CSS injected before any page script runs: kill animations/transitions/
// carets/smooth-scroll and remove the transient "scanning" toast, so a
// screenshot captures a stable end state.
const DETERMINISM_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
  html { -webkit-font-smoothing: antialiased; }
  #flora-working-toast { display: none !important; }
`;

// ── Fixture catalogue ───────────────────────────────────────────────────────
interface Fixture {
  /** Baseline file name (without extension) and console label. */
  name: string;
  /** Path served by the static server, relative to a fixtures root. */
  urlPath: string;
}

const FIXTURES: Fixture[] = [
  // New visual fixtures (served from tests/visual/fixtures).
  { name: "ref-list-flex", urlPath: "ref-list-flex.html" },
  { name: "ref-list-grid", urlPath: "ref-list-grid.html" },
  { name: "table-bibliography", urlPath: "table-bibliography.html" },
  { name: "rtl-article", urlPath: "rtl-article.html" },
  { name: "editor-textarea", urlPath: "editor-textarea.html" },
  { name: "long-article-sticky", urlPath: "long-article-sticky.html" },
  { name: "shared-block-anchor", urlPath: "shared-block-anchor.html" },
  // Reused unit-test fixtures (served from tests/fixtures).
  { name: "article-with-dois", urlPath: "article-with-dois.html" },
  { name: "doi-in-href", urlPath: "doi-in-href.html" },
  { name: "doi-in-table", urlPath: "doi-in-table.html" },
  { name: "doi-in-text", urlPath: "doi-in-text.html" },
  { name: "redacted", urlPath: "redacted.html" },
];

// FLoRA-injected elements we wait to settle before capturing.
const FLORA_SELECTOR =
  ".flora-inline-badge, .flora-doi-label, .flora-notice-pill, #flora-pubpeer-panel";

const UPDATE = process.argv.includes("--update");

// ── Chrome for Testing bootstrap ────────────────────────────────────────────
async function ensureChrome(): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error("Unsupported platform for Chrome for Testing");
  const cacheDir = path.join(os.homedir(), ".cache", "puppeteer");
  const buildId = await resolveBuildId(BrowserName.CHROME, platform, "stable");

  const execPath = computeExecutablePath({ browser: BrowserName.CHROME, buildId, cacheDir });
  if (!existsSync(execPath)) {
    console.log(`Installing Chrome for Testing (${buildId}) into ${cacheDir} …`);
    await install({ browser: BrowserName.CHROME, buildId, cacheDir });
  }
  return execPath;
}

// ── Worker: seed storage + block external fetches ───────────────────────────
async function attachWorkerFetchBlock(target: Target): Promise<CDPSession> {
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
  return cdp;
}

async function seedStorage(target: Target): Promise<void> {
  const worker = await target.worker();
  if (!worker) throw new Error("service worker not available for seeding");
  await worker.evaluate(
    async (local: Record<string, unknown>, sync: Record<string, unknown>) => {
      await chrome.storage.local.set(local);
      await chrome.storage.sync.set(sync);
    },
    buildLocalSeed(),
    buildSyncSeed(),
  );
}

/**
 * Re-seed the retraction map + settings right before a fixture renders. Cheap
 * insurance against a stray install-time sync having overwritten the map: this
 * write is the last one before the page's retraction check runs.
 */
async function reseedBeforeFixture(target: Target): Promise<void> {
  const worker = await target.worker();
  if (!worker) return;
  await worker.evaluate(
    async (retKey: string, retMap: unknown, sync: Record<string, unknown>) => {
      await chrome.storage.local.set({ [retKey]: retMap, synctime: Date.now() });
      await chrome.storage.sync.set(sync);
    },
    RET_MAP_KEY,
    RETRACTION_MAP,
    buildSyncSeed(),
  );
}

// ── Per-page request interception (page context) ────────────────────────────
async function installPageInterception(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const verdict = classifyPageRequest(req.url());
    if (verdict === "allow") {
      req.continue().catch(() => {});
    } else if (verdict === "abort") {
      req.abort().catch(() => {});
    } else {
      req
        .respond({ status: verdict.status, contentType: verdict.contentType, body: verdict.body })
        .catch(() => {});
    }
  });
}

// ── Settle: wait for FLoRA UI to stop changing ──────────────────────────────
async function waitForSettle(page: Page): Promise<void> {
  const maxMs = 12000;
  const minMs = 800;
  const stableMs = 700;
  const pollMs = 200;
  const start = Date.now();
  let lastCount = -1;
  let stableSince = Date.now();

  for (;;) {
    const count = await page.evaluate((sel) => document.querySelectorAll(sel).length, FLORA_SELECTOR);
    const elapsed = Date.now() - start;
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    }
    const stable = Date.now() - stableSince >= stableMs;
    if (elapsed >= minMs && stable) break;
    if (elapsed >= maxMs) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  // Final short settle so any last paint/layout lands before capture.
  await new Promise((r) => setTimeout(r, 300));
}

// ── Capture one fixture ─────────────────────────────────────────────────────
interface FixtureResult {
  name: string;
  status: "pass" | "fail" | "written";
  detail?: string;
}

async function captureFixture(
  browser: Browser,
  swTarget: Target,
  origin: string,
  fixture: Fixture,
): Promise<FixtureResult> {
  const page = await browser.newPage();
  try {
    await page.setViewport(VIEWPORT);
    await installPageInterception(page);

    // The content script defers all work until the tab is visible — make it the
    // foreground tab (the extension opens a walkthrough tab on install).
    await page.bringToFront();
    await reseedBeforeFixture(swTarget);

    if (process.env.VR_DEBUG) {
      page.on("requestfailed", (r) => console.log(`   reqfail ${r.url()} ${r.failure()?.errorText}`));
      page.on("pageerror", (e) => console.log(`   pageerror ${(e as Error).message}`));
    }
    const resp = await page.goto(`${origin}/${fixture.urlPath}`, { waitUntil: "load", timeout: 30000 });
    if (process.env.VR_DEBUG) console.log(`   goto ${fixture.urlPath}: status=${resp?.status()} ok=${resp?.ok()}`);
    await page.bringToFront();
    // Determinism CSS injected as a plain string (no function serialization):
    // kills animations/transitions/carets and hides the transient scanning toast.
    await page.addStyleTag({ content: DETERMINISM_CSS });
    // All fonts fully loaded before capture — a late font swap re-rasterises
    // every glyph on the page.
    await page.evaluate(() => (document as Document).fonts.ready.then(() => undefined));
    await waitForSettle(page);

    if (process.env.VR_DEBUG) {
      const dbg = await page.evaluate(() => ({
        title: document.title,
        textLen: document.body ? document.body.innerText.length : 0,
        scrollH: document.body ? document.body.scrollHeight : 0,
        flora: document.querySelectorAll(
          ".flora-inline-badge, .flora-doi-label, .flora-notice-pill, #flora-pubpeer-panel",
        ).length,
        vis: document.visibilityState,
      }));
      console.log(`   dbg ${fixture.name}: ${JSON.stringify(dbg)}`);
    }

    const shot = await page.screenshot({ fullPage: true, type: "png" });
    const actual = PNG.sync.read(Buffer.from(shot));
    const baselinePath = path.join(BASELINE_DIR, `${fixture.name}.png`);

    if (UPDATE) {
      mkdirSync(BASELINE_DIR, { recursive: true });
      writeFileSync(baselinePath, PNG.sync.write(actual));
      return { name: fixture.name, status: "written", detail: `${actual.width}x${actual.height}` };
    }

    if (!existsSync(baselinePath)) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(path.join(OUTPUT_DIR, `${fixture.name}.actual.png`), PNG.sync.write(actual));
      return { name: fixture.name, status: "fail", detail: "no baseline (run test:visual:update)" };
    }

    const baseline = PNG.sync.read(readFileSync(baselinePath));
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(path.join(OUTPUT_DIR, `${fixture.name}.actual.png`), PNG.sync.write(actual));
      return {
        name: fixture.name,
        status: "fail",
        detail: `size ${actual.width}x${actual.height} != baseline ${baseline.width}x${baseline.height}`,
      };
    }

    const { width, height } = baseline;
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(baseline.data, actual.data, diff.data, width, height, {
      threshold: PIXEL_THRESHOLD,
    });
    const total = width * height;
    const fraction = diffPixels / total;

    if (fraction > MAX_DIFF_FRACTION) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(path.join(OUTPUT_DIR, `${fixture.name}.actual.png`), PNG.sync.write(actual));
      writeFileSync(path.join(OUTPUT_DIR, `${fixture.name}.diff.png`), PNG.sync.write(diff));
      return {
        name: fixture.name,
        status: "fail",
        detail: `${diffPixels} px differ (${(fraction * 100).toFixed(3)}% > ${(MAX_DIFF_FRACTION * 100).toFixed(1)}%)`,
      };
    }

    return {
      name: fixture.name,
      status: "pass",
      detail: `${diffPixels} px differ (${(fraction * 100).toFixed(3)}%)`,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (!existsSync(path.join(REPO_ROOT, "dist", "background.js"))) {
    throw new Error("dist/ missing — run `npm run build` before the visual tests");
  }

  // Fresh output dir each compare run.
  if (!UPDATE && existsSync(OUTPUT_DIR)) rmSync(OUTPUT_DIR, { recursive: true, force: true });

  const execPath = await ensureChrome();
  const server = await startServer([NEW_FIXTURES_DIR, REUSED_FIXTURES_DIR]);
  console.log(`Static server on ${server.origin}`);

  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: false, // MV3 extensions need a headful / new-headless context.
    args: [
      `--disable-extensions-except=${REPO_ROOT}`,
      `--load-extension=${REPO_ROOT}`,
      "--force-color-profile=srgb",
      "--hide-scrollbars",
      "--disable-lcd-text",
      "--font-render-hinting=none",
      // One deterministic raster path. Without --disable-gpu, macOS headful
      // Chrome flaps between GPU and software rasterisation across page loads,
      // shifting anti-aliasing on every glyph (whole-page pixel drift).
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--force-device-scale-factor=1",
      "--disable-font-subpixel-positioning",
      "--disable-partial-raster",
      "--disable-skia-runtime-opts",
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const results: FixtureResult[] = [];
  try {
    const swTarget = await browser.waitForTarget((t) => t.type() === "service_worker", {
      timeout: 20000,
    });
    // Block worker-context external fetches FIRST, then seed storage.
    await attachWorkerFetchBlock(swTarget);
    await seedStorage(swTarget);
    console.log("Service worker ready — storage seeded, external fetches blocked.");

    for (const fixture of FIXTURES) {
      const result = await captureFixture(browser, swTarget, server.origin, fixture);
      results.push(result);
      const icon = result.status === "pass" ? "✓" : result.status === "written" ? "◆" : "✗";
      console.log(`  ${icon} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
    }
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }

  const failures = results.filter((r) => r.status === "fail");
  console.log("");
  if (UPDATE) {
    console.log(`Baselines written: ${results.length}. Baselines are macOS-rendered — commit them.`);
    return;
  }
  if (failures.length > 0) {
    console.log(`FAILED: ${failures.length}/${results.length} fixture(s) differ. See ${OUTPUT_DIR}/`);
    for (const f of failures) console.log(`  ✗ ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log(`PASSED: all ${results.length} fixtures match baselines.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
