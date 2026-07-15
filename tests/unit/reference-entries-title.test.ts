import { describe, it, expect, beforeEach } from "vitest";
import { findReferenceEntries, chooseArticleTitleElement, beginDomScanPass } from "../../src/shared/doi-extractor";

describe("findReferenceEntries — table bibliography splitting", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    // findReferenceContainers memoizes per scan-epoch; bump it so each test
    // scans its own DOM rather than a previous test's cached containers.
    beginDomScanPass();
  });

  it("treats each citation <tr> of a reference table as its own entry", () => {
    document.body.innerHTML = `
      <table class="references">
        <thead><tr><th>#</th><th>Citation</th><th>DOI</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Author, A. (2015). A highly replicated finding. Journal of Mock Studies.</td><td class="doi">10.5555/flora.repl.0001</td></tr>
          <tr><td>2</td><td>Author, C. (2016). A reproduced analysis. Journal of Mock Studies.</td><td class="doi">10.5555/flora.repro.0002</td></tr>
          <tr><td>3</td><td>Author, D. (2017). A retracted study. Journal of Mock Studies.</td><td class="doi">10.5555/flora.retr.0003</td></tr>
        </tbody>
      </table>`;
    const entries = findReferenceEntries(document);
    // One entry per data row (header row excluded), each anchored to a <tr>.
    expect(entries.length).toBe(3);
    expect(entries.every((e) => e.element.tagName === "TR")).toBe(true);
    // Each entry carries the DOI read from its own row's text.
    const dois = entries.map((e) => e.doi);
    expect(dois).toContain("10.5555/flora.repl.0001");
    expect(dois).toContain("10.5555/flora.retr.0003");
  });

  it("does not split header-only rows or non-citation rows (no year)", () => {
    document.body.innerHTML = `
      <table class="references">
        <thead><tr><th>Citation</th><th>DOI</th></tr></thead>
        <tbody>
          <tr><td>Show more results</td><td></td></tr>
          <tr><td>Nav stub without a year</td><td></td></tr>
        </tbody>
      </table>`;
    // Fewer than two citation-looking rows → falls back to non-table detection,
    // so the rows are NOT surfaced as citation entries.
    const entries = findReferenceEntries(document);
    expect(entries.every((e) => e.element.tagName !== "TR")).toBe(true);
  });

  it("still handles a non-table <li> reference list normally", () => {
    document.body.innerHTML = `
      <ol class="references">
        <li>Author, A. (2015). Finding. 10.5555/flora.repl.0001</li>
        <li>Author, B. (2016). Analysis. 10.5555/flora.repro.0002</li>
      </ol>`;
    const entries = findReferenceEntries(document);
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.element.tagName === "LI")).toBe(true);
  });
});

describe("chooseArticleTitleElement", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("prefers a heading matching citation_title over the first (site-name) h1", () => {
    document.head.innerHTML = `<meta name="citation_title" content="Cognitive bias in decision making">`;
    document.body.innerHTML = `
      <h1 id="site">Journal of Mock Studies</h1>
      <h1 id="article">Cognitive bias in decision making</h1>`;
    expect(chooseArticleTitleElement(document)?.id).toBe("article");
  });

  it("matches when the heading carries extra chrome around the citation title", () => {
    document.head.innerHTML = `<meta name="citation_title" content="Cognitive bias in decision making">`;
    document.body.innerHTML = `
      <h1 id="site">Mock Journal</h1>
      <h2 id="article">Cognitive bias in decision making — Mock Journal Online</h2>`;
    expect(chooseArticleTitleElement(document)?.id).toBe("article");
  });

  it("falls back to a common title selector when no citation_title matches a heading", () => {
    document.body.innerHTML = `
      <h1 id="site">Journal of Mock Studies</h1>
      <div class="article-title" id="real">The Real Article Title</div>`;
    expect(chooseArticleTitleElement(document)?.id).toBe("real");
  });

  it("falls back to the first h1 when nothing else identifies a title", () => {
    document.body.innerHTML = `<h1 id="only">Some heading</h1><h2 id="sub">Section</h2>`;
    expect(chooseArticleTitleElement(document)?.id).toBe("only");
  });

  it("returns null when the page has no heading at all", () => {
    document.body.innerHTML = `<p>no headings here</p>`;
    expect(chooseArticleTitleElement(document)).toBeNull();
  });
});
