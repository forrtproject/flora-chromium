import type { CachedEntry } from "./types";
import { debugLog } from "./debug";

export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Persistent cache using chrome.storage.local.
 * Supports per-entry TTL or permanent storage (ttlMs = null).
 * Enforces a soft storage quota by evicting expired entries when approached.
 */
export class LocalCache<T> {
  private quotaBytes: number;

  constructor(
    private readonly prefix: string,
    quotaBytes: number = 500 * 1024 * 1024
  ) {
    this.quotaBytes = quotaBytes;
  }

  /** Update the quota at runtime (e.g. after the user changes the setting). */
  setQuota(bytes: number): void {
    this.quotaBytes = bytes;
  }

  /**
   * Returns:
   *  - `undefined`  — not in cache (or expired)
   *  - `null`       — cached no-match (negative result)
   *  - `T`          — cached match
   */
  async get(key: string): Promise<T | null | undefined> {
    const storageKey = this.storageKey(key);
    const result = await chrome.storage.local.get(storageKey);
    const entry = result[storageKey] as CachedEntry<T> | undefined;

    if (!entry) {
      debugLog(`Cache miss: ${storageKey}`);
      return undefined;
    }

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      debugLog(`Cache expired: ${storageKey}`);
      await chrome.storage.local.remove(storageKey);
      return undefined;
    }

    debugLog(`Cache hit: ${storageKey}`, entry.data === null ? "(negative)" : "");
    return entry.data;
  }

  /**
   * @param data    The value to cache; pass `null` to record a negative result.
   * @param ttlMs   Milliseconds until expiry, or `null` to cache forever.
   */
  async set(key: string, data: T | null, ttlMs: number | null): Promise<void> {
    await this.sweepIfOverQuota();
    const expiresAt = ttlMs === null ? null : Date.now() + ttlMs;
    const entry: CachedEntry<T> = { data, expiresAt };
    debugLog(
      `Cache set: ${this.storageKey(key)}`,
      data === null ? "(negative)" : "",
      expiresAt === null ? "(no expiry)" : `(expires ${new Date(expiresAt).toISOString()})`
    );
    await chrome.storage.local.set({ [this.storageKey(key)]: entry });
  }

  private async sweepIfOverQuota(): Promise<void> {
    if (this.quotaBytes === 0) return; // 0 = unlimited
    const used = await chrome.storage.local.getBytesInUse(null);
    if (used < this.quotaBytes) return;

    // Evict all expired entries for this cache prefix to reclaim space
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const expired = Object.keys(all)
      .filter(k => k.startsWith(`${this.prefix}:`))
      .filter(k => {
        const e = all[k] as CachedEntry<T> | undefined;
        return e?.expiresAt != null && now > e.expiresAt;
      });

    if (expired.length > 0) {
      debugLog(`Cache sweep: quota exceeded (${used} bytes) — evicting ${expired.length} expired entr(ies)`);
      await chrome.storage.local.remove(expired);
    }
  }

  private storageKey(key: string): string {
    return `${this.prefix}:${key}`;
  }
}
