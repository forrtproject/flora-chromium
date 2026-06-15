import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalCache } from "../../src/shared/cache";

describe("LocalCache", () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};

    chrome.storage.local.get = vi.fn(async (key: string | string[] | null) => {
      if (key === null) return { ...store };
      const k = Array.isArray(key) ? key[0] : key;
      return k in store ? { [k]: store[k] } : {};
    });

    chrome.storage.local.set = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    });

    chrome.storage.local.remove = vi.fn(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) delete store[k];
    });

    // getBytesInUse: report 0 so quota sweep never triggers in basic tests
    (chrome.storage.local as unknown as Record<string, unknown>).getBytesInUse =
      vi.fn().mockResolvedValue(0);
  });

  it("returns undefined on cache miss", async () => {
    const cache = new LocalCache<string>("test");
    expect(await cache.get("missing")).toBeUndefined();
  });

  it("returns cached data on hit", async () => {
    const cache = new LocalCache<string>("test");
    await cache.set("key1", "hello", null);
    expect(await cache.get("key1")).toBe("hello");
  });

  it("returns null for a cached no-match entry", async () => {
    const cache = new LocalCache<string>("test");
    await cache.set("key1", null, 60_000);
    expect(await cache.get("key1")).toBeNull();
  });

  it("returns undefined for expired entries", async () => {
    const cache = new LocalCache<string>("test");
    await cache.set("key1", "hello", 1000); // 1s TTL

    // Back-date the stored expiresAt so the entry looks expired
    const storageKey = "test:key1";
    store[storageKey] = { data: "hello", expiresAt: Date.now() - 2000 };

    expect(await cache.get("key1")).toBeUndefined();
  });

  it("permanent entries (ttlMs = null) never expire", async () => {
    const cache = new LocalCache<string>("test");
    await cache.set("key1", "permanent", null);

    const storageKey = "test:key1";
    const entry = store[storageKey] as { expiresAt: unknown };
    expect(entry.expiresAt).toBeNull();

    expect(await cache.get("key1")).toBe("permanent");
  });

  it("uses prefix to namespace keys", async () => {
    const cacheA = new LocalCache<string>("a");
    const cacheB = new LocalCache<string>("b");

    await cacheA.set("key", "from-a", null);
    await cacheB.set("key", "from-b", null);

    expect(await cacheA.get("key")).toBe("from-a");
    expect(await cacheB.get("key")).toBe("from-b");
  });

  it("overwrites the same key", async () => {
    const cache = new LocalCache<string>("test");
    await cache.set("key", "first", null);
    await cache.set("key", "second", null);
    expect(await cache.get("key")).toBe("second");
  });

  it("setQuota(0) disables quota enforcement", async () => {
    const cache = new LocalCache<string>("test");
    cache.setQuota(0);
    // getBytesInUse should not be called when quota is 0
    await cache.set("key", "value", null);
    expect(chrome.storage.local.getBytesInUse).not.toHaveBeenCalled();
  });
});
