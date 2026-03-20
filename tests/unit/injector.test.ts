import { describe, it, expect, beforeEach } from "vitest";
import type { DoiString, LookupState } from "../../src/shared/types";
import { renderLoadingBanner, renderErrorBanner, renderMatchedBanner, removeBanner, renderInlineBadges } from "../../src/content-general/injector";
import { doi, mockResult } from "../helpers";

const MOCK_RESULT = mockResult();

describe("injector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.style.removeProperty("padding-top");
  });

  describe("renderLoadingBanner", () => {
    it("creates a banner host when rendering loading state", () => {
      renderLoadingBanner();

      const host = document.getElementById("flora-banner-host");
      expect(host).not.toBeNull();
      expect(host?.textContent).toContain("Checking");
    });

    it("inserts FLoRA logo span in the banner", () => {
      renderLoadingBanner();

      const host = document.getElementById("flora-banner-host");
      expect(host?.textContent).toContain("FLoRA");
    });
  });

  describe("renderMatchedBanner", () => {
    it("shows replication counts for a single DOI", () => {
      renderMatchedBanner([{ doi: "10.1038/nature12373", result: MOCK_RESULT }]);

      const host = document.getElementById("flora-banner-host");
      expect(host?.textContent).toContain("3 replications");
      expect(host?.textContent).toContain("1 reproduction");
    });

    it("shows FLoRA label when replications exist", () => {
      renderMatchedBanner([{ doi: "10.1038/nature12373", result: MOCK_RESULT }]);

      const host = document.getElementById("flora-banner-host");
      expect(host?.textContent).toContain("FLoRA");
    });

    it("shows DOI count summary for multiple DOIs", () => {
      renderMatchedBanner([
        { doi: "10.1038/nature12373", result: MOCK_RESULT },
        { doi: "10.1126/science.9999", result: MOCK_RESULT },
      ]);

      const host = document.getElementById("flora-banner-host");
      expect(host?.textContent).toContain("2 DOIs");
    });

    it("shows single View details link for multiple DOIs", () => {
      renderMatchedBanner([
        { doi: "10.1038/nature12373", result: MOCK_RESULT },
        { doi: "10.1126/science.9999", result: MOCK_RESULT },
      ]);

      const host = document.getElementById("flora-banner-host");
      const links = host?.querySelectorAll("a");
      expect(links?.length).toBe(1);
      expect(links?.[0].textContent).toBe("View details");
    });

    it("removes banner when no matches", () => {
      renderLoadingBanner();
      expect(document.getElementById("flora-banner-host")).not.toBeNull();

      renderMatchedBanner([]);
      expect(document.getElementById("flora-banner-host")).toBeNull();
    });
  });

  describe("renderErrorBanner", () => {
    it("shows error state", () => {
      renderErrorBanner("API failed");

      const host = document.getElementById("flora-banner-host");
      expect(host?.textContent).toContain("Error");
      expect(host?.textContent).toContain("API failed");
    });
  });

  describe("removeBanner", () => {
    it("removes the banner host element", () => {
      renderLoadingBanner();
      expect(document.getElementById("flora-banner-host")).not.toBeNull();

      removeBanner();
      expect(document.getElementById("flora-banner-host")).toBeNull();
    });

    it("restores body padding-top", () => {
      renderLoadingBanner();
      removeBanner();
      expect(document.body.style.paddingTop).toBe("");
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
  });
});
