import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { couldNodeIntroduceDoi, scanFingerprint, DOI_HINT_RE } from "../../src/content-general/scan-gate";
import { extractDoiOccurrences } from "../../src/shared/doi-extractor";

function docFrom(html: string): Document {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window.document;
}

// Build a detached node the way a mutation observer would hand it to us.
function nodeFrom(html: string): ChildNode {
  const doc = docFrom(html);
  return doc.body.firstChild as ChildNode;
}

describe("couldNodeIntroduceDoi — the relevance pre-gate probe", () => {
  it("is true for a text node containing a DOI", () => {
    const t = docFrom("").createTextNode("see 10.1038/nature12373 for details");
    expect(couldNodeIntroduceDoi(t)).toBe(true);
  });

  it("is true for an element with a DOI in visible text", () => {
    expect(couldNodeIntroduceDoi(nodeFrom("<p>doi:10.1371/journal.pone.0012345</p>"))).toBe(true);
  });

  it("is true for an element whose DOI is only in an href (no visible DOI text)", () => {
    // A reference link whose text is truncated but href carries the DOI — the
    // probe must see it via outerHTML or the DOI would escape detection.
    expect(
      couldNodeIntroduceDoi(nodeFrom('<a href="https://doi.org/10.1002/jaba.70048">read more</a>')),
    ).toBe(true);
  });

  it("is true for a DOI embedded in a publisher landing-page URL", () => {
    expect(
      couldNodeIntroduceDoi(nodeFrom('<a href="https://example.com/doi/10.1016/j.cell.2020.01.001/full">link</a>')),
    ).toBe(true);
  });

  it("is true for a DOI split by a zero-width character in the registrant", () => {
    // Some sites inject zero-width break chars mid-token; the probe strips them.
    const zwsp = "\u200B";
    expect(couldNodeIntroduceDoi(nodeFrom(`<span>10.${zwsp}1038/nature12373</span>`))).toBe(true);
  });

  it("is false for ordinary content with no DOI", () => {
    expect(couldNodeIntroduceDoi(nodeFrom("<div><p>Inbox (42)</p><p>Meeting at 9am</p></div>"))).toBe(false);
  });

  it("is false for short decimals that are not DOI registrants ($10.50, v10.2)", () => {
    // Requires 4+ digits after "10." — a real registrant — so prices/versions
    // do not trigger a full scan.
    expect(couldNodeIntroduceDoi(nodeFrom("<p>Total: $10.50 for version 10.2</p>"))).toBe(false);
  });

  it("is false for comment nodes", () => {
    const c = docFrom("").createComment("10.1038/nature12373");
    expect(couldNodeIntroduceDoi(c)).toBe(false);
  });
});

describe("gate invariant — a page that becomes relevant later IS detected", () => {
  it("flips from irrelevant to relevant when a DOI-bearing node is added", () => {
    // Simulate the observer's per-node decision: a busy, DOI-free page, then a
    // late mutation that injects an article reference carrying a DOI.
    const irrelevant = nodeFrom("<div class='email'><p>Re: lunch</p><p>Sounds good!</p></div>");
    expect(couldNodeIntroduceDoi(irrelevant)).toBe(false);

    const relevantLater = nodeFrom(
      "<li class='ref'>Smith et al. (2020). A study. <a href='https://doi.org/10.1234/abcd'>DOI</a></li>",
    );
    // The pre-gate would NOT bail on this mutation → the full pipeline runs and
    // the DOI is detected. This is the "content loads late" correctness case.
    expect(couldNodeIntroduceDoi(relevantLater)).toBe(true);
  });

  it("gate + pipeline: a DOI added by mutation passes the gate AND is extracted", () => {
    // Full invariant, end to end at the unit level: start with an irrelevant
    // page (fingerprint recorded, no DOIs), mutate in a DOI-bearing node, and
    // check every layer agrees the page must now be (re)scanned and the DOI is
    // actually found by the shared-scan pipeline.
    const doc = docFrom("<div id='feed'><p>Just chatter, nothing scholarly.</p></div>");
    const fpBefore = scanFingerprint(doc);
    expect(extractDoiOccurrences(doc)).toHaveLength(0);

    const added = doc.createElement("p");
    added.innerHTML = "New citation: <a href='https://doi.org/10.1038/nature12373'>10.1038/nature12373</a>";
    doc.getElementById("feed")!.appendChild(added);

    // 1. The observer's probe flags the added node → pre-gate does NOT bail.
    expect(couldNodeIntroduceDoi(added)).toBe(true);
    // 2. The fingerprint changed → the memo does NOT skip the pass.
    expect(scanFingerprint(doc)).not.toBe(fpBefore);
    // 3. The single-scan pipeline finds the DOI on the mutated page.
    const occs = extractDoiOccurrences(doc);
    expect(occs.map((o) => o.doi)).toContain("10.1038/nature12373");
  });

  it("DOI_HINT_RE matches every serialised DOI form it is meant to gate on", () => {
    for (const s of [
      "10.1038/nature12373",
      "https://doi.org/10.1002/jaba.70048",
      "doi:10.1371/journal.pone.0012345",
      "?identifierValue=10.1016/j.cell.2020.01.001",
    ]) {
      expect(DOI_HINT_RE.test(s)).toBe(true);
    }
  });
});

describe("scanFingerprint — skip-unchanged memoization", () => {
  it("is stable when the page is unchanged", () => {
    const doc = docFrom("<article><h1>Title</h1><p>Body with 10.1000/xyz</p></article>");
    expect(scanFingerprint(doc)).toBe(scanFingerprint(doc));
  });

  it("changes when body text changes (same length, different chars)", () => {
    const a = docFrom("<p>hello world AAAA</p>");
    const b = docFrom("<p>hello world BBBB</p>");
    expect(scanFingerprint(a)).not.toBe(scanFingerprint(b));
  });

  it("changes when text length changes", () => {
    const a = docFrom("<p>short</p>");
    const b = docFrom("<p>a much longer paragraph of text</p>");
    expect(scanFingerprint(a)).not.toBe(scanFingerprint(b));
  });

  it("changes when a FLoRA badge is wiped even though light-DOM text is identical", () => {
    // A SPA re-render can remove a placed badge (a shadow-DOM host with no
    // light-DOM text) while leaving the article text byte-identical. Folding the
    // placed-UI count into the fingerprint ensures such a pass is NOT skipped,
    // so the badge gets restored.
    const doc = docFrom("<article><p>Body with 10.1000/xyz</p></article>");
    const before = scanFingerprint(doc);
    const badge = doc.createElement("span");
    badge.className = "flora-inline-badge";
    doc.querySelector("article")!.appendChild(badge);
    const withBadge = scanFingerprint(doc);
    expect(withBadge).not.toBe(before);
    // Wiping the badge (identical light-DOM text) returns to the pre-badge count,
    // which differs from the with-badge fingerprint → the restoring pass runs.
    badge.remove();
    expect(scanFingerprint(doc)).toBe(before);
    expect(scanFingerprint(doc)).not.toBe(withBadge);
  });
});
