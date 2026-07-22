import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  lookupPubPeerForDoi,
  _resetPubPeerCacheForTesting,
} from "../../src/shared/pubpeer-api";

/**
 * One merged indicator pill is rendered per reference, and each one looks up
 * its own DOI. Without coalescing that is a separate POST per reference — all
 * issued before any of them has written to the cache, so none of them hits it.
 */
describe("lookupPubPeerForDoi batching", () => {
  let store: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

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
    (chrome.storage.local as unknown as Record<string, unknown>).getBytesInUse =
      vi.fn().mockResolvedValue(0);

    _resetPubPeerCacheForTesting();

    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        status: "success",
        feedbacks: [
          {
            id: "10.1234/a",
            title: "A",
            total_comments: 3,
            total_peeriodical_comments: 0,
            last_commented_at: "",
            users: "",
            url: "https://pubpeer.com/publications/a",
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetPubPeerCacheForTesting();
  });

  it("coalesces concurrent single-DOI lookups into one request", async () => {
    const [a, b, c] = await Promise.all([
      lookupPubPeerForDoi("10.1234/a"),
      lookupPubPeerForDoi("10.1234/b"),
      lookupPubPeerForDoi("10.1234/c"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.dois).toEqual(
      expect.arrayContaining(["10.1234/a", "10.1234/b", "10.1234/c"])
    );

    // Each caller still gets only its own DOI's result.
    expect(a?.total_comments).toBe(3);
    expect(b).toBeNull();
    expect(c).toBeNull();
  });

  it("resolves every waiter for a DOI requested more than once", async () => {
    const [first, second] = await Promise.all([
      lookupPubPeerForDoi("10.1234/a"),
      lookupPubPeerForDoi("10.1234/a"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first?.total_comments).toBe(3);
    expect(second?.total_comments).toBe(3);
  });

  it("resolves to null rather than rejecting when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(lookupPubPeerForDoi("10.1234/a")).resolves.toBeNull();
  });
});
