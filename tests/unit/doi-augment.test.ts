import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Mock settings so getUserEmail() returns a valid email
vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ email: "test@example.com" }),
  isSetupComplete: vi.fn().mockResolvedValue(true),
}));

import { normalizeTitle, similarity, tokenSetRatio, augmentDOIs, _resetAugmentCachesForTesting } from "../../src/shared/doi-augment";
import { getSettings } from "../../src/shared/settings";

const OPENALEX_URL = "https://api.openalex.org/works";
const CROSSREF_URL = "https://api.crossref.org/works";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("normalizeTitle", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTitle("Hello, World!")).toBe("hello world");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeTitle("  foo   bar  ")).toBe("foo bar");
  });

  it("handles empty string", () => {
    expect(normalizeTitle("")).toBe("");
  });

  it("preserves numbers and words", () => {
    expect(normalizeTitle("Study 1: Results (2024)")).toBe(
      "study 1 results 2024"
    );
  });
});

describe("similarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(similarity("hello", "hello")).toBe(1.0);
  });

  it("returns high score for similar strings", () => {
    const score = similarity(
      "the effect of sleep on memory",
      "the effects of sleep on memory"
    );
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns low score for different strings", () => {
    const score = similarity("quantum physics", "baking chocolate cake");
    expect(score).toBeLessThan(0.5);
  });

  it("returns 1.0 for two empty strings", () => {
    expect(similarity("", "")).toBe(1.0);
  });

  it("handles one empty string", () => {
    expect(similarity("hello", "")).toBe(0);
  });
});

describe("tokenSetRatio", () => {
  it("returns 100 for identical strings", () => {
    expect(tokenSetRatio("hello world", "hello world")).toBe(100);
  });

  it("returns 100 for reordered words", () => {
    expect(tokenSetRatio("sleep memory effect", "effect sleep memory")).toBe(100);
  });

  it("returns high score for similar titles with minor differences", () => {
    const score = tokenSetRatio(
      "The Effect of Sleep on Memory Consolidation",
      "The Effects of Sleep on Memory Consolidation"
    );
    expect(score).toBeGreaterThan(88);
  });

  it("returns low score for completely different strings", () => {
    const score = tokenSetRatio(
      "quantum physics experiments",
      "baking chocolate cake recipes"
    );
    expect(score).toBeLessThan(50);
  });

  it("handles superset gracefully", () => {
    const score = tokenSetRatio(
      "sleep and memory",
      "sleep and memory consolidation in adults"
    );
    // The intersection "sleep and memory" matches perfectly against itself
    expect(score).toBeGreaterThan(70);
  });

  it("handles empty strings", () => {
    expect(tokenSetRatio("", "")).toBe(100);
  });
});

