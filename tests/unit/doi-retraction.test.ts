import { describe, it, expect, beforeEach, vi } from "vitest";

import { retractionCheck } from "../../src/shared/doi-retraction";
import { RET_MAP_KEY } from "../../src/shared/data-extract";
import type { DoiString } from "../../src/shared/types";

const doi = (s: string) => s.toLowerCase() as DoiString;

// A retraction known to exist in the bundled src/retractions.json. Used to
// exercise the static-fallback path without coupling the test to any one
// specific DOI's notice value.
const BUNDLED_RETRACTED_DOI = "10.1007/s00500-023-09262-x";
const BUNDLED_RETRACTION_NOTICE = "10.1007/s00500-025-11130-9";

describe("retractionCheck", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockReset();
  });

  it("returns the notice DOI for a retracted paper found in the synced map", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        retractions: { "10.1234/paper": "10.1234/notice" },
        concerns: {},
      },
    });

    const result = await retractionCheck([doi("10.1234/paper")]);
    expect(result).toEqual([
      { originDoi: "10.1234/paper", doi: "10.1234/notice" },
    ]);
  });

  it("falls back to the bundled static JSON when storage is empty", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const result = await retractionCheck([doi(BUNDLED_RETRACTED_DOI)]);
    expect(result).toEqual([
      { originDoi: BUNDLED_RETRACTED_DOI, doi: BUNDLED_RETRACTION_NOTICE },
    ]);
  });

  it("falls back to bundled data when the cached retractions map is empty", async () => {
    // Cached payload is present but the retractions map is empty (e.g. a
    // partial sync). The bundled JSON must still answer the lookup.
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: { retractions: {}, concerns: {} },
    });
    const result = await retractionCheck([doi(BUNDLED_RETRACTED_DOI)]);
    expect(result).toHaveLength(1);
    expect(result[0].originDoi).toBe(BUNDLED_RETRACTED_DOI);
  });

  it("does not surface expressions of concern", async () => {
    // Concerns are tracked in the data but deliberately not badged yet.
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        retractions: { "10.1234/paper": "10.1234/notice" },
        concerns: { "10.5678/eoc-paper": "10.5678/eoc-notice" },
      },
    });

    const result = await retractionCheck([doi("10.5678/eoc-paper")]);
    expect(result).toEqual([]);
  });

  it("returns nothing for a DOI that is not in the map", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        retractions: { "10.1234/keep": "10.1234/retraction" },
        concerns: {},
      },
    });

    const result = await retractionCheck([doi("10.9999/not-there")]);
    expect(result).toEqual([]);
  });

  it("processes a batch, returning entries only for retracted DOIs", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        retractions: {
          "10.1234/a": "10.1234/a-notice",
          "10.1234/c": "10.1234/c-notice",
        },
        concerns: {},
      },
    });

    const result = await retractionCheck([
      doi("10.1234/a"),
      doi("10.1234/b"),
      doi("10.1234/c"),
    ]);
    expect(result).toEqual([
      { originDoi: "10.1234/a", doi: "10.1234/a-notice" },
      { originDoi: "10.1234/c", doi: "10.1234/c-notice" },
    ]);
  });
});
