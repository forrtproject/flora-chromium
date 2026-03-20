import { describe, it, expect, beforeEach } from "vitest";
import { renderScholarBadge } from "../../src/content-scholar/badge";
import { mockResult } from "../helpers";

const MOCK_RESULT = mockResult();

describe("renderScholarBadge", () => {
  let row: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    row = document.createElement("div");
    row.classList.add("gs_r", "gs_or", "gs_scl");
    row.innerHTML = `
      <div class="gs_ri">
        <h3 class="gs_rt"><a href="#">Title</a></h3>
        <div class="gs_a">Authors</div>
      </div>
    `;
    document.body.appendChild(row);
  });

  it("inserts a Shadow DOM badge inside .gs_ggs", () => {
    renderScholarBadge(row, { status: "matched", result: MOCK_RESULT, source: "extracted" });

    const host = row.querySelector(".flora-scholar-badge-host");
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).not.toBeNull();
    // Badge is placed in .gs_ggs (created if absent, inserted before .gs_ri)
    expect(host?.parentElement?.classList.contains("gs_ggs")).toBe(true);

    const badge = host?.shadowRoot?.querySelector(".flora-scholar-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("3 replications");
  });

  it("does not double-render badges", () => {
    renderScholarBadge(row, { status: "matched", result: MOCK_RESULT, source: "extracted" });
    renderScholarBadge(row, { status: "matched", result: MOCK_RESULT, source: "extracted" });

    const hosts = row.querySelectorAll(".flora-scholar-badge-host");
    expect(hosts).toHaveLength(1);
  });

  it("shows success class when replications exist", () => {
    renderScholarBadge(row, { status: "matched", result: MOCK_RESULT, source: "extracted" });

    const host = row.querySelector(".flora-scholar-badge-host");
    const badge = host?.shadowRoot?.querySelector(".flora-scholar-badge");
    expect(badge?.classList.contains("badge--success")).toBe(true);
  });

  it("skips rendering when no replications or reproductions", () => {
    const noReplResult = mockResult();
    noReplResult.record.stats.n_replications_total = 0;
    noReplResult.record.stats.n_reproductions_total = 0;
    noReplResult.record.stats.n_originals_total = 5;
    renderScholarBadge(row, { status: "matched", result: noReplResult, source: "extracted" });

    const host = row.querySelector(".flora-scholar-badge-host");
    expect(host).toBeNull();
  });

  it("does nothing for non-matched states", () => {
    renderScholarBadge(row, { status: "no-match" });
    expect(row.querySelector(".flora-scholar-badge-host")).toBeNull();
  });

  it("creates .gs_ggs container when absent", () => {
    const bareRow = document.createElement("div");
    renderScholarBadge(bareRow, { status: "matched", result: MOCK_RESULT, source: "extracted" });
    const host = bareRow.querySelector(".flora-scholar-badge-host");
    expect(host).not.toBeNull();
    // Badge is inside a created .gs_ggs container
    expect(host?.parentElement?.classList.contains("gs_ggs")).toBe(true);
  });
});
