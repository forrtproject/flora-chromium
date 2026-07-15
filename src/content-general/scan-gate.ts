// Cheap per-mutation gating for the general content script's render handler.
//
// The general content script runs on <all_urls> and its full extraction
// pipeline is expensive. These pure helpers let the handler decide, without
// touching the whole DOM, whether a mutation pass is worth a full scan:
//
//  - `couldNodeIntroduceDoi` — a sound, cheap probe over a freshly-added node:
//    could it have brought a DOI onto the page? Used by the relevance pre-gate.
//  - `scanFingerprint` — a cheap fingerprint of the scanned page state, used to
//    skip a pass whose inputs are unchanged since the last one.

// Word-break characters some sites inject *inside* tokens (a DOI wrapped across
// a line). Stripped before probing so "10.​1234…" still matches.
const WORD_BREAK = /[\u200B\u200C\u200D\u00AD\u2060]/g;

// "10." + 4+ digits is the registrant prefix that begins every serialised DOI,
// whether it appears in visible text, an href, or a meta value. It is therefore
// a *necessary* substring of any DOI occurrence, while having far fewer false
// positives than a bare "doi" search. That makes it a sound relevance probe:
// if a DOI was added, this matches; if this does not match, no DOI was added.
export const DOI_HINT_RE = /10\.\d{4}/;

/**
 * Could this freshly-added node have introduced a DOI anywhere within it?
 *
 * Sound (never a false negative for a real DOI): for element nodes it tests the
 * subtree's `outerHTML`, which contains all descendant text, href attributes,
 * and meta `content` values — every place a DOI can be serialised. The cost is
 * bounded by the size of what was added, never the whole page.
 */
export function couldNodeIntroduceDoi(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return DOI_HINT_RE.test((node.nodeValue ?? "").replace(WORD_BREAK, ""));
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return DOI_HINT_RE.test((node as Element).outerHTML.replace(WORD_BREAK, ""));
}

/**
 * Cheap fingerprint of the page's scanned state.
 *
 * `body.textContent` does NOT force a layout reflow (unlike `innerText`), so
 * this is cheap relative to the full pipeline it guards. The placed-UI count is
 * folded in so that a mutation which merely wipes a FLoRA badge — leaving the
 * light-DOM text unchanged — still changes the fingerprint and triggers a
 * restoring pass instead of being memo-skipped.
 */
export function scanFingerprint(doc: Document = document): string {
  const text = doc.body?.textContent ?? "";
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) | 0;
  }
  const floraCount = doc.querySelectorAll(
    ".flora-inline-badge,.flora-doi-label,.flora-notice-pill",
  ).length;
  return `${text.length}:${h}:${floraCount}`;
}
