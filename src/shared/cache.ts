import type { CachedEntry } from "./types";
import { debugLog } from "./debug";

export const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Persistent cache using chrome.storage.local.
 * Supports per-entry TTL or permanent storage (ttlMs = null).
 * Enforces a soft storage quota: when usage approaches the limit it evicts
 * expired entries first, then live entries oldest-first (LRU by createdAt).
 */
export class LocalCache<T> {
  private quotaBytes: number;

  constructor(
    private readonly prefix: string,
    quotaBytes: number = 50 * 1024 * 1024
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
    const now = Date.now();
    const expiresAt = ttlMs === null ? null : now + ttlMs;
    const entry: CachedEntry<T> = { data, expiresAt, createdAt: now };
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

    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const mine = Object.keys(all).filter(k => k.startsWith(`${this.prefix}:`));

    // First reclaim any expired entries for this prefix.
    const expired = mine.filter(k => {
      const e = all[k] as CachedEntry<T> | undefined;
      return e?.expiresAt != null && now > e.expiresAt;
    });
    if (expired.length > 0) {
      debugLog(`Cache sweep: quota exceeded (${used} bytes) — evicting ${expired.length} expired entr(ies)`);
      await chrome.storage.local.remove(expired);
    }

    // Still over quota? Evict live entries oldest-first (LRU by createdAt) until
    // under the limit. Entries written before createdAt existed sort first (0),
    // so pre-existing entries without the field are evicted first.
    const remainingBytes = await chrome.storage.local.getBytesInUse(null);
    if (remainingBytes < this.quotaBytes) return;

    const expiredSet = new Set(expired);
    const live = mine
      .filter(k => !expiredSet.has(k))
      .map(k => ({ key: k, createdAt: (all[k] as CachedEntry<T> | undefined)?.createdAt ?? 0 }))
      .sort((a, b) => a.createdAt - b.createdAt);

    const toEvict: string[] = [];
    let freed = 0;
    const overBy = remainingBytes - this.quotaBytes;
    for (const { key } of live) {
      const bytes = await chrome.storage.local.getBytesInUse(key);
      toEvict.push(key);
      freed += bytes;
      // Evict at least enough to drop back under quota, with a little headroom
      // for the entry about to be written.
      if (freed > overBy) break;
    }
    if (toEvict.length > 0) {
      await chrome.storage.local.remove(toEvict);
    }
  }

  private storageKey(key: string): string {
    return `${this.prefix}:${key}`;
  }
}
