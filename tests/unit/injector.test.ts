import { describe, it, expect, beforeEach } from "vitest";
import type { DoiString, LookupState } from "../../src/shared/types";
import { renderMatchedBanner, removeBanner, renderInlineBadges } from "../../src/content-general/injector";
import { doi, mockResult } from "../helpers";

const MOCK_RESULT = mockResult();
const BANNER_ID = "flora-banner-host";

describe("injector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.style.removeProperty("padding-top");
  });

  describe("renderMatchedBanner", () => {
    it("removes banner when matched array is empty", () => {
      renderMatchedBanner([]);
      expect(document.getElementById(BANNER_ID)).toBeNull();
    });

    it("removes banner when result has no replications or reproductions", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 0, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);
      expect(document.getElementById(BANNER_ID)).toBeNull();
    });

    it("renders banner when replications exist", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 2, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      expect(document.getElementById(BANNER_ID)).not.toBeNull();
    });

    it("renders banner when reproductions exist", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 0, n_reproductions_total: 1 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      expect(document.getElementById(BANNER_ID)).not.toBeNull();
    });

    it("shows replication count in banner text", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 3, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      const banner = document.getElementById(BANNER_ID);
      expect(banner?.textContent).toContain("3 replications");
    });

    it("uses singular label for one replication", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      const banner = document.getElementById(BANNER_ID);
      expect(banner?.textContent).toContain("1 replication");
      expect(banner?.textContent).not.toContain("replications");
    });

    it("shows View details link pointing to FORRT Atlas with encoded DOI", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      const banner = document.getElementById(BANNER_ID);
      const link = banner?.querySelector<HTMLAnchorElement>('a[href*="forrt.org"]');
      expect(link).not.toBeNull();
      expect(link?.href).toContain("10.1038%2Fnature12373");
    });

    it("shows multi-DOI summary text when multiple DOIs match", () => {
      const result1 = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 2, n_reproductions_total: 0 },
        },
      });
      const result2 = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([
        { doi: "10.1038/nature12373", result: result1 },
        { doi: "10.1000/other.doi", result: result2 },
      ]);

      const banner = document.getElementById(BANNER_ID);
      expect(banner?.textContent).toContain("2 DOIs");
    });

    it("replaces existing banner instead of stacking", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);
      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);

      expect(document.querySelectorAll(`#${BANNER_ID}`)).toHaveLength(1);
    });
  });

  describe("removeBanner", () => {
    it("removes the banner element", () => {
      const result = mockResult({
        record: {
          ...MOCK_RESULT.record,
          stats: { ...MOCK_RESULT.record.stats, n_replications_total: 1, n_reproductions_total: 0 },
        },
      });

      renderMatchedBanner([{ doi: "10.1038/nature12373", result }]);
      expect(document.getElementById(BANNER_ID)).not.toBeNull();

      removeBanner();
      expect(document.getElementById(BANNER_ID)).toBeNull();
    });

    it("does not throw when no banner is present", () => {
      expect(() => removeBanner()).not.toThrow();
    });
  });

  describe("renderInlineBadges", () => {
    it("inserts badge after DOI links", () => {
      document.body.innerHTML = `
        <a href="https://doi.org/10.1038/nature12373">Paper link</a>
      `;

      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1038/nature12373"), {
        status: "matched",
        result: MOCK_RESULT,
        source: "extracted",
      });

      renderInlineBadges(state);

      const badge = document.querySelector(".flora-inline-badge");
      expect(badge).not.toBeNull();
      expect(badge?.shadowRoot).not.toBeNull();
    });

    it("does not duplicate badges on second call", () => {
      document.body.innerHTML = `
        <a href="https://doi.org/10.1038/nature12373">Paper link</a>
      `;

      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1038/nature12373"), {
        status: "matched",
        result: MOCK_RESULT,
        source: "extracted",
      });

      renderInlineBadges(state);
      renderInlineBadges(state);

      const badges = document.querySelectorAll(".flora-inline-badge");
      expect(badges).toHaveLength(1);
    });

    it("skips links without DOIs", () => {
      document.body.innerHTML = `
        <a href="https://example.com/page">Regular link</a>
      `;

      const state = new Map<DoiString, LookupState>();
      renderInlineBadges(state);

      expect(document.querySelector(".flora-inline-badge")).toBeNull();
    });

    it("skips DOIs with no-match state", () => {
      document.body.innerHTML = `
        <a href="https://doi.org/10.1038/nature12373">Paper link</a>
      `;

      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1038/nature12373"), { status: "no-match" });

      renderInlineBadges(state);

      expect(document.querySelector(".flora-inline-badge")).toBeNull();
    });

    it("injects badge next to a SICI DOI link whose text contains literal angle brackets", () => {
      document.body.innerHTML = `
        <a href="https://doi.org/10.1002/(SICI)1097-0266(199704)18:4%3C303::AID-SMJ869%3E3.0.CO;2-G">
          https://doi.org/10.1002/(SICI)1097-0266(199704)18:4&lt;303::AID-SMJ869&gt;3.0.CO;2-G
        </a>
      `;

      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g"), {
        status: "matched",
        result: MOCK_RESULT,
        source: "extracted",
      });

      renderInlineBadges(state);

      expect(document.querySelector(".flora-inline-badge")).not.toBeNull();
    });

    it("does not badge a DOI link inside a contenteditable editor", () => {
      document.body.innerHTML = `
        <div contenteditable="true">
          <a href="https://doi.org/10.1038/nature12373">Paper link</a>
        </div>
      `;

      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1038/nature12373"), {
        status: "matched",
        result: MOCK_RESULT,
        source: "extracted",
      });

      renderInlineBadges(state);

      expect(document.querySelector(".flora-inline-badge")).toBeNull();
    });

    it("does not badge a DOI typed as prose inside a contenteditable editor", () => {
      document.body.innerHTML = `
        <div contenteditable="true">See 10.1038/nature12373 for details.</div>
      `;

      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1038/nature12373"), {
        status: "matched",
        result: MOCK_RESULT,
        source: "extracted",
      });

      renderInlineBadges(state);

      expect(document.querySelector(".flora-inline-badge")).toBeNull();
    });

    it("does not add a second badge when a host node is wedged between the anchor and its badge", () => {
      // Positional dedupe (nextElementSibling) is defeated when a site inserts a
      // tooltip/pill between the anchor and FLoRA's badge; DOI-identity dedupe is not.
      document.body.innerHTML = `
        <p><a href="https://doi.org/10.1038/nature12373">Paper link</a></p>
      `;
      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1038/nature12373"), { status: "matched", result: MOCK_RESULT, source: "extracted" });

      renderInlineBadges(state);
      expect(document.querySelectorAll(".flora-inline-badge")).toHaveLength(1);

      // A host inserts a node right after the anchor — now anchor → span → badge.
      const anchor = document.querySelector("a")!;
      const intruder = document.createElement("span");
      intruder.textContent = "tooltip";
      anchor.insertAdjacentElement("afterend", intruder);

      renderInlineBadges(state);
      expect(document.querySelectorAll(".flora-inline-badge")).toHaveLength(1);
    });

    it("tags each badge host with its DOI", () => {
      document.body.innerHTML = `<a href="https://doi.org/10.1038/nature12373">Paper link</a>`;
      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1038/nature12373"), { status: "matched", result: MOCK_RESULT, source: "extracted" });

      renderInlineBadges(state);
      const badge = document.querySelector<HTMLElement>(".flora-inline-badge");
      expect(badge?.dataset.floraDoi).toBe("10.1038/nature12373");
    });

    it("replaces a stale badge for a different DOI on a reused anchor", () => {
      // React reuses an <a> node but swaps its href/DOI — the old badge is stale.
      document.body.innerHTML = `<a href="https://doi.org/10.1038/nature12373">Paper link</a>`;
      const stateA = new Map<DoiString, LookupState>();
      stateA.set(doi("10.1038/nature12373"), { status: "matched", result: MOCK_RESULT, source: "extracted" });
      renderInlineBadges(stateA);
      expect(document.querySelector<HTMLElement>(".flora-inline-badge")?.dataset.floraDoi)
        .toBe("10.1038/nature12373");

      // Reuse the anchor for a new DOI.
      const anchor = document.querySelector("a")!;
      anchor.href = "https://doi.org/10.1016/j.cell.2020.01.001";
      const stateB = new Map<DoiString, LookupState>();
      stateB.set(doi("10.1016/j.cell.2020.01.001"), { status: "matched", result: MOCK_RESULT, source: "extracted" });
      renderInlineBadges(stateB);

      const badges = document.querySelectorAll<HTMLElement>(".flora-inline-badge");
      expect(badges).toHaveLength(1);
      expect(badges[0].dataset.floraDoi).toBe("10.1016/j.cell.2020.01.001");
    });

    it("places a prose-DOI badge immediately after the DOI text node, not at the block end", () => {
      document.body.innerHTML = `<p id="p">See 10.1038/nature12373 for more details here.</p>`;
      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1038/nature12373"), { status: "matched", result: MOCK_RESULT, source: "extracted" });

      renderInlineBadges(state);

      const p = document.getElementById("p")!;
      const badge = p.querySelector<HTMLElement>(".flora-inline-badge");
      expect(badge).not.toBeNull();
      // The DOI text stays to the left of the badge; the trailing prose to its right.
      expect(badge!.previousSibling?.textContent).toContain("10.1038/nature12373");
      expect(badge!.previousSibling?.textContent).not.toContain("for more details");
      expect(badge!.nextSibling?.textContent).toContain("for more details");
    });

    it("injects badge next to a SICI DOI non-doi.org link whose text contains the full DOI", () => {
      document.body.innerHTML = `
        <a href="https://onlinelibrary.wiley.com/doi/10.1002/(SICI)1097-0266(199704)18:4%3C303::AID-SMJ869%3E3.0.CO;2-G">
          10.1002/(SICI)1097-0266(199704)18:4&lt;303::AID-SMJ869&gt;3.0.CO;2-G
        </a>
      `;

      const state = new Map<DoiString, LookupState>();
      state.set(doi("10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g"), {
        status: "matched",
        result: MOCK_RESULT,
        source: "extracted",
      });

      renderInlineBadges(state);

      expect(document.querySelector(".flora-inline-badge")).not.toBeNull();
    });
  });
});
