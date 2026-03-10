import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { lookupDOIs } from "../../src/shared/flora-api";
import { doi, mockResult } from "../helpers";

const API_URL = "https://rep-api.forrt.org/v1/original-lookup";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("lookupDOIs", () => {
  it("returns matched results on 200", async () => {
    const result = mockResult();
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({
          results: { "10.1038/nature12373": result },
        })
      )
    );

    const results = await lookupDOIs([doi("10.1038/nature12373")]);
    expect(results.size).toBe(1);
    expect(
      results.get(doi("10.1038/nature12373"))?.record.stats.n_replications_total
    ).toBe(3);
  });

  it("returns empty map on 200 with empty results", async () => {
    server.use(
      http.get(API_URL, () => HttpResponse.json({ results: {} }))
    );

    const results = await lookupDOIs([doi("10.9999/nonexistent")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map when called with empty array", async () => {
    const results = await lookupDOIs([]);
    expect(results.size).toBe(0);
  });

  it("throws on 429 rate limit", async () => {
    server.use(
      http.get(API_URL, () => new HttpResponse(null, { status: 429 }))
    );

    await expect(lookupDOIs([doi("10.1038/test")])).rejects.toThrow(
      "FLoRA API error: 429"
    );
  });

  it("throws on 500 server error", async () => {
    server.use(
      http.get(API_URL, () => new HttpResponse(null, { status: 500 }))
    );

    await expect(lookupDOIs([doi("10.1038/test")])).rejects.toThrow(
      "FLoRA API error: 500"
    );
  });

  it("throws on network error", async () => {
    server.use(http.get(API_URL, () => HttpResponse.error()));

    await expect(lookupDOIs([doi("10.1038/test")])).rejects.toThrow();
  });

  it("throws on Zod schema mismatch (missing required field)", async () => {
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({
          results: {
            "10.1038/nature12373": { doi: "10.1038/nature12373" },
          },
        })
      )
    );

    await expect(lookupDOIs([doi("10.1038/nature12373")])).rejects.toThrow();
  });

  it("throws on completely unexpected response shape", async () => {
    server.use(
      http.get(API_URL, () => HttpResponse.json({ data: "unexpected" }))
    );

    await expect(lookupDOIs([doi("10.1038/test")])).rejects.toThrow();
  });

  it("throws when response has null fields where numbers expected", async () => {
    const bad = mockResult();
    (bad.record.stats as Record<string, unknown>).n_replications_total = null;
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({ results: { "10.1038/nature12373": bad } })
      )
    );

    await expect(lookupDOIs([doi("10.1038/nature12373")])).rejects.toThrow();
  });
});
