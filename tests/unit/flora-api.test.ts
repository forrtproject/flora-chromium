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

  it("returns empty map on 429 rate limit (per-batch error handling)", async () => {
    server.use(
      http.get(API_URL, () => new HttpResponse(null, { status: 429 }))
    );

    const results = await lookupDOIs([doi("10.1038/test")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map on 500 server error (per-batch error handling)", async () => {
    server.use(
      http.get(API_URL, () => new HttpResponse(null, { status: 500 }))
    );

    const results = await lookupDOIs([doi("10.1038/test")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map on network error (per-batch error handling)", async () => {
    server.use(http.get(API_URL, () => HttpResponse.error()));

    const results = await lookupDOIs([doi("10.1038/test")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map on Zod schema mismatch (per-batch error handling)", async () => {
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({
          results: {
            "10.1038/nature12373": { doi: "10.1038/nature12373" },
          },
        })
      )
    );

    const results = await lookupDOIs([doi("10.1038/nature12373")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map on completely unexpected response shape (per-batch error handling)", async () => {
    server.use(
      http.get(API_URL, () => HttpResponse.json({ data: "unexpected" }))
    );

    const results = await lookupDOIs([doi("10.1038/test")]);
    expect(results.size).toBe(0);
  });

  it("returns empty map when response has null fields where numbers expected (per-batch error handling)", async () => {
    const bad = mockResult();
    (bad.record.stats as Record<string, unknown>).n_replications_total = null;
    server.use(
      http.get(API_URL, () =>
        HttpResponse.json({ results: { "10.1038/nature12373": bad } })
      )
    );

    const results = await lookupDOIs([doi("10.1038/nature12373")]);
    expect(results.size).toBe(0);
  });
});
