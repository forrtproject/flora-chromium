import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { validateDOI, validateDOIs } from "../../src/shared/doi-validate";
import type { DoiString } from "../../src/shared/types";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const doi = (s: string) => s as DoiString;

// Slashes in the DOI are preserved as URL path separators, so
// 10.1038/nature12373 → /api/handles/10.1038/nature12373 (two segments)
// and 10.6338/JDA.202212/SP_17(4).0000 → /api/handles/10.6338/JDA.202212/SP_17(4).0000
// Use a wildcard to match all handle API requests regardless of segment count.
const HANDLE_PATTERN = "https://doi.org/api/handles/*";

function handleFromRequest(request: Request): string {
  const url = new URL(request.url);
  return decodeURIComponent(url.pathname.replace("/api/handles/", ""));
}

describe("validateDOI", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("returns true for a valid DOI (responseCode 1)", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 1, handle: "10.1038/nature12373" })
      )
    );

    const result = await validateDOI(doi("10.1038/nature12373"));
    expect(result).toBe(true);
  });

  it("returns false for an invalid DOI (responseCode 100)", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 100, handle: "10.1038/doesnotexist" })
      )
    );

    const result = await validateDOI(doi("10.1038/doesnotexist"));
    expect(result).toBe(false);
  });

  it("returns false on HTTP error", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        new HttpResponse(null, { status: 500 })
      )
    );

    const result = await validateDOI(doi("10.1038/nature12373"));
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.error()
      )
    );

    const result = await validateDOI(doi("10.1038/nature12373"));
    expect(result).toBe(false);
  });

  it("caches valid results", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 1 })
      )
    );

    await validateDOI(doi("10.1038/nature12373"));

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "flora_doival:10.1038/nature12373": expect.objectContaining({
          valid: true,
          timestamp: expect.any(Number),
        }),
      })
    );
  });

  it("caches invalid results", async () => {
    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 100 })
      )
    );

    await validateDOI(doi("10.1038/doesnotexist"));

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "flora_doival:10.1038/doesnotexist": expect.objectContaining({
          valid: false,
        }),
      })
    );
  });

  it("uses cached result on second call", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      "flora_doival:10.1038/cached": { valid: true, timestamp: Date.now() },
    });

    const result = await validateDOI(doi("10.1038/cached"));
    expect(result).toBe(true);
  });

  it("ignores expired cache entries", async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      "flora_doival:10.1038/expired": { valid: false, timestamp: eightDaysAgo },
    });

    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 1 })
      )
    );

    const result = await validateDOI(doi("10.1038/expired"));
    expect(result).toBe(true);
  });
});

describe("validateDOIs", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("returns empty map for empty input", async () => {
    const results = await validateDOIs([]);
    expect(results.size).toBe(0);
  });

  it("validates multiple DOIs in parallel", async () => {
    server.use(
      http.get(HANDLE_PATTERN, ({ request }) => {
        const handle = handleFromRequest(request);
        if (handle === "10.1038/valid1") {
          return HttpResponse.json({ responseCode: 1 });
        }
        return HttpResponse.json({ responseCode: 100 });
      })
    );

    const results = await validateDOIs([
      doi("10.1038/valid1"),
      doi("10.1038/invalid1"),
    ]);

    expect(results.get(doi("10.1038/valid1"))).toBe(true);
    expect(results.get(doi("10.1038/invalid1"))).toBe(false);
  });

  it("validates a DOI with a slash inside the suffix (spec example 2)", async () => {
    // 10.6338/JDA.202212/SP_17(4).0000 has two slashes — the API URL must
    // use a real path (not %2F) so doi.org routes it correctly.
    server.use(
      http.get(HANDLE_PATTERN, ({ request }) => {
        const handle = handleFromRequest(request);
        if (handle === "10.6338/jda.202212/sp_17(4).0000") {
          return HttpResponse.json({ responseCode: 1 });
        }
        return HttpResponse.json({ responseCode: 100 });
      })
    );

    const results = await validateDOIs([doi("10.6338/jda.202212/sp_17(4).0000")]);
    expect(results.get(doi("10.6338/jda.202212/sp_17(4).0000"))).toBe(true);
  });

  it("mixes cached and uncached DOIs", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      "flora_doival:10.1038/cached": { valid: true, timestamp: Date.now() },
    });

    server.use(
      http.get(HANDLE_PATTERN, () =>
        HttpResponse.json({ responseCode: 1 })
      )
    );

    const results = await validateDOIs([
      doi("10.1038/cached"),
      doi("10.1038/uncached"),
    ]);

    expect(results.get(doi("10.1038/cached"))).toBe(true);
    expect(results.get(doi("10.1038/uncached"))).toBe(true);
  });
});
