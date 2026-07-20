import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import {
  resolveSiteAdapter,
  applyPlacement,
  applyPillStyle,
  isInReferenceScope,
  SITE_ADAPTERS,
  type SiteAdapter,
} from "../../src/shared/site-adapters";
import { findReferenceEntries } from "../../src/shared/doi-extractor";

function loadFixture(name: string): Document {
  return new JSDOM(readFileSync(join(__dirname, "..", "fixtures", name), "utf-8"))
    .window.document;
}

function pill(): HTMLElement {
  const el = document.createElement("span");
  el.className = "flora-indicator-pill";
  return el;
}

describe("resolveSiteAdapter", () => {
  it("matches a registered hostname", () => {
    expect(resolveSiteAdapter("science.org")?.id).toBe("science.org");
    expect(resolveSiteAdapter("journals.sagepub.com")?.id).toBe("sagepub");
  });

  it("matches subdomains and ignores www.", () => {
    expect(resolveSiteAdapter("www.science.org")?.id).toBe("science.org");
    expect(resolveSiteAdapter("advances.science.org")?.id).toBe("science.org");
  });

  it("is case-insensitive", () => {
    expect(resolveSiteAdapter("WWW.Science.ORG")?.id).toBe("science.org");
  });

  it("returns null for an unregistered site, so callers go generic", () => {
    expect(resolveSiteAdapter("example.com")).toBeNull();
    expect(resolveSiteAdapter("nature.com")).toBeNull();
  });

  it("does not match a hostname that merely ends with a registered one", () => {
    // "notscience.org" must not be treated as a subdomain of "science.org".
    expect(resolveSiteAdapter("notscience.org")).toBeNull();
  });
});

describe("applyPlacement", () => {
  const root = () =>
    new JSDOM(`<div id="entry"><div class="body">text</div><div class="links">a</div></div>`)
      .window.document.querySelector("#entry")!;

  it("places into the first matching rule and reports success", () => {
    const entry = root();
    const p = pill();
    const placed = applyPlacement(
      [{ selector: ".body", position: "append" }],
      entry as Element,
      p
    );
    expect(placed).toBe(true);
    expect(entry.querySelector(".body")!.contains(p)).toBe(true);
  });

  it("falls through to the next rule when the first selector misses", () => {
    const entry = root();
    const p = pill();
    const placed = applyPlacement(
      [{ selector: ".nonexistent" }, { selector: ".body" }],
      entry as Element,
      p
    );
    expect(placed).toBe(true);
    expect(entry.querySelector(".body")!.contains(p)).toBe(true);
  });

  it("returns false when no rule matches, leaving the pill unplaced", () => {
    const entry = root();
    const p = pill();
    const placed = applyPlacement([{ selector: ".nope" }], entry as Element, p);
    expect(placed).toBe(false);
    expect(entry.contains(p)).toBe(false);
  });

  it("returns false for undefined/empty rules", () => {
    expect(applyPlacement(undefined, root() as Element, pill())).toBe(false);
    expect(applyPlacement([], root() as Element, pill())).toBe(false);
  });

  it("honours each position", () => {
    for (const [position, check] of [
      ["append", (e: Element, p: Node) => e.querySelector(".body")!.lastChild === p],
      ["prepend", (e: Element, p: Node) => e.querySelector(".body")!.firstChild === p],
      ["before", (e: Element, p: Node) => e.querySelector(".body")!.previousSibling === p],
      ["after", (e: Element, p: Node) => e.querySelector(".body")!.nextSibling === p],
    ] as const) {
      const entry = root();
      const p = pill();
      applyPlacement([{ selector: ".body", position }], entry as Element, p);
      expect(check(entry as Element, p), `position ${position}`).toBe(true);
    }
  });

  it('supports the ":self" sentinel for the root itself', () => {
    const entry = root();
    const p = pill();
    expect(applyPlacement([{ selector: ":self" }], entry as Element, p)).toBe(true);
    expect(entry.lastChild).toBe(p);
  });

  it("treats a detached match as no match", () => {
    // Publisher templates keep detached prototype nodes around; placing into
    // one loses the pill with no visible error.
    const doc = new JSDOM(`<div id="entry"></div>`).window.document;
    const entry = doc.querySelector("#entry")!;
    const detached = doc.createElement("div");
    detached.className = "body";
    entry.remove();
    const p = pill();
    expect(applyPlacement([{ selector: ".body" }], entry as Element, p)).toBe(false);
    expect(detached.contains(p)).toBe(false);
  });
});

