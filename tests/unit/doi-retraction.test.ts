import { describe, it, expect, beforeEach, vi } from "vitest";

import { retractionCheck } from "../../src/shared/doi-retraction";
import { RET_MAP_KEY } from "../../src/shared/data-extract";
import type { DoiString } from "../../src/shared/types";

const doi = (s: string) => s.toLowerCase() as DoiString;

describe("retractionCheck", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockReset();
  });

  it("matches a DOI whose canonical key is mixed-case in the synced map", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: {
        // SICI-style Elsevier DOI with uppercase 'S' — matches how
        // Retraction Watch / Crossref publish the key. Extracted DOIs come
        // through normaliseDOI as lowercase, so the lookup must be
        // case-insensitive.
        "10.1016/S0140-6736(20)32656-8": "10.1016/S0140-6736(22)02370-4",
      },
    });

    const result = await retractionCheck([doi("10.1016/S0140-6736(20)32656-8")]);
    expect(result).toEqual([
      {
        originDoi: "10.1016/s0140-6736(20)32656-8",
        doi: "10.1016/S0140-6736(22)02370-4",
      },
    ]);
  });

  it("falls back to the bundled static JSON when storage is empty", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    // 10.1016/S0140-6736(20)32656-8 is present in the bundled retractions.json
    // with a mixed-case key — same lookup path, but exercises the static fallback.
    const result = await retractionCheck([doi("10.1016/S0140-6736(20)32656-8")]);
    expect(result).toHaveLength(1);
    expect(result[0].originDoi).toBe("10.1016/s0140-6736(20)32656-8");
  });

  it("returns nothing for a DOI that is not in the map", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [RET_MAP_KEY]: { "10.1234/keep": "10.1234/retraction" },
    });

    const result = await retractionCheck([doi("10.9999/not-there")]);
    expect(result).toEqual([]);
  });
});
