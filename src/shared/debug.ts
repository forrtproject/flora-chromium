/**
 * Debug logger — force-enabled at compile time in debug builds
 * (`npm run build:debug` / `npm run watch` inject `__FLORA_DEBUG__ = true`),
 * otherwise gated by a flag in chrome.storage.local.
 */

// Compile-time constant injected via esbuild `define`. Undefined in contexts
// that don't go through esbuild (vitest), hence the typeof guard.
declare const __FLORA_DEBUG__: boolean;
const FORCE_DEBUG = typeof __FLORA_DEBUG__ !== "undefined" && __FLORA_DEBUG__;

let _enabled = FORCE_DEBUG;
let _initialized = false;
let _context = "";

function init(): void {
  if (_initialized) return;
  _initialized = true;

  // Debug builds are always-on; the storage flag only matters in production.
  if (FORCE_DEBUG) return;

  try {
    chrome.storage.local.get("flora_debug", (result) => {
      _enabled = result?.flora_debug === true;
    });

    // React to live changes (e.g. toggling from the console)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.flora_debug) {
        _enabled = changes.flora_debug.newValue === true;
      }
    });
  } catch {
    // chrome.storage not available (e.g. in tests) — stay disabled
  }
}

init();

/**
 * Label this bundle's log lines with the context they run in
 * (e.g. "worker", "general", "scholar", "popup"). Call once at entry.
 */
export function setDebugContext(context: string): void {
  _context = context;
}

function prefix(): string {
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  return _context ? `[FLoRA:${_context} ${ts}]` : `[FLoRA ${ts}]`;
}

/**
 * Enable or disable debug logging at runtime (no-op off in debug builds,
 * which are always-on). Call from the browser console:
 *   chrome.storage.local.set({ flora_debug: true })
 *   chrome.storage.local.set({ flora_debug: false })
 */
export function setDebug(enabled: boolean): void {
  _enabled = FORCE_DEBUG || enabled;
  try {
    chrome.storage.local.set({ flora_debug: enabled });
  } catch {
    // storage unavailable
  }
}

export function isDebugEnabled(): boolean {
  return _enabled;
}

export function debugLog(...args: unknown[]): void {
  if (!_enabled) return;
  console.log(prefix(), ...args);
}

export function debugWarn(...args: unknown[]): void {
  if (!_enabled) return;
  console.warn(prefix(), ...args);
}

export function debugError(...args: unknown[]): void {
  if (!_enabled) return;
  console.error(prefix(), ...args);
}

// ── Debug-build instrumentation ─────────────────────────────────────────────
// Trace every fetch this bundle makes (content scripts run in an isolated
// world, so only extension-initiated requests are captured — never the
// page's own) and surface unhandled promise rejections that would otherwise
// vanish silently. Compiled out of production builds entirely.
if (FORCE_DEBUG) {
  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (originalFetch) {
    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      const started = Date.now();
      debugLog(`fetch → ${method} ${url}`);
      try {
        const resp = await originalFetch(input, init);
        debugLog(
          `fetch ← ${resp.status} ${method} ${url} (${Date.now() - started}ms)`
        );
        return resp;
      } catch (err) {
        debugError(`fetch ✗ ${method} ${url} (${Date.now() - started}ms)`, err);
        throw err;
      }
    };
  }

  try {
    self.addEventListener("unhandledrejection", (event) => {
      debugError(
        "Unhandled promise rejection:",
        (event as PromiseRejectionEvent).reason
      );
    });

    // Fallback for uncaught synchronous errors nothing else reports. In
    // content scripts the page's own errors surface on the same window, so
    // only log errors originating from extension code (or with no source).
    self.addEventListener("error", (event) => {
      const e = event as ErrorEvent;
      if (e.filename && !e.filename.includes("-extension://")) return;
      debugError(
        "Uncaught error:",
        e.message,
        e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : "",
        e.error ?? ""
      );
    });
  } catch {
    // no global event target — ignore
  }
}