// The two registered publishers both run Atypon Literatum. These fixtures are
// trimmed from live article pages, so the selectors are checked against markup
// the sites actually serve rather than an idealised version of it.
describe.each([
  ["science.org", "science-org-article.html", "science.org", ".citation"],
  ["journals.sagepub.com", "sagepub-article.html", "sagepub", ".citation-content"],
])("%s reference placement", (hostname, fixture, expectedId, expectedContainer) => {
  const adapter = () => resolveSiteAdapter(hostname) as SiteAdapter;

  it("resolves to the expected adapter", () => {
    expect(adapter().id).toBe(expectedId);
  });

  it(`places the pill in ${expectedContainer}, not the publisher's link row`, () => {
    const doc = loadFixture(fixture);
    const entry = doc.querySelector<HTMLElement>('div[role="listitem"]')!;
    const p = doc.createElement("span");

    expect(applyPlacement(adapter().referencePill, entry, p)).toBe(true);

    expect(entry.querySelector(expectedContainer)!.contains(p)).toBe(true);
    // The regression this exists to prevent: landing among
    // "Crossref | Web of Science | Google Scholar".
    expect(entry.querySelector(".external-links")!.contains(p)).toBe(false);
  });

  it("places the pill on every reference entry in the fixture", () => {
    const doc = loadFixture(fixture);
    const entries = doc.querySelectorAll<HTMLElement>('div[role="listitem"]');
    expect(entries.length).toBeGreaterThan(1);
    for (const entry of entries) {
      const p = doc.createElement("span");
      expect(applyPlacement(adapter().referencePill, entry, p)).toBe(true);
      expect(entry.querySelector(expectedContainer)!.contains(p)).toBe(true);
      expect(entry.querySelector(".external-links")!.contains(p)).toBe(false);
    }
  });

  it("places the title pill on the article h1", () => {
    const doc = loadFixture(fixture);
    const p = doc.createElement("span");
    expect(applyPlacement(adapter().titlePill, doc.documentElement, p)).toBe(true);
    expect(doc.querySelector("h1")!.contains(p)).toBe(true);
  });

  it("scopes reference pills to the bibliography", () => {
    const doc = loadFixture(fixture);
    const entry = doc.querySelector<HTMLElement>('div[role="listitem"]')!;
    expect(isInReferenceScope(entry, adapter())).toBe(true);

    // A footnote outside #bibliography must not qualify — Sage marks endnotes
    // up closely enough to citations that they get picked up as entries.
    const footnote = doc.createElement("div");
    footnote.setAttribute("role", "doc-footnote");
    footnote.textContent = "1. An author endnote from 2011 that looks like a citation.";
    doc.querySelector("article")!.appendChild(footnote);
    expect(isInReferenceScope(footnote, adapter())).toBe(false);
  });

  it("the reference detector finds entries carrying .citation-content", () => {
    // Guards the assumption the placement rules rest on: the element the
    // detector hands to placeReferencePill contains the target div.
    const doc = loadFixture(fixture);
    const withContent = findReferenceEntries(doc).filter((e) =>
      e.element.querySelector(".citation-content")
    );
    expect(withContent.length).toBeGreaterThan(0);
  });
});

