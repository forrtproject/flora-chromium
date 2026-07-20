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
    expect(provenance(true)).toBe("Matched by title — not stated on the page");
  });

  it("keeps the underline as a secondary cue", () => {
    const text = (p: HTMLElement) =>
      [...p.querySelectorAll<HTMLElement>("span")].find((s) => s.textContent === DOI)!;
    expect(text(createIndicatorPanel({ doi: DOI, isAugmented: true })).style.textDecoration)
      .toContain("underline");
    expect(text(createIndicatorPanel({ doi: DOI, isAugmented: false })).style.textDecoration)
      .not.toContain("underline");
  });

  it("lets status text wrap, including on rows swapped in later", () => {
    // The panel inherits its container's width (Scholar's link column is
    // ~160px). A rule keyed on the panel keeps applying after the OA, PubPeer
    // and badge rows replace themselves when their lookups land.
    document.body.appendChild(createIndicatorPanel({ doi: DOI }));
    const sheet = document.getElementById("flora-indicator-panel-style");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("[data-flora-panel] [data-flora-row-sub]");
    expect(sheet!.textContent).toContain("white-space:normal !important");
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

  it("picks up replication counts from updateIndicatorPillBadges", () => {
    const panel = createIndicatorPanel({ doi: DOI });
    document.body.appendChild(panel);
    expect(panel.querySelector("[data-flora-badge-row]")!.textContent)
      .toContain("No replication or reproduction data");

    updateIndicatorPillBadges(document, matchedState(3), []);

    expect(panel.querySelector("[data-flora-badge-row]")!.textContent)
      .toContain("3 replications");
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
