import { describe, it, expect, beforeEach } from "vitest";
import { renderResolvedReferences, type ResolvedReference } from "../../src/content-general/references";
import type { RetractionResponse } from "../../src/shared/types";
import { doi } from "../helpers";

// renderResolvedReferences documents itself as idempotent at the pill level.
// Two overlapping render passes can hand it the same resolved list; without a
// per-entry marker each call would place another DOI pill on the citation.
describe("renderResolvedReferences idempotence", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function entryFor(id: string, doiStr: string): ResolvedReference {
    const li = document.createElement("li");
    li.id = id;
    li.textContent = `Author, A. (2015). A study. Journal of Mock Studies. https://doi.org/${doiStr}`;
    document.body.appendChild(li);
    return {
      entry: { element: li, doi: doi(doiStr), doiInText: true, text: li.textContent },
      doi: doi(doiStr),
      mode: "hidden",
    };
  }

  it("places exactly one DOI pill per entry when called twice with the same list", () => {
    const resolved = [entryFor("e1", "10.5555/flora.repl.0001")];

    renderResolvedReferences(resolved, new Map());
    renderResolvedReferences(resolved, new Map());

    expect(document.querySelectorAll(".flora-doi-label")).toHaveLength(1);
  });

  it("does not stack a notice pill on repeated renders of a retracted reference", () => {
    const doiStr = "10.5555/flora.retr.0003";
    const resolved = [entryFor("e2", doiStr)];
    const retractionByDoi = new Map<string, RetractionResponse>([
      [doiStr, { originDoi: doi(doiStr), doi: doi("10.9999/notice"), kind: "retraction" }],
    ]);

    renderResolvedReferences(resolved, retractionByDoi);
    renderResolvedReferences(resolved, retractionByDoi);

    expect(document.querySelectorAll(".flora-doi-label")).toHaveLength(1);
    expect(document.querySelectorAll(".flora-notice-pill")).toHaveLength(1);
  });

  it("still pills a fresh entry element after a hydration wipe replaced the node", () => {
    const doiStr = "10.5555/flora.repl.0001";
    const first = entryFor("e3", doiStr);
    renderResolvedReferences([first], new Map());
    expect(document.querySelectorAll(".flora-doi-label")).toHaveLength(1);

    // Hydration wipe: the old <li> is gone, replaced by a fresh (unmarked) node.
    document.body.innerHTML = "";
    const second = entryFor("e3", doiStr);
    renderResolvedReferences([second], new Map());

    expect(document.querySelectorAll(".flora-doi-label")).toHaveLength(1);
  });
});