describe("applyPillStyle", () => {
  const el = () => new JSDOM(`<span style="top:5px;"></span>`).window.document.querySelector("span")!;
  const base = { id: "t", hostnames: ["t.com"] };

  it("leaves the pill untouched with no adapter", () => {
    const p = el();
    applyPillStyle(p as HTMLElement, null, "reference");
    expect(p.style.top).toBe("5px");
  });

  it("keeps the default when the adapter declares no override", () => {
    const p = el();
    applyPillStyle(p as HTMLElement, base, "reference");
    expect(p.style.top).toBe("5px");
  });

  it("only touches the properties the override names", () => {
    const p = el();
    applyPillStyle(p as HTMLElement, { ...base, referencePillStyle: { "margin-left": "4px" } }, "reference");
    expect(p.style.marginLeft).toBe("4px");
    expect(p.style.top).toBe("5px");
  });

  it("overrides the built-in default", () => {
    const p = el();
    applyPillStyle(p as HTMLElement, { ...base, referencePillStyle: { top: "2px" } }, "reference");
    expect(p.style.top).toBe("2px");
  });

  it("tunes the two slots independently", () => {
    const adapter: SiteAdapter = {
      ...base,
      referencePillStyle: { top: "2px" },
      titlePillStyle: { top: "0px" },
    };
    const ref = el();
    const title = el();
    applyPillStyle(ref as HTMLElement, adapter, "reference");
    applyPillStyle(title as HTMLElement, adapter, "title");
    expect(ref.style.top).toBe("2px");
    expect(title.style.top).toBe("0px");
  });

  it("leaves a slot at its default when only the other slot is styled", () => {
    const adapter: SiteAdapter = { ...base, titlePillStyle: { top: "0px" } };
    const ref = el();
    applyPillStyle(ref as HTMLElement, adapter, "reference");
    expect(ref.style.top).toBe("5px");
  });

  it("accepts camelCase property names", () => {
    // setProperty ignores camelCase silently, so this must be normalised.
    const p = el();
    applyPillStyle(p as HTMLElement, { ...base, referencePillStyle: { marginLeft: "4px" } }, "reference");
    expect(p.style.marginLeft).toBe("4px");
  });

  it('honours a trailing "!important"', () => {
    const p = el();
    applyPillStyle(p as HTMLElement, { ...base, referencePillStyle: { top: "3px !important" } }, "reference");
    expect(p.style.top).toBe("3px");
    expect(p.style.getPropertyPriority("top")).toBe("important");
  });

  it("does not apply the other slot's style", () => {
    const p = el();
    applyPillStyle(p as HTMLElement, { ...base, titlePillStyle: { top: "9px" } }, "reference");
    expect(p.style.top).toBe("5px");
  });
});

describe("isInReferenceScope", () => {
  it("allows everything when the adapter declares no scope", () => {
    const doc = new JSDOM(`<div id="x">e</div>`).window.document;
    const el = doc.querySelector("#x")!;
    expect(isInReferenceScope(el, null)).toBe(true);
    expect(isInReferenceScope(el, { id: "t", hostnames: ["t.com"] })).toBe(true);
  });
});

describe("registry hygiene", () => {
  it("has unique ids", () => {
    const ids = SITE_ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares at least one hostname per adapter", () => {
    for (const a of SITE_ADAPTERS) expect(a.hostnames.length).toBeGreaterThan(0);
  });

  it("gives every site its own rule objects", () => {
    // Sites are tuned and broken independently, so no two adapters may share a
    // rule array or rule object by reference — editing one site's selectors
    // must never silently change another's. Two sites having equal selector
    // *values* is fine; sharing the same object is not.
    const seen = new Map<unknown, string>();
    for (const adapter of SITE_ADAPTERS) {
      for (const slot of ["referencePill", "titlePill"] as const) {
        const rules = adapter[slot];
        if (!rules) continue;
        for (const node of [rules as unknown, ...rules] as unknown[]) {
          const owner = seen.get(node);
          expect(
            owner,
            `${adapter.id}.${slot} shares a rule object with ${owner} — give it its own copy`
          ).toBeUndefined();
          seen.set(node, `${adapter.id}.${slot}`);
        }
      }
    }
  });

  it("resolves each registered site to a distinct adapter object", () => {
    const science = resolveSiteAdapter("science.org")!;
    const sage = resolveSiteAdapter("journals.sagepub.com")!;
    expect(science).not.toBe(sage);
    expect(science.referencePill).not.toBe(sage.referencePill);
  });
});
