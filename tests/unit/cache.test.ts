import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalCache } from "../../src/shared/cache";

describe("LocalCache", () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};

    chrome.storage.local.get = vi.fn(async (key: string | string[] | null) => {
      if (key === null) return { ...store };
      const keys = Array.isArray(key) ? key : [key];
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in store) out[k] = store[k];
      return out;
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

  it("records createdAt on set", async () => {
    const cache = new LocalCache<string>("test");
    const before = Date.now();
    await cache.set("key", "value", null);
    const entry = store["test:key"] as { createdAt: number };
    expect(entry.createdAt).toBeGreaterThanOrEqual(before);
  });

  it("evicts expired entries first when over quota", async () => {
    const cache = new LocalCache<string>("test");
    cache.setQuota(1000);

    // Pre-load one expired and one live entry directly into the store.
    store["test:old"] = { data: "old", expiresAt: Date.now() - 1000, createdAt: 1 };
    store["test:live"] = { data: "live", expiresAt: Date.now() + 100000, createdAt: 2 };

    // Report over-quota on the first check, then under-quota afterwards so the
    // LRU pass is not needed once the expired entry is reclaimed.
    let call = 0;
    (chrome.storage.local.getBytesInUse as ReturnType<typeof vi.fn>).mockImplementation(
      async () => (call++ === 0 ? 5000 : 0)
    );

    await cache.set("new", "new", null);

    expect(store["test:old"]).toBeUndefined(); // expired -> evicted
    expect(store["test:live"]).toBeDefined();  // live -> kept
    expect(store["test:new"]).toBeDefined();
  });

  it("evicts live entries oldest-first (LRU) when still over quota", async () => {
    const cache = new LocalCache<string>("test");
    cache.setQuota(1000);

    // Three live entries with increasing createdAt (oldest = a).
    store["test:a"] = { data: "a", expiresAt: null, createdAt: 1 };
    store["test:b"] = { data: "b", expiresAt: null, createdAt: 2 };
    store["test:c"] = { data: "c", expiresAt: null, createdAt: 3 };

    // Stay over quota through both getBytesInUse(null) checks so the LRU pass
    // runs; per-key size reported large enough that one eviction suffices.
    (chrome.storage.local.getBytesInUse as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string | null) => (key === null ? 5000 : 4001)
    );

    await cache.set("d", "d", null);

    // Oldest live entry (a) evicted; newer ones survive.
    expect(store["test:a"]).toBeUndefined();
    expect(store["test:b"]).toBeDefined();
    expect(store["test:c"]).toBeDefined();
    expect(store["test:d"]).toBeDefined();
  });

  it("evicts entries without createdAt before newer ones", async () => {
    const cache = new LocalCache<string>("test");
    cache.setQuota(1000);

    // Legacy entry lacks createdAt (treated as 0 = oldest); newer has createdAt.
    store["test:legacy"] = { data: "legacy", expiresAt: null };
    store["test:fresh"] = { data: "fresh", expiresAt: null, createdAt: 100 };

    (chrome.storage.local.getBytesInUse as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string | null) => (key === null ? 5000 : 4001)
    );

    await cache.set("new", "new", null);

    expect(store["test:legacy"]).toBeUndefined();
    expect(store["test:fresh"]).toBeDefined();
  });

  describe("getMany", () => {
    it("reads every key in a single chrome.storage.local.get", async () => {
      const cache = new LocalCache<string>("test");
      await cache.set("a", "A", null);
      await cache.set("b", "B", null);
      await cache.set("c", "C", null);

      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockClear();
      const out = await cache.getMany(["a", "b", "c", "missing"]);

      expect(chrome.storage.local.get).toHaveBeenCalledOnce();
      expect(chrome.storage.local.get).toHaveBeenCalledWith([
        "test:a",
        "test:b",
        "test:c",
        "test:missing",
      ]);
      expect(out.get("a")).toBe("A");
      expect(out.get("b")).toBe("B");
      expect(out.get("c")).toBe("C");
      // Absent keys are simply not present in the returned map.
      expect(out.has("missing")).toBe(false);
    });

    it("returns an empty map without touching storage for no keys", async () => {
      const cache = new LocalCache<string>("test");
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockClear();
      const out = await cache.getMany([]);
      expect(out.size).toBe(0);
      expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    it("omits and sweeps expired entries", async () => {
      const cache = new LocalCache<string>("test");
      await cache.set("fresh", "still-good", null);
      // Back-date an entry so it looks expired.
      store["test:stale"] = { data: "old", expiresAt: Date.now() - 1000 };

      const out = await cache.getMany(["fresh", "stale"]);
      expect(out.get("fresh")).toBe("still-good");
      expect(out.has("stale")).toBe(false);
      // The expired entry is removed from storage.
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(["test:stale"]);
      expect(store["test:stale"]).toBeUndefined();
    });

    it("preserves a cached negative result (null) distinctly from a miss", async () => {
      const cache = new LocalCache<string>("test");
      await cache.set("neg", null, 60_000);
      const out = await cache.getMany(["neg", "gone"]);
      expect(out.has("neg")).toBe(true);
      expect(out.get("neg")).toBeNull();
      expect(out.has("gone")).toBe(false);
    });
  });

  it("setQuota(0) disables quota enforcement", async () => {
    const cache = new LocalCache<string>("test");
    cache.setQuota(0);
    // getBytesInUse should not be called when quota is 0
    await cache.set("key", "value", null);
    expect(chrome.storage.local.getBytesInUse).not.toHaveBeenCalled();
  });
});
