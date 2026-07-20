import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { renderResolvedReferences, type ResolvedReference } from "../../src/content-general/references";
import { INDICATOR_PILL_CLASS } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

/**
 * End-to-end placement: drives the real renderResolvedReferences path against
 * markup trimmed from live publisher pages, with the hostname stubbed, and
 * checks where the pill actually lands in the DOM.
 */
function loadIntoDocument(fixture: string): void {
  const html = readFileSync(join(__dirname, "..", "fixtures", fixture), "utf-8");
  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<body[^>]*>/i, "")
    .replace(/<\/body>[\s\S]*$/i, "");
}

function setHostname(hostname: string): void {
  Object.defineProperty(window, "location", {
    value: { hostname, href: `https://${hostname}/doi/10.1234/x` },
    writable: true,
    configurable: true,
  });
}

function entriesFromDocument(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('div[role="listitem"]'));
}

describe("reference pill placement (integration)", () => {
  const realLocation = window.location;

  beforeEach(() => {
    // Keep the pill's async lookups from touching the network.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", {
      value: realLocation,
      writable: true,
      configurable: true,
    });
    document.documentElement.innerHTML = "";
  });

  for (const [hostname, fixture] of [
    ["www.science.org", "science-org-article.html"],
    ["journals.sagepub.com", "sagepub-article.html"],
  ] as const) {
    it(`puts the pill in .citation-content on ${hostname}`, () => {
      setHostname(hostname);
      loadIntoDocument(fixture);

      const entry = entriesFromDocument()[0];
      const resolved: ResolvedReference[] = [
        { entry: { element: entry, doi: "10.1/a" as DoiString, doiInText: false, text: "ref" }, doi: "10.1/a" as DoiString, mode: "hidden" },
      ];

      renderResolvedReferences(resolved, new Map(), new Map());

      const placed = entry.querySelector(`.${INDICATOR_PILL_CLASS}`);
      expect(placed).not.toBeNull();
      expect(entry.querySelector(".citation-content")!.contains(placed!)).toBe(true);
      expect(entry.querySelector(".external-links")!.contains(placed!)).toBe(false);
    });
  }

  it("falls back to generic placement on an unregistered site", () => {
    setHostname("example.com");
    loadIntoDocument("science-org-article.html");

    const entry = entriesFromDocument()[0];
    const resolved: ResolvedReference[] = [
      { entry: { element: entry, doi: "10.1/a" as DoiString, doiInText: false, text: "ref" }, doi: "10.1/a" as DoiString, mode: "hidden" },
    ];

    renderResolvedReferences(resolved, new Map(), new Map());

    const placed = entry.querySelector(`.${INDICATOR_PILL_CLASS}`);
    expect(placed).not.toBeNull();
    // This is the misplacement the adapter exists to correct: with no adapter,
    // the generic "after the entry's last link" rule drops the pill into the
    // Crossref | Web of Science | Google Scholar row. Asserting it here proves
    // the .citation-content placement above comes from the adapter and not
    // from the generic heuristics happening to agree.
    expect(entry.querySelector(".external-links")!.contains(placed!)).toBe(true);
  });

  it("still places the pill when the adapter's selector no longer matches", () => {
    // Simulates the publisher renaming .citation-content out from under us:
    // the pill must degrade to generic placement, never vanish.
    setHostname("www.science.org");
    loadIntoDocument("science-org-article.html");

    const entry = entriesFromDocument()[0];
    for (const el of entry.querySelectorAll(".citation-content, .citation")) {
      el.className = "renamed-by-publisher";
    }

    const resolved: ResolvedReference[] = [
      { entry: { element: entry, doi: "10.1/a" as DoiString, doiInText: false, text: "ref" }, doi: "10.1/a" as DoiString, mode: "hidden" },
    ];

    renderResolvedReferences(resolved, new Map(), new Map());

    expect(entry.querySelector(`.${INDICATOR_PILL_CLASS}`)).not.toBeNull();
  });
});
