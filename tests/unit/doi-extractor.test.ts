import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { extractDOIs, extractDOIsFromText } from "../../src/shared/doi-extractor";

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

  it("extracts SICI-format DOI with percent-encoded angle brackets and semicolon suffix", () => {
    // SICI DOIs (older Wiley/JSTOR) use angle brackets and the .co;2-x suffix pattern.
    // The semicolon must not truncate the match.
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>doi/10.1002/(sici)1097-0266(199704)18:4%3C303::aid-smj869%3E3.0.co;2-g</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g");
  });

  it("stops extraction at extra URL path segments in body text", () => {
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>10.1287/orsc.1040.0065/asfaubsfiusf/sfaigiuebgv?query=1</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toEqual(["10.1287/orsc.1040.0065"]);
  });

  it("stops at extra path segments in the page URL (URL extraction layer)", () => {
    // Journal article pages sometimes have /references or /full appended after the DOI.
    const html = `<!DOCTYPE html><html><head></head><body></body></html>`;
    const doc = new JSDOM(html, {
      url: "https://psycnet.apa.org/doi/10.1037/a0029709/full",
    }).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toEqual(["10.1037/a0029709"]);
  });

  it("extracts SICI DOI in sentence parentheses, preserving internal balanced parens", () => {
    // Outer '()' are sentence punctuation stripped by paren balancer.
    // Inner '(sici)' and '(199704)' are part of the DOI and must survive.
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>(10.1002/(sici)1097-0266(199704)18:4%3C303::aid-smj869%3E3.0.co;2-g)</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toEqual(["10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g"]);
  });

  it("extracts only exact DOIs, no over-capture, from a mixed reference list", () => {
    // Multiple DOIs with different trailing punctuation in one paragraph.
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>
        See (10.1037/a0029709), 10.1038/nature12373, and
        10.1016/j.cell.2020.01.001; also 10.1371/journal.pone.0033423.
      </p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1037/a0029709");
    expect(dois).toContain("10.1038/nature12373");
    expect(dois).toContain("10.1016/j.cell.2020.01.001");
    expect(dois).toContain("10.1371/journal.pone.0033423");
    expect(dois).toHaveLength(4);
    expect(dois.some(d => /[,;.)]+$/.test(d))).toBe(false);
  });
});