describe("augmentDOIs", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      {}
    );
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined
    );
    _resetAugmentCachesForTesting();
  });

  it("returns resolved DOI when both APIs find a match", async () => {
    server.use(
      http.get(CROSSREF_URL, () =>
        HttpResponse.json({
          message: {
            items: [
              {
                DOI: "10.1038/nature12373",
                title: ["The Effect of Sleep on Memory Consolidation"],
              },
            ],
          },
        })
      ),
      http.get(OPENALEX_URL, () =>
        HttpResponse.json({
          results: [
            {
              doi: "https://doi.org/10.1038/nature12373",
              title: "The Effect of Sleep on Memory Consolidation",
            },
          ],
        })
      )
    );

    const results = await augmentDOIs([
      "The Effect of Sleep on Memory Consolidation",
    ]);

    expect(results.get("The Effect of Sleep on Memory Consolidation")).toBe(
      "10.1038/nature12373"
    );
  });

  it("returns DOI when only Crossref finds a match", async () => {
    server.use(
      http.get(CROSSREF_URL, () =>
        HttpResponse.json({
          message: {
            items: [
              {
                DOI: "10.1038/nature12373",
                title: ["The Effect of Sleep on Memory Consolidation"],
              },
            ],
          },
        })
      ),
      http.get(OPENALEX_URL, () => HttpResponse.json({ results: [] }))
    );

    const results = await augmentDOIs([
      "The Effect of Sleep on Memory Consolidation",
    ]);

    expect(results.get("The Effect of Sleep on Memory Consolidation")).toBe(
      "10.1038/nature12373"
    );
  });

  it("returns DOI when only OpenAlex finds a match", async () => {
    server.use(
      http.get(CROSSREF_URL, () => HttpResponse.json({ message: { items: [] } })),
      http.get(OPENALEX_URL, () =>
        HttpResponse.json({
          results: [
            {
              doi: "https://doi.org/10.1038/nature12373",
              title: "The Effect of Sleep on Memory Consolidation",
            },
          ],
        })
      )
    );

    const results = await augmentDOIs([
      "The Effect of Sleep on Memory Consolidation",
    ]);

    expect(results.get("The Effect of Sleep on Memory Consolidation")).toBe(
      "10.1038/nature12373"
    );
  });

  it("picks highest-scoring DOI when APIs return different results", async () => {
    server.use(
      http.get(CROSSREF_URL, () =>
        HttpResponse.json({
          message: {
            items: [
              {
                DOI: "10.1038/wrong-match",
                title: ["Unrelated Paper on Quantum Computing and Machine Learning"],
              },
            ],
          },
        })
      ),
      http.get(OPENALEX_URL, () =>
        HttpResponse.json({
          results: [
            {
              doi: "https://doi.org/10.1038/nature12373",
              title: "The Effect of Sleep on Memory Consolidation",
            },
          ],
        })
      )
    );

    const results = await augmentDOIs([
      "The Effect of Sleep on Memory Consolidation",
    ]);

    // Crossref returns an unrelated title (below threshold), OpenAlex matches exactly
    expect(results.get("The Effect of Sleep on Memory Consolidation")).toBe(
      "10.1038/nature12373"
    );
  });

  it("returns null when no match found from either API", async () => {
    server.use(
      http.get(CROSSREF_URL, () => HttpResponse.json({ message: { items: [] } })),
      http.get(OPENALEX_URL, () => HttpResponse.json({ results: [] }))
    );

    const results = await augmentDOIs(["Some Obscure Title Nobody Wrote"]);
    expect(results.get("Some Obscure Title Nobody Wrote")).toBeNull();
  });

  it("returns DOI when one API errors but the other succeeds", async () => {
    server.use(
      http.get(CROSSREF_URL, () => new HttpResponse(null, { status: 500 })),
      http.get(OPENALEX_URL, () =>
        HttpResponse.json({
          results: [
            {
              doi: "https://doi.org/10.1038/nature12373",
              title: "The Effect of Sleep on Memory Consolidation",
            },
          ],
        })
      )
    );

    const results = await augmentDOIs([
      "The Effect of Sleep on Memory Consolidation",
    ]);

    expect(results.get("The Effect of Sleep on Memory Consolidation")).toBe(
      "10.1038/nature12373"
    );
  });

  it("returns null when both APIs error", async () => {
    server.use(
      http.get(CROSSREF_URL, () => new HttpResponse(null, { status: 500 })),
      http.get(OPENALEX_URL, () => new HttpResponse(null, { status: 500 }))
    );

    const results = await augmentDOIs(["Test Title"]);
    expect(results.get("Test Title")).toBeNull();
  });

  it("returns empty map for empty input", async () => {
    const results = await augmentDOIs([]);
    expect(results.size).toBe(0);
  });

  it("uses cached results on second call", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_doi_blob: {
        "test title": { v: { found: true, doi: "10.1234/cached" }, t: Date.now() },
      },
    });

    const results = await augmentDOIs(["Test Title"]);
    expect(results.get("Test Title")).toBe("10.1234/cached");
  });

  it("rejects low-similarity matches from both APIs", async () => {
    server.use(
      http.get(CROSSREF_URL, () =>
        HttpResponse.json({
          message: {
            items: [
              {
                DOI: "10.1038/wrong",
                title: ["A Completely Different Paper About Quantum Physics"],
              },
            ],
          },
        })
      ),
      http.get(OPENALEX_URL, () =>
        HttpResponse.json({
          results: [
            {
              doi: "https://doi.org/10.1038/also-wrong",
              title: "Another Unrelated Paper on Molecular Biology",
            },
          ],
        })
      )
    );

    const results = await augmentDOIs(["The Effect of Sleep on Memory"]);
    expect(results.get("The Effect of Sleep on Memory")).toBeNull();
  });

  it("handles multiple titles independently", async () => {
    server.use(
      http.get(CROSSREF_URL, ({ request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query.title") ?? "";
        if (query.toLowerCase().includes("first")) {
          return HttpResponse.json({
            message: {
              items: [{ DOI: "10.1038/paper1", title: ["First Paper Title"] }],
            },
          });
        }
        if (query.toLowerCase().includes("second")) {
          return HttpResponse.json({
            message: {
              items: [{ DOI: "10.1126/paper2", title: ["Second Paper Title"] }],
            },
          });
        }
        return HttpResponse.json({ message: { items: [] } });
      }),
      http.get(OPENALEX_URL, () => HttpResponse.json({ results: [] }))
    );

    const results = await augmentDOIs([
      "First Paper Title",
      "Second Paper Title",
      "Third Unknown Title",
    ]);

    expect(results.get("First Paper Title")).toBe("10.1038/paper1");
    expect(results.get("Second Paper Title")).toBe("10.1126/paper2");
    expect(results.get("Third Unknown Title")).toBeNull();
  });

  it("does not query or cache a no-match when no email is configured", async () => {
    // Regression: previously the no-email path still wrote {found:false} to the
    // cache (30-day TTL), so a title visited before the user set their email
    // stayed unresolved for 30 days even after they added it.
    vi.mocked(getSettings).mockResolvedValueOnce({ email: "" } as any);

    let crossrefHits = 0;
    server.use(
      http.get(CROSSREF_URL, () => {
        crossrefHits++;
        return HttpResponse.json({ message: { items: [] } });
      }),
      http.get(OPENALEX_URL, () => HttpResponse.json({ results: [] }))
    );
    const setSpy = chrome.storage.local.set as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    const results = await augmentDOIs(["A Paper Without Email"]);

    expect(results.get("A Paper Without Email")).toBeNull();
    expect(crossrefHits).toBe(0); // never queried — no email
    expect(setSpy).not.toHaveBeenCalled(); // and crucially never poisoned the cache
  });

  it("deduplicates titles that share a normalized key", async () => {
    let crossrefHits = 0;
    server.use(
      http.get(CROSSREF_URL, () => {
        crossrefHits++;
        return HttpResponse.json({
          message: { items: [{ DOI: "10.1038/dedup", title: ["Shared Title"] }] },
        });
      }),
      http.get(OPENALEX_URL, () => HttpResponse.json({ results: [] }))
    );
    const setSpy = chrome.storage.local.set as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    // Both titles normalise to "shared title" (trailing "!" is stripped).
    const results = await augmentDOIs(["Shared Title", "Shared Title!"]);

    expect(results.get("Shared Title")).toBe("10.1038/dedup");
    expect(results.get("Shared Title!")).toBe("10.1038/dedup");
    expect(crossrefHits).toBe(1); // queried once, not once per equivalent title
    expect(setSpy).toHaveBeenCalledTimes(1); // single batched flush
  });

  it("flushes cache writes for multiple resolved titles in one batch", async () => {
    server.use(
      http.get(CROSSREF_URL, ({ request }) => {
        const q = (new URL(request.url).searchParams.get("query.title") ?? "").toLowerCase();
        if (q.includes("alpha"))
          return HttpResponse.json({ message: { items: [{ DOI: "10.1038/alpha", title: ["Alpha Study"] }] } });
        if (q.includes("beta"))
          return HttpResponse.json({ message: { items: [{ DOI: "10.1126/beta", title: ["Beta Study"] }] } });
        return HttpResponse.json({ message: { items: [] } });
      }),
      http.get(OPENALEX_URL, () => HttpResponse.json({ results: [] }))
    );
    const setSpy = chrome.storage.local.set as ReturnType<typeof vi.fn>;
    setSpy.mockClear();

    const results = await augmentDOIs(["Alpha Study", "Beta Study"]);

    expect(results.get("Alpha Study")).toBe("10.1038/alpha");
    expect(results.get("Beta Study")).toBe("10.1126/beta");
    // One setMany flush for both, not one chrome.storage.local.set per title.
    expect(setSpy).toHaveBeenCalledTimes(1);
  });
});
