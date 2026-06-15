import { describe, it, expect, beforeEach, vi } from "vitest";

import { retractionCheck, resetRetractionCache } from "../../src/shared/doi-retraction";
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
    resetRetractionCache();
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
      { originDoi: "10.1234/paper", doi: "10.1234/notice", kind: "retraction" },
    ]);
  });

  it("returns expressions of concern tagged as 'concern'", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        retractions: {},
        concerns: { "10.5678/eoc-paper": "10.5678/eoc-notice" },
      },
    });

    const result = await retractionCheck([doi("10.5678/eoc-paper")]);
    expect(result).toEqual([
      { originDoi: "10.5678/eoc-paper", doi: "10.5678/eoc-notice", kind: "concern" },
    ]);
  });

  it("prefers retraction over concern when a DOI is present in both maps", async () => {
    // Defensive: the updater's "latest event wins" rule means this shouldn't
    // happen in production data, but the lookup loop is a one-line invariant
    // worth pinning down.
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        retractions: { "10.1234/dual": "10.1234/dual-retraction" },
        concerns:    { "10.1234/dual": "10.1234/dual-concern" },
      },
    });

    const result = await retractionCheck([doi("10.1234/dual")]);
    expect(result).toEqual([
      { originDoi: "10.1234/dual", doi: "10.1234/dual-retraction", kind: "retraction" },
    ]);
  });

  it("falls back to the bundled static JSON when storage is empty", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const result = await retractionCheck([doi(BUNDLED_RETRACTED_DOI)]);
    expect(result).toEqual([
      { originDoi: BUNDLED_RETRACTED_DOI, doi: BUNDLED_RETRACTION_NOTICE, kind: "retraction" },
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
    expect(result[0].kind).toBe("retraction");
  });

  it("returns nothing for a DOI that is in neither map", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        retractions: { "10.1234/keep": "10.1234/retraction" },
        concerns: {},
      },
    });

    const result = await retractionCheck([doi("10.9999/not-there")]);
    expect(result).toEqual([]);
  });

  it("matches mixed-case source keys against lowercased DOI input", async () => {
    // Retraction Watch publishes DOIs in their original publisher case
    // (SICI/NEJM/ASCE identifiers carry uppercase letters), but normaliseDOI
    // lowercases every DOI before lookup. retractionCheck must close the gap.
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        retractions: { "10.1016/S0140-6736(20)32656-8": "10.1016/S0140-6736(22)02370-4" },
        concerns: { "10.1056/NEJMicm2518379": "10.1056/NEJMicm9999999" },
      },
    });

    const retracted = await retractionCheck([doi("10.1016/S0140-6736(20)32656-8")]);
    expect(retracted).toEqual([
      {
        originDoi: "10.1016/s0140-6736(20)32656-8",
        doi: "10.1016/S0140-6736(22)02370-4",
        kind: "retraction",
      },
    ]);

    const concerned = await retractionCheck([doi("10.1056/NEJMicm2518379")]);
    expect(concerned).toEqual([
      {
        originDoi: "10.1056/nejmicm2518379",
        doi: "10.1056/NEJMicm9999999",
        kind: "concern",
      },
    ]);
  });

  it("processes a mixed batch, tagging each entry by its source map", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        retractions: {
          "10.1234/a": "10.1234/a-notice",
          "10.1234/c": "10.1234/c-notice",
        },
        concerns: {
          "10.1234/d": "10.1234/d-notice",
        },
      },
    });

    const result = await retractionCheck([
      doi("10.1234/a"),
      doi("10.1234/b"),
      doi("10.1234/c"),
      doi("10.1234/d"),
    ]);
    expect(result).toEqual([
      { originDoi: "10.1234/a", doi: "10.1234/a-notice", kind: "retraction" },
      { originDoi: "10.1234/c", doi: "10.1234/c-notice", kind: "retraction" },
      { originDoi: "10.1234/d", doi: "10.1234/d-notice", kind: "concern" },
    ]);
  });
});
