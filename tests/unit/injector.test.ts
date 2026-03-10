import { describe, it, expect, beforeEach } from "vitest";
import type { DoiString, LookupState } from "../../src/shared/types";
import { renderLoadingBanner, renderErrorBanner, renderMatchedBanner, removeBanner, renderInlineBadges } from "../../src/content-general/injector";
import { doi, mockResult } from "../helpers";

const MOCK_RESULT = mockResult();

describe("injector", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.style.removeProperty("margin-top");
  });

  describe("renderLoadingBanner", () => {
    it("creates a Shadow DOM host when rendering loading state", () => {
      renderLoadingBanner();

      const host = document.getElementById("flora-banner-host");
      expect(host).not.toBeNull();
      expect(host?.shadowRoot).not.toBeNull();

      const bannerText = host?.shadowRoot?.querySelector(".flora-banner-text");
      expect(bannerText?.textContent).toContain("Checking");
    });

    it("adjusts body margin-top for banner space", () => {
      renderLoadingBanner();
      expect(document.body.style.marginTop).toBe("40px");
    });
  });

  describe("renderMatchedBanner", () => {
    it("shows replication counts for a single DOI", () => {
      renderMatchedBanner([{ doi: "10.1038/nature12373", result: MOCK_RESULT }]);

      const host = document.getElementById("flora-banner-host");
      const bannerText = host?.shadowRoot?.querySelector(".flora-banner-text");
      expect(bannerText?.textContent).toContain("3 replications");
      expect(bannerText?.textContent).toContain("1 reproduction");
    });

    it("shows success class when replications exist", () => {
      renderMatchedBanner([{ doi: "10.1038/nature12373", result: MOCK_RESULT }]);

      const host = document.getElementById("flora-banner-host");
      const inner = host?.shadowRoot?.querySelector(".flora-banner-inner");
      expect(inner?.classList.contains("flora-banner--success")).toBe(true);
    });

    it("shows DOI count summary for multiple DOIs", () => {
      renderMatchedBanner([
        { doi: "10.1038/nature12373", result: MOCK_RESULT },
        { doi: "10.1126/science.9999", result: MOCK_RESULT },
      ]);

      const host = document.getElementById("flora-banner-host");
      const bannerText = host?.shadowRoot?.querySelector(".flora-banner-text");
      expect(bannerText?.textContent).toContain("2 DOIs");
    });

    it("shows single View details link for multiple DOIs", () => {
      renderMatchedBanner([
        { doi: "10.1038/nature12373", result: MOCK_RESULT },
        { doi: "10.1126/science.9999", result: MOCK_RESULT },
      ]);

      const host = document.getElementById("flora-banner-host");
      const links = host?.shadowRoot?.querySelectorAll(".flora-banner-link");
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
      const inner = host?.shadowRoot?.querySelector(".flora-banner-inner");
      expect(inner?.classList.contains("flora-banner--error")).toBe(true);
      expect(inner?.textContent).toContain("API failed");
    });
  });

  describe("removeBanner", () => {
    it("removes the banner host element", () => {
      renderLoadingBanner();
      expect(document.getElementById("flora-banner-host")).not.toBeNull();

      removeBanner();
      expect(document.getElementById("flora-banner-host")).toBeNull();
    });

    it("restores body margin-top", () => {
      renderLoadingBanner();
      removeBanner();
      expect(document.body.style.marginTop).toBe("");
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