describe("extractDOIsFromText", () => {
  // ── Standard DOI set ──────────────────────────────────────────────────────
  it("extracts a standard set of real-world DOIs exactly", () => {
    const input = [
      "10.1287/orsc.1040.0065",
      "10.1002/smj.2573",
      "10.1017/s0047404500008472",
      "10.1017/cnj.2023.13",
      "10.48550/arxiv.2302.02083",
      "10.48550/arxiv.2302.08399",
      "10.1016/j.labeco.2016.04.004",
      "10.1016/j.econedurev.2020.102009",
      "10.1016/j.jbtep.2018.07.002",
      "10.1037/xap0000270",
      "10.1037/e653412011-001",
      "10.1037/a0029709",
      "10.1371/journal.pone.0033423",
    ].join("\n");
    const dois = extractDOIsFromText(input);
    expect(dois).toContain("10.1287/orsc.1040.0065");
    expect(dois).toContain("10.1002/smj.2573");
    expect(dois).toContain("10.1017/s0047404500008472");
    expect(dois).toContain("10.1017/cnj.2023.13");
    expect(dois).toContain("10.48550/arxiv.2302.02083");
    expect(dois).toContain("10.48550/arxiv.2302.08399");
    expect(dois).toContain("10.1016/j.labeco.2016.04.004");
    expect(dois).toContain("10.1016/j.econedurev.2020.102009");
    expect(dois).toContain("10.1016/j.jbtep.2018.07.002");
    expect(dois).toContain("10.1037/xap0000270");
    expect(dois).toContain("10.1037/e653412011-001");
    expect(dois).toContain("10.1037/a0029709");
    expect(dois).toContain("10.1371/journal.pone.0033423");
    expect(dois).toHaveLength(13);
  });

  it("extracts all 13 expected DOIs from a realistic reference paragraph", () => {
    // Tests extraction when DOIs appear with typical citation noise: doi: prefixes,
    // trailing commas, periods, closing parens, and other inline text.
    const text = `
      Smith et al. (doi:10.1287/orsc.1040.0065), Jones (10.1002/smj.2573),
      Williams (10.1017/s0047404500008472), Brown (10.1017/cnj.2023.13),
      Davis (10.48550/arxiv.2302.02083), Wilson (10.48550/arxiv.2302.08399),
      Taylor (10.1016/j.labeco.2016.04.004), Anderson (10.1016/j.econedurev.2020.102009),
      Thomas (10.1016/j.jbtep.2018.07.002), Jackson (10.1037/xap0000270),
      White (10.1037/e653412011-001), Harris (10.1037/a0029709),
      Martin (10.1371/journal.pone.0033423).
    `;
    const dois = extractDOIsFromText(text);
    const expected = [
      "10.1287/orsc.1040.0065",
      "10.1002/smj.2573",
      "10.1017/s0047404500008472",
      "10.1017/cnj.2023.13",
      "10.48550/arxiv.2302.02083",
      "10.48550/arxiv.2302.08399",
      "10.1016/j.labeco.2016.04.004",
      "10.1016/j.econedurev.2020.102009",
      "10.1016/j.jbtep.2018.07.002",
      "10.1037/xap0000270",
      "10.1037/e653412011-001",
      "10.1037/a0029709",
      "10.1371/journal.pone.0033423",
    ];
    for (const doi of expected) {
      expect(dois).toContain(doi);
    }
    expect(dois).toHaveLength(13);
  });

  // ── URL path segment truncation ───────────────────────────────────────────
  it("stops at extra URL path segments when followed by a query string", () => {
    const dois = extractDOIsFromText("10.1287/orsc.1040.0065/asfaubsfiusf/sfaigiuebgv?query");
    expect(dois).toEqual(["10.1287/orsc.1040.0065"]);
  });

  it("stops at extra URL path segments even without a query string", () => {
    const dois = extractDOIsFromText("10.1287/orsc.1040.0065/extra-routing-segment");
    expect(dois).toEqual(["10.1287/orsc.1040.0065"]);
  });

  it("stops at extra path segment in a full journal URL embedded in text", () => {
    // e.g. a URL like psycnet.apa.org/doi/10.1037/a0029709/summary displayed inline
    const dois = extractDOIsFromText(
      "Full text: https://psycnet.apa.org/doi/10.1037/a0029709/summary"
    );
    expect(dois).toEqual(["10.1037/a0029709"]);
  });

  // ── SICI DOI edge cases ───────────────────────────────────────────────────
  it("extracts SICI DOI with percent-encoded angle brackets and semicolon suffix", () => {
    const dois = extractDOIsFromText(
      "doi/10.1002/(sici)1097-0266(199704)18:4%3C303::aid-smj869%3E3.0.co;2-g"
    );
    expect(dois).toEqual(["10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g"]);
  });

  it("strips trailing period from SICI DOI at sentence end, preserving internal semicolon", () => {
    // The trailing '.' is sentence punctuation; the ';2-g' inside must survive.
    const dois = extractDOIsFromText(
      "See 10.1002/(sici)1097-0266(199704)18:4%3C303::aid-smj869%3E3.0.co;2-g."
    );
    expect(dois).toEqual(["10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g"]);
  });

  it("strips sentence-ending semicolon from SICI DOI, preserving internal semicolon", () => {
    // The '; Smith' semicolon is a list separator, not part of the DOI.
    // The earlier ';2-g' is inside the suffix and must be kept.
    const dois = extractDOIsFromText(
      "10.1002/(sici)1097-0266(199704)18:4%3C303::aid-smj869%3E3.0.co;2-g; Smith et al."
    );
    expect(dois).toEqual(["10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g"]);
  });

  it("strips outer sentence parentheses from SICI DOI, preserving internal balanced parens", () => {
    // Outer '()' are sentence punctuation. Inner '(sici)' and '(199704)' are DOI content.
    const dois = extractDOIsFromText(
      "(10.1002/(sici)1097-0266(199704)18:4%3C303::aid-smj869%3E3.0.co;2-g)"
    );
    expect(dois).toEqual(["10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g"]);
  });

  // ── Trailing punctuation and parentheses ─────────────────────────────────
  it("strips trailing semicolon when DOI appears in a semicolon-separated list", () => {
    const dois = extractDOIsFromText("See 10.1037/a0029709; also 10.1038/nature12373.");
    expect(dois).toContain("10.1037/a0029709");
    expect(dois).toContain("10.1038/nature12373");
    expect(dois).toHaveLength(2);
    expect(dois.some(d => d.endsWith(";"))).toBe(false);
    expect(dois.some(d => d.endsWith("."))).toBe(false);
  });

  it("strips unbalanced trailing parenthesis when DOI is cited in text", () => {
    const dois = extractDOIsFromText("(10.1037/a0029709)");
    expect(dois).toEqual(["10.1037/a0029709"]);
  });

  it("strips multiple trailing periods", () => {
    const dois = extractDOIsFromText("10.1037/a0029709...");
    expect(dois).toEqual(["10.1037/a0029709"]);
  });

  // ── Separators and adjacency ──────────────────────────────────────────────
  it("extracts all DOIs from a comma-separated list with no spaces", () => {
    // Commas delimit DOIs cleanly even without whitespace between them.
    const dois = extractDOIsFromText(
      "10.1037/a0029709,10.1037/e653412011-001,10.1037/xap0000270"
    );
    expect(dois).toEqual([
      "10.1037/a0029709",
      "10.1037/e653412011-001",
      "10.1037/xap0000270",
    ]);
  });

  it("extracts DOI following a doi: prefix", () => {
    const dois = extractDOIsFromText("doi:10.1287/orsc.1040.0065");
    expect(dois).toEqual(["10.1287/orsc.1040.0065"]);
  });

  // ── Normalisation ─────────────────────────────────────────────────────────
  it("lowercases uppercase letters in DOI suffix", () => {
    const dois = extractDOIsFromText("10.1038/NATURE12373");
    expect(dois).toEqual(["10.1038/nature12373"]);
  });

  // ── Rejection ─────────────────────────────────────────────────────────────
  it("rejects DOI with a single-character suffix", () => {
    const dois = extractDOIsFromText("10.1234/x is too short");
    expect(dois).toHaveLength(0);
  });

  it("does not extract anything from text with no DOIs", () => {
    const dois = extractDOIsFromText("This paper has no DOI references.");
    expect(dois).toHaveLength(0);
  });
});
