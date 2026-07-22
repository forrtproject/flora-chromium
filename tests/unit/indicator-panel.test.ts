import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createIndicatorPanel,
  updateIndicatorPillBadges,
  INDICATOR_PILL_CLASS,
} from "../../src/shared/indicator-pill";
import { isExternalMutation } from "../../src/shared/flora-ui";
import type { DoiString, LookupState } from "../../src/shared/types";

const DOI = "10.1234/x" as DoiString;

function matchedState(replications: number): Map<DoiString, LookupState> {
  return new Map([[DOI, {
    status: "matched",
    source: "extracted",
    result: { record: { stats: { n_replications_total: replications, n_reproductions_total: 0 } } },
  } as unknown as LookupState]]);
}

describe("createIndicatorPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders the rows inline rather than behind a hover", () => {
    const panel = createIndicatorPanel({ doi: DOI });
    // Every row the pill hides in its popover is visible on the panel.
    expect(panel.querySelector("[data-flora-oa-row]")).not.toBeNull();
    expect(panel.querySelector("[data-flora-pubpeer-row]")).not.toBeNull();
    expect(panel.querySelector("[data-flora-badge-row]")).not.toBeNull();
    expect(panel.textContent).toContain(DOI);
    // ...and none of the pill's compact inline segments are present.
    expect(panel.querySelector("[data-flora-badge-segment]")).toBeNull();
    expect(panel.querySelector("[data-flora-doi-segment]")).toBeNull();
    expect(panel.style.display).not.toBe("none");
  });

  it("is identifiable as FLoRA's own UI", () => {
    // Otherwise the DOI it prints gets rescanned and the DOM listener loops.
    const panel = createIndicatorPanel({ doi: DOI });
    expect(panel.className).toBe(INDICATOR_PILL_CLASS);
    expect(panel.hasAttribute("data-flora-ui")).toBe(true);
    expect(panel.getAttribute("data-flora-doi")).toBe(DOI);
    expect(isExternalMutation({
      type: "childList",
      target: document.body,
      addedNodes: [panel] as unknown as NodeList,
    } as MutationRecord)).toBe(false);
  });

  it("states provenance in words for both cases", () => {
    // A dotted underline alone is a marked/unmarked distinction: a reader who
    // only ever sees confirmed DOIs has nothing to compare against.
    const provenance = (isAugmented: boolean) =>
      createIndicatorPanel({ doi: DOI, isAugmented })
        .querySelector("[data-flora-doi-provenance]")!.textContent;

    expect(provenance(false)).toBe("Found on this page");
    expect(provenance(true)).toBe("Matched by title");
  });

  it("keeps the underline as a secondary cue", () => {
    const text = (p: HTMLElement) =>
      [...p.querySelectorAll<HTMLElement>("span")].find((s) => s.textContent === DOI)!;
    expect(text(createIndicatorPanel({ doi: DOI, isAugmented: true })).style.textDecoration)
      .toContain("underline");
    expect(text(createIndicatorPanel({ doi: DOI, isAugmented: false })).style.textDecoration)
      .not.toContain("underline");
  });

  it("lets the provenance sentence wrap, including on rows swapped in later", () => {
    // The panel inherits its container's width (Scholar's link column is
    // ~160px). A rule keyed on the panel keeps applying after the OA, PubPeer
    // and badge rows replace themselves when their lookups land.
    document.body.appendChild(createIndicatorPanel({ doi: DOI }));
    const sheet = document.getElementById("flora-indicator-panel-style");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("[data-flora-panel] [data-flora-doi-provenance]");
    expect(sheet!.textContent).toContain("white-space:normal !important");
  });

  it("keeps every row to a single line", () => {
    // Each Scholar result carries one of these; a row that wraps is scroll the
    // reader pays for on every result down the page.
    const panel = createIndicatorPanel({ doi: DOI });
    for (const attr of ["data-flora-oa-row", "data-flora-pubpeer-row", "data-flora-badge-row"]) {
      const label = panel.querySelector<HTMLElement>(`[${attr}] [data-flora-row-sub]`)!.parentElement!;
      expect(label.style.flexDirection).not.toBe("column");
    }
  });

  it("only ever installs one panel stylesheet", () => {
    for (let i = 0; i < 3; i++) document.body.appendChild(createIndicatorPanel({ doi: DOI }));
    expect(document.querySelectorAll("#flora-indicator-panel-style")).toHaveLength(1);
  });

  it("still shows the DOI itself, not just its provenance", () => {
    // The row is what you copy from — the value must stay on the title line.
    const panel = createIndicatorPanel({ doi: DOI, isAugmented: true });
    expect([...panel.querySelectorAll("span")].some((s) => s.textContent === DOI)).toBe(true);
  });

  it("lets the reader pick between free copies, collapsed by default", async () => {
    const panel = createIndicatorPanel({
      doi: DOI,
      oaStatus: Promise.resolve({
        isOa: true,
        url: "https://publisher.example/a.pdf",
        locations: [
          { url: "https://publisher.example/a.pdf", label: "Publisher", version: "published", isPdf: true },
          { url: "https://repo.example/a", label: "Repo Uni", version: "accepted", isPdf: false },
        ],
      }),
    });
    await vi.waitFor(() =>
      expect(panel.querySelector("[data-flora-oa-choices]")).not.toBeNull()
    );

    const list = panel.querySelector<HTMLElement>("[data-flora-oa-row] > div:last-child")!;
    expect(list.style.display).toBe("none");
    expect(list.querySelectorAll("a")).toHaveLength(2);

    panel.querySelector<HTMLElement>("[data-flora-oa-choices]")!.click();
    expect(list.style.display).toBe("flex");
  });

  it("links straight through when there is only one free copy", async () => {
    const panel = createIndicatorPanel({
      doi: DOI,
      oaStatus: Promise.resolve({
        isOa: true,
        url: "https://publisher.example/a.pdf",
        locations: [
          { url: "https://publisher.example/a.pdf", label: "Publisher", version: null, isPdf: true },
        ],
      }),
    });
    await vi.waitFor(() =>
      expect(panel.querySelector<HTMLAnchorElement>("a[data-flora-oa-row]")?.href)
        .toBe("https://publisher.example/a.pdf")
    );
  });

  it("picks up replication counts from updateIndicatorPillBadges", () => {
    const panel = createIndicatorPanel({ doi: DOI });
    document.body.appendChild(panel);
    // Compact rows carry the count beside the heading rather than a sentence.
    // With nothing found the heading names both things that were looked for.
    expect(panel.querySelector("[data-flora-badge-row]")!.textContent)
      .toContain("Replication / Reproduction data");
    expect(panel.querySelector("[data-flora-badge-row] [data-flora-row-sub]")!.textContent)
      .toBe("None");

    updateIndicatorPillBadges(document, matchedState(3), []);

    const badgeRow = panel.querySelector<HTMLElement>("[data-flora-badge-row]")!;
    expect(badgeRow.textContent).toContain("Replications");
    expect(badgeRow.querySelector("[data-flora-row-sub]")!.textContent).toBe("3");
  });

  it("keeps a retraction when a later pass carries replication data", () => {
    // Scholar resolves retractions and replications on separate async paths;
    // the second pass must not erase what the first one rendered.
    const panel = createIndicatorPanel({ doi: DOI });
    document.body.appendChild(panel);
    const notice = { originDoi: DOI, doi: "10.9/n" as DoiString, kind: "retraction" } as never;

    updateIndicatorPillBadges(document, new Map(), [notice]);
    expect(panel.querySelector("[data-flora-badge-row]")!.textContent?.toLowerCase())
      .toContain("retract");

    updateIndicatorPillBadges(document, matchedState(3), [notice]);
    expect(panel.querySelector("[data-flora-badge-row]")!.textContent?.toLowerCase())
      .toContain("retract");
  });
});
