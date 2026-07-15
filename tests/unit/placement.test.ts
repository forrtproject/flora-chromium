import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  __setDisplayProbe,
  isFlexOrGridContainer,
  isTableStructural,
  isAppendSafe,
  isFloraOwned,
  isElementVisible,
  mostTextBearingCell,
  smallestTextContainer,
  bestInnerTextHost,
  insertNodeAfter,
  appendNodeInto,
} from "../../src/shared/placement";

// jsdom cannot compute real layout, so the placement module reads computed
// display through an injectable probe. Each test drives it with a display map
// keyed by an element's data-display attribute (default "block").
function useDisplayAttr(): void {
  __setDisplayProbe((el) => (el as HTMLElement).dataset?.display ?? "block");
}

function makeBadge(doi = "10.1/x"): HTMLElement {
  const b = document.createElement("span");
  b.className = "flora-inline-badge";
  b.dataset.floraDoi = doi;
  b.textContent = "BADGE";
  return b;
}

describe("placement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    useDisplayAttr();
  });
  afterEach(() => {
    __setDisplayProbe(null);
  });

  describe("container classification", () => {
    it("detects flex/grid displays", () => {
      const el = document.createElement("div");
      for (const d of ["flex", "grid", "inline-flex", "inline-grid"]) {
        el.dataset.display = d;
        expect(isFlexOrGridContainer(el)).toBe(true);
      }
      el.dataset.display = "block";
      expect(isFlexOrGridContainer(el)).toBe(false);
    });

    it("detects structural table elements (but not cells)", () => {
      for (const tag of ["table", "thead", "tbody", "tfoot", "tr"]) {
        expect(isTableStructural(document.createElement(tag))).toBe(true);
      }
      expect(isTableStructural(document.createElement("td"))).toBe(false);
      expect(isTableStructural(document.createElement("th"))).toBe(false);
      expect(isTableStructural(document.createElement("div"))).toBe(false);
    });

    it("isAppendSafe is false for flex/grid and table-structural, true otherwise", () => {
      const flex = document.createElement("div");
      flex.dataset.display = "flex";
      expect(isAppendSafe(flex)).toBe(false);
      expect(isAppendSafe(document.createElement("tr"))).toBe(false);
      expect(isAppendSafe(document.createElement("span"))).toBe(true);
    });
  });

  describe("isFloraOwned", () => {
    it("is true for FLoRA's injected UI and its descendants", () => {
      document.body.innerHTML = `
        <span class="flora-doi-label"><span id="inner">10.1/x</span></span>
        <span class="flora-notice-pill"></span>
        <span class="flora-inline-badge"></span>
        <div id="flora-pubpeer-panel"><p id="row">x</p></div>
        <p id="page">page text</p>`;
      expect(isFloraOwned(document.getElementById("inner")!)).toBe(true);
      expect(isFloraOwned(document.querySelector(".flora-notice-pill")!)).toBe(true);
      expect(isFloraOwned(document.getElementById("row")!)).toBe(true);
      expect(isFloraOwned(document.getElementById("page")!)).toBe(false);
    });
  });

  describe("isElementVisible", () => {
    it("treats an ordinary element as visible", () => {
      document.body.innerHTML = `<p id="t">hello</p>`;
      expect(isElementVisible(document.getElementById("t")!)).toBe(true);
    });

    it("treats an element in a display:none subtree as hidden", () => {
      document.body.innerHTML = `<div style="display:none"><a id="t" href="#">x</a></div>`;
      expect(isElementVisible(document.getElementById("t")!)).toBe(false);
    });

    it("treats a visibility:hidden ancestor as hidden", () => {
      document.body.innerHTML = `<div style="visibility:hidden"><span id="t">x</span></div>`;
      expect(isElementVisible(document.getElementById("t")!)).toBe(false);
    });
  });

  describe("mostTextBearingCell", () => {
    it("returns the row cell carrying the most text", () => {
      document.body.innerHTML = `
        <table><tr id="r">
          <td>1</td>
          <td>Author, A. (2015). A long citation body goes here.</td>
          <td>10.1/x</td>
        </tr></table>`;
      const cell = mostTextBearingCell(document.getElementById("r")!);
      expect(cell?.textContent).toContain("long citation body");
    });
  });

  describe("smallestTextContainer", () => {
    it("finds the tightest append-safe element containing the DOI", () => {
      document.body.innerHTML = `
        <li id="entry">Author (2017). Title. <span class="doi">10.1/x</span>
          <div class="actions"><a href="#">PDF</a></div>
        </li>`;
      const host = smallestTextContainer(document.getElementById("entry")!, "10.1/x");
      expect(host?.className).toBe("doi");
    });

    it("never returns a FLoRA-owned element (e.g. the DOI pill popover)", () => {
      document.body.innerHTML = `
        <li id="entry">Author (2017). Title.
          <span class="doi">10.1/x
            <span class="flora-doi-label"><span class="popover">10.1/x</span></span>
          </span>
        </li>`;
      const host = smallestTextContainer(document.getElementById("entry")!, "10.1/x");
      expect(host?.className).toBe("doi");
      expect(isFloraOwned(host!)).toBe(false);
    });
  });

  describe("insertNodeAfter — flex/grid/table decision tree", () => {
    it("inserts as a following sibling when the parent is ordinary flow", () => {
      document.body.innerHTML = `<p id="p"><a id="a" href="#">link</a></p>`;
      const anchor = document.getElementById("a")!;
      insertNodeAfter(anchor, makeBadge());
      expect(anchor.nextElementSibling?.classList.contains("flora-inline-badge")).toBe(true);
      // No new element added to the paragraph beyond the badge.
      expect(document.querySelectorAll("#p > *").length).toBe(2);
    });

    it("nests into preferredHost instead of becoming a new flex item", () => {
      document.body.innerHTML = `
        <div id="row" data-display="flex">
          <a id="a" href="#">DOI</a><a href="#">PDF</a>
        </div>
        <div id="body">citation body</div>`;
      const anchor = document.getElementById("a")!;
      const body = document.getElementById("body")!;
      insertNodeAfter(anchor, makeBadge(), body);
      // The flex row still has exactly its two links — no injected item.
      expect(document.querySelectorAll("#row > *").length).toBe(2);
      // The badge went into the preferred host.
      expect(body.querySelector(".flora-inline-badge")).not.toBeNull();
    });

    it("climbs to the nearest flow ancestor when no preferredHost is given", () => {
      document.body.innerHTML = `
        <div id="outer">
          <div id="row" data-display="flex"><a id="a" href="#">DOI</a></div>
        </div>`;
      const anchor = document.getElementById("a")!;
      insertNodeAfter(anchor, makeBadge());
      // Not a new flex item in the row.
      expect(document.querySelectorAll("#row > *").length).toBe(1);
      // Landed in the ordinary-flow ancestor.
      expect(document.querySelector("#outer > .flora-inline-badge")).not.toBeNull();
    });

    it("places into the citation cell when the anchor is a table row", () => {
      document.body.innerHTML = `
        <table><tr id="a">
          <td>1</td><td>Author (2017). A retracted study.</td><td>10.1/x</td>
        </tr></table>`;
      const anchor = document.getElementById("a")!;
      insertNodeAfter(anchor, makeBadge());
      // The span must not be a direct child of the <tr> (invalid, hoisted).
      expect(anchor.querySelector(":scope > .flora-inline-badge")).toBeNull();
      const cell = anchor.querySelector("td:nth-child(2)");
      expect(cell?.querySelector(".flora-inline-badge")).not.toBeNull();
    });
  });

  describe("appendNodeInto", () => {
    it("appends directly into an ordinary container", () => {
      document.body.innerHTML = `<span id="doi" class="doi">10.1/x</span>`;
      const c = document.getElementById("doi")!;
      appendNodeInto(c, makeBadge());
      expect(c.lastElementChild?.classList.contains("flora-inline-badge")).toBe(true);
    });

    it("nests into the citation body when the container is itself flex", () => {
      document.body.innerHTML = `
        <div id="ref" data-display="flex">
          <span class="num">1.</span>
          <div class="body">Author (2015). A highly replicated finding in cognition.</div>
        </div>`;
      const ref = document.getElementById("ref")!;
      appendNodeInto(ref, makeBadge());
      // Not a new flex item at the ref level (still num + body).
      expect(document.querySelectorAll("#ref > *").length).toBe(2);
      expect(ref.querySelector(".body .flora-inline-badge")).not.toBeNull();
    });
  });

  describe("bestInnerTextHost", () => {
    it("returns the largest append-safe proper-subset text host", () => {
      document.body.innerHTML = `
        <div id="ref" data-display="flex">
          <span class="num">1.</span>
          <div class="body">Author, A. (2015). A highly replicated finding in cognition.</div>
        </div>`;
      const host = bestInnerTextHost(document.getElementById("ref")!);
      expect(host?.className).toBe("body");
    });
  });
});
