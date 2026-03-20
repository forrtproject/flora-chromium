/** Debug logger — all calls go straight to console */

export function debugLog(...args: unknown[]): void {
  console.log("[FLoRA]", ...args);
}

export function debugWarn(...args: unknown[]): void {
  console.warn("[FLoRA]", ...args);
}

export function debugError(...args: unknown[]): void {
  console.error("[FLoRA]", ...args);
}
