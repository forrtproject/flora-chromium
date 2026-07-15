import type { CachedEntry } from "./types";

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

    if (!entry) return undefined;

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      await chrome.storage.local.remove(storageKey);
      return undefined;
    }

    return entry.data;
  }

  /**
   * Batched read of many keys in ONE chrome.storage.local.get, instead of one
   * round-trip per key. Only keys that are present and unexpired appear in the
   * returned map (value `null` = cached negative result, `T` = cached match);
   * missing/expired keys are simply absent. Expired entries are swept in a
   * single remove call.
   */
  async getMany(keys: string[]): Promise<Map<string, T | null>> {
    const out = new Map<string, T | null>();
    if (keys.length === 0) return out;

    const storageKeys = keys.map((k) => this.storageKey(k));
    const result = await chrome.storage.local.get(storageKeys);

    const now = Date.now();
    const expired: string[] = [];
    for (const key of keys) {
      const storageKey = this.storageKey(key);
      const entry = result[storageKey] as CachedEntry<T> | undefined;
      if (!entry) continue;
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        expired.push(storageKey);
        continue;
      }
      out.set(key, entry.data);
    }

    if (expired.length > 0) await chrome.storage.local.remove(expired);
    return out;
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
