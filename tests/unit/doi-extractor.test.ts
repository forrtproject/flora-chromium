import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { extractDOIs } from "../../src/shared/doi-extractor";

function loadFixture(name: string): Document {
  const html = readFileSync(
    join(__dirname, "..", "fixtures", name),
    "utf-8"
  );
  return new JSDOM(html).window.document;
}

describe("extractDOIs", () => {
  it("extracts DOI from citation_doi meta tag", () => {
    const doc = loadFixture("meta-tags.html");
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1038/nature12373");
  });

  it("extracts DOI from JSON-LD @id", () => {
    const doc = loadFixture("json-ld.html");
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1126/science.1234567");
  });

  it("extracts DOI from visible body text via regex", () => {
    const doc = loadFixture("doi-in-text.html");
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1371/journal.pone.0012345");
  });

  it("extracts DOI from doi.org link with truncated visible text", () => {
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <a href="https://doi.org/10.1002/jaba.70048" class="doi-link">https://doi.org/10.1002/j...</a>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1002/jaba.70048");
  });

  it("does not extract DOIs from non-doi.org link hrefs", () => {
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <a href="https://example.com/article/10.1016/j.cell.2020.01.001">Link to paper</a>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toHaveLength(0);
  });

  it("returns empty array when no DOIs present", () => {
    const doc = loadFixture("no-dois.html");
    const dois = extractDOIs(doc);
    expect(dois).toHaveLength(0);
  });

  it("deduplicates DOIs found in multiple layers", () => {
    const html = `<!DOCTYPE html>
    <html><head>
      <meta name="citation_doi" content="10.1038/nature12373">
    </head><body>
      <p>Also see 10.1038/nature12373 in text.</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toHaveLength(1);
    expect(dois[0]).toBe("10.1038/nature12373");
  });

  it("extracts DOI from visible table cell text", () => {
    const doc = loadFixture("doi-in-table.html");
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1037/pspa0000345");
  });

  it("strips trailing punctuation from DOIs", () => {
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>See 10.1038/nature12373, and also (10.1126/science.9999999).</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1038/nature12373");
    expect(dois).toContain("10.1126/science.9999999");
    expect(dois.some(d => d.endsWith(","))).toBe(false);
    expect(dois.some(d => d.endsWith(")"))).toBe(false);
  });

  it("preserves balanced parentheses inside DOIs", () => {
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>See 10.1016/S0924-9338(98)80023-0 and 10.1016/S0924-9338(97)83297-X for details.</p>
      <p>Also (10.1016/S0924-9338(98)80023-0) in parens.</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1016/s0924-9338(98)80023-0");
    expect(dois).toContain("10.1016/s0924-9338(97)83297-x");
  });

  it("extracts DOI from full URL in body text", () => {
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>Available at https://doi.org/10.1016/j.jep.2021.114500 for review.</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1016/j.jep.2021.114500");
  });

  it("extracts DOI from page URL (e.g. SAGE journal URLs)", () => {
    const html = `<!DOCTYPE html><html><head></head><body><p>Abstract text</p></body></html>`;
    const doc = new JSDOM(html, {
      url: "https://journals.sagepub.com/doi/abs/10.1177/13634615211043764",
    }).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1177/13634615211043764");
  });

  it("rejects DOI fragments with single-character suffixes", () => {
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>10.1016/j is not a real DOI, nor is 10.1007/s</p>
      <p>But 10.1016/j.jesp.2012.11.012 and 10.1007/s11002-005-0457-y are real.</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).not.toContain("10.1016/j");
    expect(dois).not.toContain("10.1007/s");
    expect(dois).toContain("10.1016/j.jesp.2012.11.012");
    expect(dois).toContain("10.1007/s11002-005-0457-y");
  });

  it("extracts DOI broken by zero-width word-break characters", () => {
    // Sites with overflow-wrap:break-word may insert invisible chars into DOIs
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>10.1038/\u200Bnature\u00AD12373</p>
      <p>10.1016/j.cell.\u200C2020.\u200D01.001</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1038/nature12373");
    expect(dois).toContain("10.1016/j.cell.2020.01.001");
  });

  it("extracts multiple distinct DOIs from meta and text", () => {
    const html = `<!DOCTYPE html>
    <html><head>
      <meta name="citation_doi" content="10.1038/nature12373">
    </head><body>
      <p>See also 10.1126/science.9999999 in the references.</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toHaveLength(2);
    expect(dois).toContain("10.1038/nature12373");
    expect(dois).toContain("10.1126/science.9999999");
  });
});
