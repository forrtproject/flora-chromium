import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import {
  extractDOIs,
  extractDOIsFromText,
  findReferenceContainers,
  findReferenceEntries,
  extractDoiOccurrences,
} from "../../src/shared/doi-extractor";

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

  it("extracts SICI DOI with literal angle brackets decoded from HTML entities in body text", () => {
    // Real publisher pages (e.g. Wiley) render the DOI as &lt;303::AID-SMJ869&gt;
    // in their HTML, which becomes literal < > in innerText. The extractor must
    // not truncate at '<'.
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>10.1002/(SICI)1097-0266(199704)18:4&lt;303::AID-SMJ869&gt;3.0.CO;2-G</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g");
  });

  it("extracts SICI DOI via doi.org link with percent-encoded angle brackets in href", () => {
    // The href uses %3C/%3E; the link text shows decoded < > via HTML entities.
    // Both extractFromDoiLinks (href) and extractFromVisibleText (text) must find the full DOI.
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <a href="https://doi.org/10.1002/(SICI)1097-0266(199704)18:4%3C303::AID-SMJ869%3E3.0.CO;2-G">
        https://doi.org/10.1002/(SICI)1097-0266(199704)18:4&lt;303::AID-SMJ869&gt;3.0.CO;2-G
      </a>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
    expect(dois).toContain("10.1002/(sici)1097-0266(199704)18:4<303::aid-smj869>3.0.co;2-g");
    expect(dois).toHaveLength(1);
  });

  it("extracts SICI DOI when an inline anchor tag splits the %3E boundary", () => {
    // Some publisher pages hyperlink the '3E3.0.co' fragment inside the DOI,
    // leaving '%' as a bare text node and '3E3.0.co' inside an <a> tag.
    // The extractor must reassemble the full DOI from innerText.
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>10.1002/(sici)1097-0266(199704)18:4%3C303::aid-smj869%<a href="http://3e3.0.co/">3E3.0.co</a>;2-g</p>
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

  it("strips trailing balanced annotation like (matched) from SICI DOI in visible text", () => {
    // Sites sometimes append annotations such as "(matched)" directly after the DOI.
    // These are balanced parens so the unbalanced-paren stripper misses them.
    // Uses HTML entities so innerText exposes literal '<>' for DOI_TEXT_REGEX.
    const html = `<!DOCTYPE html>
    <html><head></head><body>
      <p>10.1002/(sici)1097-0266(199704)18:4&lt;303::aid-smj869&gt;3.0.co;2-g(matched)</p>
    </body></html>`;
    const doc = new JSDOM(html).window.document;
    const dois = extractDOIs(doc);
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

  // ── Official DOI spec examples (doi-handbook) ─────────────────────────────
  it("extracts SMPTE DOI with dot-separated suffix (spec example 1)", () => {
    const dois = extractDOIsFromText("10.5594/SMPTE.ST2067-21.2020");
    expect(dois).toEqual(["10.5594/smpte.st2067-21.2020"]);
  });

  it("extracts DOI with slash inside the suffix (spec example 2)", () => {
    // Per the DOI spec the suffix may contain a solidus: 10.NNNN/registrant/remainder
    const dois = extractDOIsFromText("10.6338/JDA.202212/SP_17(4).0000");
    expect(dois).toEqual(["10.6338/jda.202212/sp_17(4).0000"]);
  });

  it("does not over-capture URL routing segments after a slash-in-suffix DOI", () => {
    // The routing word 'abstract' is not part of the DOI suffix.
    const dois = extractDOIsFromText("10.6338/JDA.202212/SP_17(4).0000/abstract");
    expect(dois).toEqual(["10.6338/jda.202212/sp_17(4).0000"]);
  });

  it("extracts DOI with Unicode characters in the suffix (spec example 3)", () => {
    const dois = extractDOIsFromText("10.26321/Á.GUTIÉRREZ.ZARZA.02.2018.03");
    expect(dois).toEqual(["10.26321/á.gutiérrez.zarza.02.2018.03"]);
  });
});

// Reference-section detection covers two recurring failure modes seen on
// Wiley:
//   1. Singular tokens (`citation`, `reference`, `footnote`) are used as
//      wrappers for non-list UI (e.g. the whole article body lives in
//      `<div class="citation">`); matching them mis-classifies body content.
//   2. The class `rlist` is Wiley's generic <ul> reset, used everywhere
//      (skip-links, search nav, footer, recommended sidebar) — matching it
//      pulls in dozens of non-references.
// Plural / list-only tokens, the BEM `cited-by[__suffix]` family, and the
// `cited-by` id stay matched.
describe("findReferenceContainers", () => {
  it("does not match Wiley's `<div class=\"citation\">` article wrapper (singular token)", () => {
    const html = `<!DOCTYPE html>
      <html><body>
        <div class="citation">
          <p>Article body paragraph one with 10.1111/aaa.0001.</p>
          <p>Article body paragraph two with 10.1111/bbb.0002.</p>
        </div>
      </body></html>`;
    const doc = new JSDOM(html).window.document;
    expect(findReferenceContainers(doc)).toHaveLength(0);
  });

  it("does not match `rlist` alone (Wiley's generic <ul> reset class)", () => {
    const html = `<!DOCTYPE html>
      <html><body>
        <ul class="rlist"><li>Skip to content</li><li>Skip to info</li></ul>
        <ul class="rlist tab__content"><li>Search</li><li>Browse</li></ul>
        <ul class="rlist lot"><li>Recommended A</li><li>Recommended B</li></ul>
      </body></html>`;
    const doc = new JSDOM(html).window.document;
    expect(findReferenceContainers(doc)).toHaveLength(0);
  });

  it("matches `cited-by` id and class (Wiley's citing-literature section)", () => {
    const html = `<!DOCTYPE html>
      <html><body>
        <section id="cited-by" class="article-section cited-by">
          <ul><li>Entry 1</li><li>Entry 2</li></ul>
        </section>
      </body></html>`;
    const doc = new JSDOM(html).window.document;
    const containers = findReferenceContainers(doc);
    expect(containers).toHaveLength(1);
    expect((containers[0] as HTMLElement).id).toBe("cited-by");
  });

  it("matches BEM `cited-by__list` suffix token", () => {
    const html = `<!DOCTYPE html>
      <html><body>
        <ul class="rlist cited-by__list">
          <li>Entry 1</li><li>Entry 2</li>
        </ul>
      </body></html>`;
    const doc = new JSDOM(html).window.document;
    const containers = findReferenceContainers(doc);
    expect(containers).toHaveLength(1);
    expect((containers[0] as HTMLElement).tagName).toBe("UL");
  });

  it("still matches traditional `references` / `bibliography` containers", () => {
    const html = `<!DOCTYPE html>
      <html><body>
        <ol class="references"><li>Ref A</li><li>Ref B</li></ol>
        <ul id="bibliography"><li>Bib A</li><li>Bib B</li></ul>
      </body></html>`;
    const doc = new JSDOM(html).window.document;
    expect(findReferenceContainers(doc)).toHaveLength(2);
  });
});

describe("findReferenceEntries", () => {
  it("prefers DOI written in entry text over a link href", () => {
    // Wiley cited-by rows write the citing paper's DOI in plain text but
    // their single link is a redirect URL containing the *host* article's
    // DOI as a query param. Text-first extraction is what avoids resolving
    // every row to the host paper.
    const html = `<!DOCTYPE html>
      <html><body>
        <section id="cited-by">
          <ul>
            <li class="citedByEntry">
              <span>Author A, Title, Journal, 10.1111/aaa.0001, (2025).</span>
              <a href="https://example.com/action?doi=10.9999/host.doi&doiOfLink=10.1111/aaa.0001">View</a>
            </li>
            <li class="citedByEntry">
              <span>Author B, Title, Journal, 10.2222/bbb.0002, (2024).</span>
              <a href="https://example.com/action?doi=10.9999/host.doi&doiOfLink=10.2222/bbb.0002">View</a>
            </li>
          </ul>
        </section>
      </body></html>`;
    const doc = new JSDOM(html).window.document;
    const entries = findReferenceEntries(doc);
    expect(entries).toHaveLength(2);
    expect(entries[0].doi).toBe("10.1111/aaa.0001");
    expect(entries[1].doi).toBe("10.2222/bbb.0002");
  });

  it("skips host-article DOI in link fallback so navigation stubs resolve to null", () => {
    // Entry has no DOI in visible text and its only link is a Wiley
    // redirect whose `doi=` query param is the host article — without the
    // host-DOI guard, this would mis-resolve to the page's own DOI and
    // surface a stray pill.
    const html = `<!DOCTYPE html>
      <html>
        <head><meta name="citation_doi" content="10.9999/host.doi"></head>
        <body>
          <section id="cited-by">
            <ul>
              <li class="citedByEntry">
                <span>Long enough non-citation header text for the length gate</span>
                <a href="https://example.com/action?doi=10.9999/host.doi">More</a>
              </li>
              <li class="citedByEntry">
                <span>Another non-citation stub long enough to pass min length</span>
                <a href="https://example.com/action?doi=10.9999/host.doi">More</a>
              </li>
            </ul>
          </section>
        </body>
      </html>`;
    const doc = new JSDOM(html).window.document;
    const entries = findReferenceEntries(doc);
    expect(entries).toHaveLength(2);
    expect(entries[0].doi).toBeNull();
    expect(entries[1].doi).toBeNull();
  });

  it("falls back to a non-host link DOI when entry text has no DOI", () => {
    // This is the legitimate hidden-DOI case (Crossref-style button URL).
    // Link fallback should fire when text yields nothing AND the link's DOI
    // is not the host's.
    const html = `<!DOCTYPE html>
      <html>
        <head><meta name="citation_doi" content="10.9999/host.doi"></head>
        <body>
          <ol class="references">
            <li>
              Smith J. Title. Journal. 2020.
              <a href="https://www.crossref.org/openurl?doi=10.1234/found.via.button">Crossref</a>
            </li>
            <li>
              Jones K. Another. 2021.
              <a href="https://www.crossref.org/openurl?doi=10.5678/also.found">Crossref</a>
            </li>
          </ol>
        </body>
      </html>`;
    const doc = new JSDOM(html).window.document;
    const entries = findReferenceEntries(doc);
    expect(entries).toHaveLength(2);
    expect(entries[0].doi).toBe("10.1234/found.via.button");
    expect(entries[1].doi).toBe("10.5678/also.found");
    // DOI came from the link href, not visible text — flagged so the pill
    // surfaces even when "show on all references" is off.
    expect(entries[0].doiInText).toBe(false);
    expect(entries[1].doiInText).toBe(false);
  });

  it("flags a DOI written in entry text as in-text", () => {
    const html = `<!DOCTYPE html>
      <html><body>
        <ol class="references">
          <li>Smith J. Title. Journal. 2020. https://doi.org/10.1234/in.the.text</li>
          <li>Jones K. Another. 2021. doi:10.5678/also.text</li>
        </ol>
      </body></html>`;
    const doc = new JSDOM(html).window.document;
    const entries = findReferenceEntries(doc);
    expect(entries).toHaveLength(2);
    expect(entries[0].doiInText).toBe(true);
    expect(entries[1].doiInText).toBe(true);
  });

  it("treats a Frontiers-style entry with a nested action-link <li> list as one entry", () => {
    // Frontiers wraps each reference in a <li class="References__item"> whose
    // <div class="References__content"> holds the citation plus a nested
    // <ul class="References__links"><li> per action button (Pubmed | CrossRef
    // | Google Scholar | View in article). Without outermost-<li> selection,
    // those four button <li>s get mistaken for four separate entries and the
    // real per-reference <li> is dropped.
    const html = `<!DOCTYPE html>
      <html><body>
        <ul class="References">
          <li class="References__item" id="ref1">
            <div class="References__label"><p>1</p></div>
            <div class="References__content">
              <p>Achenbach T. M. (2016). Internalizing/externalizing problems. J. Am. Acad. Child Adolesc. Psychiatry 55, 647-656. doi: 10.1016/j.jaac.2016.05.012</p>
              <ul class="References__links">
                <li class="References__links__item"><a href="https://pubmed.ncbi.nlm.nih.gov/27453078">Pubmed Abstract</a></li>
                <li class="References__links__item"><a href="https://doi.org/10.1016/j.jaac.2016.05.012">CrossRef</a></li>
                <li class="References__links__item"><a href="http://scholar.google.com/scholar_lookup?x=1">Google Scholar</a></li>
                <li class="References__links__item References__links__item--viewInArticle"><a href="#ref1a">View reference in article</a></li>
              </ul>
            </div>
          </li>
          <li class="References__item" id="ref2">
            <div class="References__label"><p>2</p></div>
            <div class="References__content">
              <p>Jones K. (2021). Another paper. J. Other 3, 1-2. doi: 10.5678/also.found</p>
              <ul class="References__links">
                <li class="References__links__item"><a href="https://pubmed.ncbi.nlm.nih.gov/1">Pubmed Abstract</a></li>
                <li class="References__links__item References__links__item--viewInArticle"><a href="#ref2a">View reference in article</a></li>
              </ul>
            </div>
          </li>
        </ul>
      </body></html>`;
    const doc = new JSDOM(html).window.document;
    const entries = findReferenceEntries(doc);
    expect(entries).toHaveLength(2);
    expect(entries[0].element.className).toBe("References__item");
    expect(entries[1].element.className).toBe("References__item");
    expect(entries[0].doi).toBe("10.1016/j.jaac.2016.05.012");
    expect(entries[1].doi).toBe("10.5678/also.found");
    // The site adapter targets ".References__content" as a descendant of the
    // entry root — confirm that still holds with outermost selection.
    expect(entries[0].element.querySelector(".References__content")).not.toBeNull();
  });

  it("picks the larger per-reference <div> group over a smaller stray <p> group (Oxford Academic)", () => {
    // academic.oup.com has no <li> at all: each reference is a
    // <div class="js-splitview-ref-item"> and all of them share one parent
    // (a large div-sibling group). But one reference's link row renders three
    // separate <p class="citation-links-compatibility"> buttons (Google
    // Scholar / Google Preview / WorldCat) that also share a parent — a
    // *smaller* p-sibling group. The old first-match-wins cascade picked that
    // 3-element p-group over the real (larger) div-group, because it checked
    // <p> before <div> and stopped at the first group of size >= 2. Needs
    // more than 3 real entries here so the div-group's size genuinely beats
    // the stray p-group's, matching what happens on the real page (55 vs 3).
    const refItem = (n: number, doi: string, links = "") => `
          <div class="js-splitview-ref-item">
            <div class="ref-content">
              <div class="mixed-citation citation">
                Author ${n}. Title ${n}. Journal. 202${n}.
                ${links}
                <div class="crossref-doi"><a href="http://dx.doi.org/${doi}">Crossref</a></div>
              </div>
            </div>
          </div>`;
    const html = `<!DOCTYPE html>
      <html><body>
        <div class="ref-list js-splitview-ref-list">
          ${refItem(
            1,
            "10.1176/found.one",
            `<div class="citation-links">
                  <p class="citation-links-compatibility"><a href="https://scholar.google.com/x">Google Scholar</a></p>
                  <p class="citation-links-compatibility"><a href="https://books.google.com/x">Google Preview</a></p>
                  <p class="citation-links-compatibility"><a href="https://worldcat.org/x">WorldCat</a></p>
                </div>`
          )}
          ${refItem(2, "10.1176/found.two")}
          ${refItem(3, "10.1176/found.three")}
          ${refItem(4, "10.1176/found.four")}
        </div>
      </body></html>`;
    const doc = new JSDOM(html).window.document;
    const entries = findReferenceEntries(doc);
    expect(entries).toHaveLength(4);
    for (const entry of entries) {
      expect(entry.element.className).toBe("js-splitview-ref-item");
    }
    expect(entries.map((e) => e.doi)).toEqual([
      "10.1176/found.one",
      "10.1176/found.two",
      "10.1176/found.three",
      "10.1176/found.four",
    ]);
  });
});

describe("extractDoiOccurrences — FLoRA's own injected UI", () => {
  // Every pill FLoRA injects renders the DOI as plain text and links it to
  // doi.org inside its popover. Re-scanning that turns our own output into a
  // page occurrence, which gets pilled again on the next mutation pass.
  const pageHtml = `<!DOCTYPE html>
    <html><body>
      <p>Real prose citation: 10.1111/real.one</p>
      <span class="flora-indicator-pill" data-flora-ui="" data-flora-doi="10.2222/injected">
        <span>DOI</span>
        <div style="display:none">
          <span>10.2222/injected</span>
          <a href="https://doi.org/10.2222/injected">open</a>
        </div>
      </span>
    </body></html>`;

  it("ignores DOI text inside an injected pill", () => {
    const doc = new JSDOM(pageHtml).window.document;
    const dois = extractDoiOccurrences(doc).map((o) => o.doi);
    expect(dois).toContain("10.1111/real.one");
    expect(dois).not.toContain("10.2222/injected");
  });

  it("ignores the pill's own doi.org link", () => {
    const doc = new JSDOM(pageHtml).window.document;
    const fromLinks = extractDoiOccurrences(doc)
      .filter((o) => o.kind !== "text")
      .map((o) => o.doi);
    expect(fromLinks).not.toContain("10.2222/injected");
  });

  it("still extracts a genuine page DOI that sits next to a pill", () => {
    const doc = new JSDOM(`<!DOCTYPE html>
      <html><body>
        <p>
          <a href="https://doi.org/10.3333/genuine">10.3333/genuine</a>
          <span data-flora-ui=""><span>10.2222/injected</span></span>
        </p>
      </body></html>`).window.document;
    const dois = extractDoiOccurrences(doc).map((o) => o.doi);
    expect(dois).toContain("10.3333/genuine");
    expect(dois).not.toContain("10.2222/injected");
  });
});
