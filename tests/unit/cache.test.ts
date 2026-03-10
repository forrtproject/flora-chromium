import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionCache } from "../../src/shared/cache";

describe("SessionCache", () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};

    chrome.storage.session.get = vi.fn(async (key: string) => {
      return key in store ? { [key]: store[key] } : {};
    });

    chrome.storage.session.set = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    });

    (chrome.storage.session as unknown as Record<string, unknown>).remove = vi.fn(
      async (key: string) => {
        delete store[key];
      }
    );
  });

  it("returns null on cache miss", async () => {
    const cache = new SessionCache<string>("test");
    expect(await cache.get("missing")).toBeNull();
  });

  it("returns cached data on hit", async () => {
    const cache = new SessionCache<string>("test");
    await cache.set("key1", "hello");
    expect(await cache.get("key1")).toBe("hello");
  });

  it("returns null for expired entries", async () => {
    const cache = new SessionCache<string>("test", 1000); // 1s TTL

    await cache.set("key1", "hello");

    // Simulate time passing by manipulating the stored timestamp
    const storageKey = "test:key1";
    store[storageKey] = {
      data: "hello",
      timestamp: Date.now() - 2000, // 2s ago, past 1s TTL
    };

    expect(await cache.get("key1")).toBeNull();
  });

  it("uses prefix to namespace keys", async () => {
    const cacheA = new SessionCache<string>("a");
    const cacheB = new SessionCache<string>("b");

    await cacheA.set("key", "from-a");
    await cacheB.set("key", "from-b");

    expect(await cacheA.get("key")).toBe("from-a");
    expect(await cacheB.get("key")).toBe("from-b");
  });

  it("deduplicates by overwriting same key", async () => {
    const cache = new SessionCache<string>("test");

    await cache.set("key", "first");
    await cache.set("key", "second");

    expect(await cache.get("key")).toBe("second");
  });
});
