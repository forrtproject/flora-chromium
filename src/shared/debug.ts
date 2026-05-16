/** Debug logger — gated by a flag in chrome.storage.local */

let _enabled = true;
let _initialized = true;

function init(): void {
  if (_initialized) return;
  _initialized = true;

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
 * Enable or disable debug logging at runtime.
 * Call from the browser console:
 *   chrome.storage.local.set({ flora_debug: true })
 *   chrome.storage.local.set({ flora_debug: false })
 */
export function setDebug(enabled: boolean): void {
  _enabled = enabled;
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
  console.log("[FLoRA]", ...args);
}

export function debugWarn(...args: unknown[]): void {
  if (!_enabled) return;
  console.warn("[FLoRA]", ...args);
}

export function debugError(...args: unknown[]): void {
  if (!_enabled) return;
  console.error("[FLoRA]", ...args);
}
