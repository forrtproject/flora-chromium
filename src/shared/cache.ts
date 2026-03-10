import type { CachedEntry } from "./types";

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Session cache wrapper using chrome.storage.session.
 * Entries expire after the configured TTL.
 */
export class SessionCache<T> {
  constructor(
    private readonly prefix: string,
    private readonly ttlMs: number = DEFAULT_TTL_MS
  ) {}

  async get(key: string): Promise<T | null> {
    const storageKey = this.storageKey(key);
    const result = await chrome.storage.session.get(storageKey);
    const entry = result[storageKey] as CachedEntry<T> | undefined;

    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      await chrome.storage.session.remove(storageKey);
      return null;
    }

    return entry.data;
  }

  async set(key: string, data: T): Promise<void> {
    const entry: CachedEntry<T> = { data, timestamp: Date.now() };
    await chrome.storage.session.set({ [this.storageKey(key)]: entry });
  }

  private storageKey(key: string): string {
    return `${this.prefix}:${key}`;
  }
}
