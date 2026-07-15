import type { DoiString, ClassifiedDois, PageType } from "./types";
import { normaliseDOI } from "./doi-normalise";
import { debugLog } from "./debug";

// Allow parens and semicolons inside DOIs (e.g. 10.1016/S0924-9338(98)80023-0,
// 10.1002/(sici)...3.0.co;2-g). DOI suffixes may contain slashes per the spec
// (e.g. 10.6338/JDA.202212/SP_17(4).0000), but we stop before URL routing
// segments (e.g. /full, /abstract) that journals append after the DOI. A slash
// is considered a routing separator — not part of the suffix — when the next
// segment is purely [A-Za-z-] (English word/hyphen), which covers all known
// journal routing words while leaving structured suffix segments (containing
// digits, underscores, or brackets) intact.
const SUFFIX_CHARS = `[^\\s,/\\]}>'"<#?&\\\\]`;
const EXTRA_SLASH = `(?:\\/(?![a-zA-Z-]+(?:[/\\s,#?&<>{}\\[\\]]|$))${SUFFIX_CHARS}+)*`;
const DOI_REGEX = new RegExp(`(10\\.\\d{4,}(?:\\.\\d+)*\\/${SUFFIX_CHARS}+${EXTRA_SLASH})`, "g");

// For rendered body text only (textContent/innerText) — such text contains no
// HTML tags, so < and > appear as literal characters (e.g. SICI DOIs decoded
// from &lt; / &gt; HTML entities). We allow them here so that DOIs like
// 10.1002/(SICI)...18:4<303::AID-SMJ869>3.0.CO;2-G are not truncated at '<'.
const TEXT_SUFFIX_CHARS = `[^\\s,/\\]'"#?&\\\\]`;
const TEXT_EXTRA_SLASH = `(?:\\/(?![a-zA-Z-]+(?:[/\\s,#?&<>{}\\[\\]]|$))${TEXT_SUFFIX_CHARS}+)*`;
export const DOI_TEXT_REGEX = new RegExp(`(10\\.\\d{4,}(?:\\.\\d+)*\\/${TEXT_SUFFIX_CHARS}+${TEXT_EXTRA_SLASH})`, "g");

// Zero-width characters sites insert *inside* DOIs for line-breaking \u2014 stripped
// so a wrapped DOI rejoins into one token. U+FEFF is deliberately NOT included:
// publishers (e.g. JAMA) use it as a *separator* between a DOI and the
// following link text ("PubMed", "Crossref", \u2026) with no real whitespace.
// Stripping it glues them ("\u20269491-zPubMedGoogle"); leaving it in lets the DOI
// regex stop cleanly at it, since JavaScript's \s already matches U+FEFF.
const WORD_BREAK_CHARS = /[\u200B\u200C\u200D\u00AD\u2060]/g;

// Encoded DOI pattern: 10.NNNN%2F... (percent-encoded slash)
const ENCODED_DOI_REGEX = /(10\.\d{4,}(?:\.\d+)*%2[fF][^\s,/\]}>'"<#?&\\]+)/g;

/**
 * Decode any percent-encoded DOIs in text so the main DOI_REGEX can find them.
 * Only decodes sequences that look like encoded DOIs (10.XXXX%2F...).
 */
function decodeEncodedDois(text: string): string {
  return text.replace(ENCODED_DOI_REGEX, (match) => {
    try {
      return decodeURIComponent(match);
    } catch {
      return match;
    }
  });
}

/**
 * Reject DOI fragments where the suffix (after registrant/) is too short.
 * Real DOI suffixes are almost never a single character — fragments like
 * "10.1016/j" or "10.1007/s" come from HTML splitting a DOI across elements.
 */
function isValidDoiSuffix(doi: string): boolean {
  const slashIdx = doi.indexOf("/");
  if (slashIdx === -1) return false;
  const suffix = doi.slice(slashIdx + 1);
  return suffix.length >= 2;
}

function cleanDoiTrailing(raw: string): string {
  // Strip trailing punctuation
  let cleaned = raw.replace(/[.,;:]+$/, "");
  // Strip unbalanced trailing parentheses:
  // If there are more ')' than '(' the extras are sentence punctuation, not part of the DOI
  let opens = 0;
  let lastBalanced = cleaned.length;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "(") opens++;
    else if (cleaned[i] === ")") {
      if (opens > 0) {
        opens--;
      } else {
        // Unbalanced ')' — DOI ends before this
        lastBalanced = i;
        break;
      }
    }
  }
  cleaned = cleaned.slice(0, lastBalanced);
  // Strip trailing punctuation again after paren trimming
  cleaned = cleaned.replace(/[.,;:]+$/, "");
  // Strip trailing balanced parenthetical groups appended as annotations
  // (e.g. "...3.0.co;2-g(matched)" → "...3.0.co;2-g"). Uses a loop because
  // removing one group can expose another that should also be stripped.
  let prev: string;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(/\([^()]*\)$/, "").replace(/[.,;:]+$/, "");
  } while (cleaned !== prev);
  return cleaned;
}

/**
 * True when `el` (or any ancestor) is a place where injecting FLoRA's
 * pill/badge markup would corrupt user data — i.e. content the user can edit
 * and whose serialized HTML gets saved. If a DOI is typed or pasted into a
 * rich-text editor (Notion, a CMS, webmail compose, a wiki) and we inject a
 * span next to it, that span is serialized into the user's saved document.
 *
 * Editable contexts detected:
 *  - `contenteditable` regions — via `isContentEditable`, which resolves
 *    inheritance correctly (a `contenteditable="false"` island inside an
 *    editable region reports `false`, unlike a bare `closest("[contenteditable]")`).
 *  - form fields: TEXTAREA / INPUT / SELECT, or any element inside one.
 *  - `document.designMode === "on"` — the whole document is editable.
 */
export function isEditableContext(el: Element | null): boolean {
  if (!el) return false;

  const doc = el.ownerDocument;
  if (doc && doc.designMode === "on") return true;

  // Primary: isContentEditable resolves contenteditable inheritance (including
  // the "false" re-disable case) in real browsers. Only HTMLElements expose it.
  if (typeof (el as HTMLElement).isContentEditable === "boolean") {
    if ((el as HTMLElement).isContentEditable) return true;
  } else {
    // Fallback for environments without live isContentEditable (e.g. jsdom):
    // walk to the nearest ancestor that sets contenteditable and honour its
    // value — contenteditable="false" re-disables an editable region.
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
      const attr = cur.getAttribute("contenteditable");
      if (attr === null) continue;
      const v = attr.toLowerCase();
      if (v === "false") break;
      if (v === "" || v === "true" || v === "plaintext-only") return true;
      // "inherit" or other values: keep looking up.
    }
  }

  // Form fields — TEXTAREA / INPUT / SELECT, or any element inside one.
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const tag = cur.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return true;
  }

  return false;
}

/**
 * Pull a DOI out of an anchor href. Tries (in order):
 *  1. doi.org / dx.doi.org / doi: prefix → {@link normaliseDOI}
 *  2. DOI passed in a query parameter (?doi=…, ?identifierName=doi&identifierValue=…)
 *  3. DOI embedded anywhere in the (decoded) URL path, e.g. /doi/10.xxx/yyy
 *
 * Many reference-list links are publisher landing pages whose URL contains the
 * DOI even though it's not a doi.org URL — this catches those.
 */
export function extractDoiFromHref(href: string): DoiString | null {
  if (!href) return null;

  // 1. Direct DOI URL
  const direct = normaliseDOI(href);
  if (direct) return direct;

  // 2. DOI in a query parameter
  try {
    const url = new URL(href);
    const params = url.searchParams;
    for (const key of params.keys()) {
      if (key.toLowerCase() === "doi") {
        const fromParam = normaliseDOI(params.get(key) ?? "");
        if (fromParam) return fromParam;
      }
    }
    const idName = (params.get("identifierName") ?? params.get("identifier_name") ?? "").toLowerCase();
    if (idName === "doi") {
      const val = params.get("identifierValue") ?? params.get("identifier_value") ?? "";
      const fromIdParam = normaliseDOI(val);
      if (fromIdParam) return fromIdParam;
    }
  } catch {
    // invalid URL — fall through to path-embedded match
  }

  // 3. DOI embedded anywhere in the URL (decoded)
  try {
    const decoded = decodeURIComponent(href);
    const m = decoded.match(/\b(10\.\d{4,}(?:\.\d+)*\/[^\s&"'#?]+)/);
    if (m) {
      const cleaned = cleanDoiTrailing(m[1]);
      if (isValidDoiSuffix(cleaned)) {
        const fromPath = normaliseDOI(cleaned);
        if (fromPath) return fromPath;
      }
    }
  } catch {
    // invalid percent-encoding — give up
  }

  return null;
}

/**
 * Extract DOIs from a document using a multi-layer approach:
 * 1. Page URL (catches DOIs in journal URLs like sagepub.com/doi/abs/10.xxx)
 * 2. <meta> tags (citation_doi, DC.identifier, etc.)
 * 3. JSON-LD structured data
 * 4. DOI resolver links (doi.org / dx.doi.org hrefs with truncated visible text)
 * 5. Regex over visible body text only
 */
export function extractDOIs(doc: Document): DoiString[] {
  const found = new Set<DoiString>();

  const sizeBefore = (layer: string) => {
    const s = found.size;
    return () => {
      if (found.size > s) debugLog(`Extractor: ${layer} added ${found.size - s} DOI(s)`);
    };
  };

  let after = sizeBefore("URL");
  extractFromUrl(doc, found);
  after();

  after = sizeBefore("meta");
  extractFromMeta(doc, found);
  after();

  after = sizeBefore("JSON-LD");
  extractFromJsonLd(doc, found);
  after();

  after = sizeBefore("DOI links");
  extractFromDoiLinks(doc, found);
  after();

  after = sizeBefore("visible text");
  extractFromVisibleText(doc, found);
  after();

  // On Google Sheets, cell content is rendered on canvas — scan innerHTML for DOIs
  if (isGoogleSheets(doc) && doc.body) {
    after = sizeBefore("Sheets innerHTML");
    const html = doc.body.innerHTML;
    const cleaned = decodeEncodedDois(html.replace(WORD_BREAK_CHARS, ""));
    for (const match of cleaned.matchAll(DOI_REGEX)) {
      const raw = cleanDoiTrailing(match[1]);
      if (!isValidDoiSuffix(raw)) continue;
      const doi = normaliseDOI(raw);
      if (doi) found.add(doi);
    }
    after();
  }

  const result = [...found];
  debugLog(`Extractor: ${result.length} unique DOI(s) found`, result);
  return result;
}

function extractFromUrl(doc: Document, found: Set<DoiString>): void {
  const url = decodeEncodedDois(doc.location?.href ?? "");
  const matches = url.matchAll(DOI_REGEX);
  for (const match of matches) {
    const cleaned = cleanDoiTrailing(match[1]);
    if (!isValidDoiSuffix(cleaned)) continue;
    const doi = normaliseDOI(cleaned);
    if (doi) found.add(doi);
  }
}

function extractFromMeta(doc: Document, found: Set<DoiString>): void {
  const selectors = [
    'meta[name="citation_doi"]',
    'meta[name="DC.identifier"]',
    'meta[name="dc.identifier"]',
    'meta[name="DOI"]',
    'meta[property="citation_doi"]',
  ];

  for (const selector of selectors) {
    const el = doc.querySelector<HTMLMetaElement>(selector);
    if (el?.content) {
      const doi = normaliseDOI(el.content);
      if (doi) found.add(doi);
    }
  }
}

function extractFromJsonLd(doc: Document, found: Set<DoiString>): void {
  const scripts = doc.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]'
  );

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent ?? "");
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        if (typeof item?.["@id"] === "string") {
          const doi = normaliseDOI(item["@id"]);
          if (doi) found.add(doi);
        }
        if (typeof item?.doi === "string") {
          const doi = normaliseDOI(item.doi);
          if (doi) found.add(doi);
        }
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  }
}

function extractFromDoiLinks(doc: Document, found: Set<DoiString>): void {
  const links = doc.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const link of links) {
    const href = link.href;
    if (!href) continue;
    const doi = normaliseDOI(href);
    if (doi) found.add(doi);
  }
}

/** Where a DOI was found on the page — drives where UI is anchored. */
export type DoiOccurrenceKind =
  | "link-text"      // DOI appears in the link's visible text
  | "link-doi-org"   // <a href="https://doi.org/…">
  | "link-embedded"  // DOI embedded in a non-doi.org URL (e.g. Crossref button)
  | "text";          // DOI in plain prose text

export interface DoiOccurrence {
  doi: DoiString;
  /** The element the DOI literally appears in (link or text-containing element). */
  source: HTMLElement;
  /**
   * The element to anchor inline UI to. For DOIs inside a reference entry
   * this is the entry itself (so a pill/badge doesn't end up next to a tiny
   * "Crossref" button) — otherwise it's the source.
   */
  anchor: HTMLElement;
  kind: DoiOccurrenceKind;
}

/**
 * Unified position-aware DOI extraction. Returns every occurrence of every
 * DOI on the page with a DOM location, so renderers can place pills/badges
 * directly without re-scanning or regexing the DOM at render time.
 *
 * Picks the right anchor based on context:
 * - DOIs inside a reference entry → anchored to the entry (covers "tiny
 *   Crossref/PubMed button" links that embed a DOI in their URL).
 * - DOIs elsewhere → anchored to the link or text-containing element.
 */
export function extractDoiOccurrences(doc: Document): DoiOccurrence[] {
  const occurrences: DoiOccurrence[] = [];
  if (!doc.body) return occurrences;

  // Reference entries — used to lift the anchor up from a per-link "Crossref"
  // button to the whole citation.
  const entrySet = new Set<HTMLElement>(
    findReferenceEntries(doc).map((e) => e.element)
  );
  const pickAnchor = (el: HTMLElement): HTMLElement => {
    let cur: HTMLElement | null = el;
    while (cur) {
      if (entrySet.has(cur)) return cur;
      cur = cur.parentElement;
    }
    return el;
  };

  // 1. Links — text match wins over href; embedded URLs are last resort.
  for (const link of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    // Skip links inside editable regions — anchoring (and later injecting)
    // there would serialize FLoRA markup into the user's saved document.
    if (isEditableContext(link)) continue;
    const textDois = new Set<DoiString>();
    // textContent (not innerText) — innerText forces a synchronous layout
    // reflow; a link's text has no block-boundary whitespace concerns, so
    // textContent yields the same DOI tokens without the reflow cost.
    const linkText = link.textContent || "";
    const cleaned = decodeEncodedDois(linkText.replace(WORD_BREAK_CHARS, ""));
    for (const match of cleaned.matchAll(DOI_TEXT_REGEX)) {
      const raw = cleanDoiTrailing(match[1]);
      if (!isValidDoiSuffix(raw)) continue;
      const doi = normaliseDOI(raw);
      if (doi) textDois.add(doi);
    }
    for (const doi of textDois) {
      occurrences.push({ doi, source: link, anchor: pickAnchor(link), kind: "link-text" });
    }

    const direct = normaliseDOI(link.href);
    if (direct && !textDois.has(direct)) {
      occurrences.push({ doi: direct, source: link, anchor: pickAnchor(link), kind: "link-doi-org" });
    } else if (!direct) {
      const embedded = extractDoiFromHref(link.href);
      if (embedded && !textDois.has(embedded)) {
        occurrences.push({ doi: embedded, source: link, anchor: pickAnchor(link), kind: "link-embedded" });
      }
    }
  }

  // 2. Plain prose text — DOIs not inside any link.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") {
        return NodeFilter.FILTER_REJECT;
      }
      // Editable content (contenteditable, form fields, designMode) — anchoring
      // here would let injected markup be serialized into the user's document.
      if (isEditableContext(parent)) return NodeFilter.FILTER_REJECT;
      // Anchor descendants are covered by the link pass above.
      if (parent.closest("a")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const raw = (node as Text).data;
    if (!raw || raw.length < 12) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const cleaned = decodeEncodedDois(raw.replace(WORD_BREAK_CHARS, ""));
    const seen = new Set<DoiString>();
    for (const match of cleaned.matchAll(DOI_TEXT_REGEX)) {
      const trimmed = cleanDoiTrailing(match[1]);
      if (!isValidDoiSuffix(trimmed)) continue;
      const doi = normaliseDOI(trimmed);
      if (!doi || seen.has(doi)) continue;
      seen.add(doi);
      occurrences.push({ doi, source: parent, anchor: pickAnchor(parent), kind: "text" });
    }
  }

  return occurrences;
}

function extractFromVisibleText(doc: Document, found: Set<DoiString>): void {
  // textContent, NOT innerText: innerText forces a full synchronous layout
  // reflow of the whole page (the headline per-mutation cost). textContent is
  // a superset that also includes visually-hidden text — but this set only
  // decides which DOIs to *look up*, never where UI is placed. Badge/pill
  // placement is gated by isVisible() at render time, so surfacing a hidden
  // DOI here cannot make a badge appear on hidden text.
  const rawText = doc.body?.textContent || "";
  // Strip invisible word-break characters that sites insert for overflow-wrap/break-word
  // and decode any percent-encoded DOIs
  const bodyText = decodeEncodedDois(rawText.replace(WORD_BREAK_CHARS, ""));
  const matches = bodyText.matchAll(DOI_TEXT_REGEX);
  for (const match of matches) {
    const cleaned = cleanDoiTrailing(match[1]);
    if (!isValidDoiSuffix(cleaned)) continue;
    const doi = normaliseDOI(cleaned);
    if (doi) found.add(doi);
  }
}

/**
 * Extract the primary DOI for the current page from authoritative sources only
 * (URL, meta tags, JSON-LD). Does not scan body text or DOI links, which would
 * pick up cited/referenced DOIs that are not the main article.
 */
export function extractPrimaryDOI(doc: Document): DoiString | null {
  const found = new Set<DoiString>();
  extractFromUrl(doc, found);
  extractFromMeta(doc, found);
  extractFromJsonLd(doc, found);
  return found.size > 0 ? [...found][0] : null;
}

/**
 * Extract DOIs from raw text (e.g. CSV data).
 */
export function extractDOIsFromText(text: string): DoiString[] {
  const found = new Set<DoiString>();
  const cleaned = decodeEncodedDois(text.replace(WORD_BREAK_CHARS, ""));
  for (const match of cleaned.matchAll(DOI_REGEX)) {
    const raw = cleanDoiTrailing(match[1]);
    if (!isValidDoiSuffix(raw)) continue;
    const doi = normaliseDOI(raw);
    if (doi) found.add(doi);
  }
  debugLog(`extractDOIsFromText: ${found.size} DOI(s) from ${text.length} chars`);
  return [...found];
}

// Class/id tokens that indicate a reference or bibliography section.
// Plural/list-only forms — singular tokens like `citation`, `reference`, or
// `footnote` are used by some publishers (notably Wiley's `class="citation"`
// on the whole article wrapper) for non-list "how to cite" / single-ref UI,
// which would otherwise mis-classify the entire article body as a reference
// list. `works-cited` and `reflist`/`ref-list` are kept because the compound
// form is unambiguous. `cited-by[__*]` covers Wiley's BEM-style citing-list
// section (`<section class="cited-by">` / `id="cited-by"`); we deliberately
// do not match Wiley's `rlist` class because it's a generic <ul> reset used
// for skip-links, search nav, footer, related-journals, etc.
// Word-boundary match catches BEM-style names (e.g. `c-article-references`).
// Plural-only — singular `citation`/`reference` is Wiley's article-body class.
const REFERENCE_SECTION_RE = /(?:^|[-_\s])(?:cites|citations|bibliograph(?:y|ies)|references|reflist|ref-list|works-cited|footnotes|cited-by)(?:$|[-_\s])/i;

function isReferenceContainer(el: Element): boolean {
  const cls = typeof el.className === "string" ? el.className : "";
  if (cls && REFERENCE_SECTION_RE.test(cls)) return true;
  if (el.id && REFERENCE_SECTION_RE.test(el.id)) return true;
  return false;
}

// Per-pass memo — findReferenceContainers runs several times per handler pass
// and the full-document scan is expensive. beginDomScanPass() bumps the epoch.
let _scanEpoch = 0;
let _refContainerCache: { epoch: number; doc: Document; result: Element[] } | null = null;

/** Invalidate the per-pass scan memo. Call once at the start of each handler pass. */
export function beginDomScanPass(): void {
  _scanEpoch++;
}

export function findReferenceContainers(doc: Document): Element[] {
  if (
    _refContainerCache &&
    _refContainerCache.epoch === _scanEpoch &&
    _refContainerCache.doc === doc
  ) {
    return _refContainerCache.result;
  }

  const matched: Element[] = [];
  for (const el of doc.querySelectorAll<Element>("[class],[id]")) {
    if (isReferenceContainer(el)) matched.push(el);
  }
  // Keep only outermost containers to avoid double-counting nested elements
  const result = matched.filter(
    (el) => !matched.some((other) => other !== el && other.contains(el))
  );

  _refContainerCache = { epoch: _scanEpoch, doc, result };
  return result;
}

/** A single reference-list entry, kept linked to its DOM element. */
export interface ReferenceEntry {
  /** The DOM element for this one reference (e.g. an <li>). */
  element: HTMLElement;
  /** DOI already present in the entry, or null when it needs augmentation. */
  doi: DoiString | null;
  /** True when `doi` was read from visible citation text (vs. only a link href). */
  doiInText: boolean;
  /** Visible citation text — used as the augmentation query when doi is null. */
  text: string;
}

/**
 * Trailing labels that publishers append after the citation as inline link
 * buttons (Crossref | PubMed | Web of Science | Google Scholar | …). When the
 * page's reference list is serialised to innerText these end up glued to the
 * citation, which both pollutes augmentation queries and uglifies the panel.
 */
const REFERENCE_BUTTON_LABEL_RE =
  /[\s|·•,]+(?:Cross\s?Ref|PubMed(?:\s+Central)?|Web\s+of\s+Science|Google\s+Scholar|ISI|Medline|Scopus|CAS|View\s+(?:Article|in\s+Article|on\s+Publisher\s+Site)|Full[\s-]?Text|PDF|Free\s+Article|Open\s+Access|Find\s+in\s+Worldcat|ChemPort|Bing(?:\s+Scholar)?|OpenURL|DOI|Direct\s+Link|ADS|ProQuest|Show\s+Abstract|Read\s+(?:Article|Abstract))\b[\s.,;|·•]*$/i;

function cleanReferenceText(text: string): string {
  let cleaned = text.trim();
  let prev: string;
  do {
    prev = cleaned;
    cleaned = cleaned.replace(REFERENCE_BUTTON_LABEL_RE, "").trim();
  } while (cleaned !== prev);
  return cleaned;
}

/**
 * Find the DOI already present in a single reference entry, if any, and report
 * whether it was read from the visible citation text or only from a link href.
 */
function extractDoiFromEntry(
  entry: HTMLElement,
  hostDoi: DoiString | null
): { doi: DoiString | null; inText: boolean } {
  // Visible citation text wins — that's the reliable signal of which paper
  // the entry is *about*. Links inside the entry are often nav/action
  // buttons ("View", "Cite", "Add to favorites") that point at the current
  // article, not the cited/citing paper — using them first caused every
  // Wiley cited-by row to resolve to the host article's own DOI.
  const text = entry.textContent ?? "";
  const cleaned = decodeEncodedDois(text.replace(WORD_BREAK_CHARS, ""));
  for (const match of cleaned.matchAll(DOI_TEXT_REGEX)) {
    const raw = cleanDoiTrailing(match[1]);
    if (!isValidDoiSuffix(raw)) continue;
    const doi = normaliseDOI(raw);
    if (doi) return { doi, inText: true };
  }
  // Fall back to link hrefs only when no DOI is written out — covers entries
  // where the DOI is tucked into a "Crossref"/"PubMed" button URL. Skip
  // links resolving to the host article's own DOI (Wiley sprinkles "View"
  // jumplinks pointing at the current article inside the cited-by section),
  // otherwise those non-citation stubs render a stray pill on the header.
  for (const link of entry.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const doi = extractDoiFromHref(link.href);
    if (doi && doi !== hostDoi) return { doi, inText: false };
  }
  return { doi: null, inText: false };
}

/**
 * Within `container`, find the largest group of `<tag>` elements that share a
 * common parent. Reference lists almost always render as a sibling group of
 * the same tag (<li>, <p>, or <div>); picking the biggest group is a reliable
 * way to identify the entries even when the container has unrelated children
 * like a heading or a "Citation" sub-block.
 */
function findLargestSiblingGroup(container: Element, tag: string): HTMLElement[] {
  const byParent = new Map<Element, HTMLElement[]>();
  for (const node of container.querySelectorAll<HTMLElement>(tag)) {
    const parent = node.parentElement;
    if (!parent) continue;
    const group = byParent.get(parent) ?? [];
    group.push(node);
    byParent.set(parent, group);
  }
  let best: HTMLElement[] = [];
  for (const group of byParent.values()) {
    if (group.length > best.length) best = group;
  }
  return best;
}

/**
 * Split the page's reference/bibliography section(s) into individual reference
 * entries, each kept linked to its DOM element and to any DOI it already
 * contains. Callers can render against `element` directly — no re-scanning or
 * regex needed at render time.
 *
 * Detection cascades through the common journal markups:
 * - <ol>/<ul> lists with <li> entries
 * - sibling groups of <p> (typical for many journal templates)
 * - sibling groups of <div> (some bibliography styles)
 * - fallback: direct element children of the container
 */
export function findReferenceEntries(doc: Document): ReferenceEntry[] {
  const elements: HTMLElement[] = [];

  for (const container of findReferenceContainers(doc)) {
    const lis = Array.from(container.querySelectorAll<HTMLElement>("li"))
      .filter((li) => !li.querySelector("li"));
    if (lis.length >= 2) {
      elements.push(...lis);
      continue;
    }

    const pGroup = findLargestSiblingGroup(container, "p");
    if (pGroup.length >= 2) {
      elements.push(...pGroup);
      continue;
    }

    const divGroup = findLargestSiblingGroup(container, "div");
    if (divGroup.length >= 2) {
      elements.push(...divGroup);
      continue;
    }

    // Fallback: descend through structural single-child wrappers, then treat
    // each element child as one entry.
    let scope: Element = container;
    while (
      scope.children.length === 1 &&
      scope.firstElementChild &&
      /^(div|section|article)$/i.test(scope.firstElementChild.tagName)
    ) {
      scope = scope.firstElementChild;
    }
    for (const child of scope.children) {
      if (child instanceof HTMLElement && (child.textContent ?? "").trim().length > 0) {
        elements.push(child);
      }
    }
  }

  const hostDoi = extractPrimaryDOI(doc);
  return elements.map((element) => {
    const { doi, inText } = extractDoiFromEntry(element, hostDoi);
    return {
      element,
      doi,
      doiInText: inText,
      text: cleanReferenceText(element.textContent ?? ""),
    };
  });
}

function extractFromReferenceContainers(doc: Document, found: Set<DoiString>): void {
  for (const container of findReferenceContainers(doc)) {
    // DOI links inside the container — handle publisher landing-page URLs
    // (?doi=, /doi/10.xxx/yyy paths) in addition to plain doi.org links.
    for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const doi = extractDoiFromHref(link.href);
      if (doi) found.add(doi);
    }
    // Visible text inside the container (textContent, not innerText — avoids a
    // layout reflow; placement stays visibility-gated at render time).
    const text = container.textContent ?? "";
    const cleaned = decodeEncodedDois(text.replace(WORD_BREAK_CHARS, ""));
    for (const match of cleaned.matchAll(DOI_TEXT_REGEX)) {
      const raw = cleanDoiTrailing(match[1]);
      if (!isValidDoiSuffix(raw)) continue;
      const doi = normaliseDOI(raw);
      if (doi) found.add(doi);
    }
  }
}

/**
 * Detect whether the current page is an individual article, a listing/index
 * page, or unknown.
 *
 * An article page has a primary DOI in its URL, meta tags, or JSON-LD.
 * Listing pages are inferred from URL path segments when no primary DOI is
 * present.
 */
export function detectPageType(doc: Document): PageType {
  const primaryDoi = extractPrimaryDOI(doc);
  if (primaryDoi) return "article";
  return pageTypeFromPath(doc);
}

/** Path-only page-type heuristic — used when no primary DOI is present. */
function pageTypeFromPath(doc: Document): PageType {
  const path = doc.location?.pathname?.toLowerCase() ?? "";
  if (/\/(toc|issues?|volumes?|search|browse|list|results?|catalog|archive|index)(\/|$)/.test(path)) {
    return "listing";
  }
  return "unknown";
}

/**
 * Extract and classify all DOIs on the page into three groups:
 * - articleDois: the DOI(s) that identify the current paper (URL / meta / JSON-LD)
 * - referenceDois: DOIs found inside reference/bibliography section elements
 * - otherDois: everything else (body text, other links)
 *
 * Also returns the detected page type.
 */
export function classifyPageDois(doc: Document, occurrences?: DoiOccurrence[]): ClassifiedDois {
  // Article DOIs (authoritative sources) — scanned once, reused below.
  const articleFound = new Set<DoiString>();
  extractFromUrl(doc, articleFound);
  extractFromMeta(doc, articleFound);
  extractFromJsonLd(doc, articleFound);

  // Reference section DOIs (the article's own DOI stays classified as article).
  const referenceFound = new Set<DoiString>();
  extractFromReferenceContainers(doc, referenceFound);
  for (const doi of articleFound) referenceFound.delete(doi);

  // Remaining page-wide DOIs — seed from the article set to avoid re-scanning.
  const pageWide = new Set<DoiString>(articleFound);
  if (occurrences) {
    // Single-scan path: reuse the position-aware occurrences already computed
    // for this pass instead of a second a[href] sweep + a full body-text read.
    // Occurrences capture every DOI that can be located on the page (link text,
    // doi.org/embedded hrefs, and prose text nodes), which is exactly the set
    // that drives lookup + placement. DOIs that occurrences deliberately skip
    // (editable regions, or a DOI split across sibling text nodes) are ones we
    // never render anyway, so omitting them from the lookup set is safe.
    for (const occ of occurrences) pageWide.add(occ.doi);
  } else {
    extractFromDoiLinks(doc, pageWide);
    extractFromVisibleText(doc, pageWide);
  }

  // Other = everything not already classified
  const otherFound = new Set<DoiString>();
  for (const doi of pageWide) {
    if (!articleFound.has(doi) && !referenceFound.has(doi)) otherFound.add(doi);
  }

  // Article page = has a primary DOI; reuse the article set, no extra scan.
  const pageType: PageType = articleFound.size > 0 ? "article" : pageTypeFromPath(doc);

  debugLog(
    `classifyPageDois: pageType=${pageType}`,
    `article=${articleFound.size}`,
    `references=${referenceFound.size}`,
    `other=${otherFound.size}`
  );

  return {
    pageType,
    articleDois: [...articleFound],
    referenceDois: [...referenceFound],
    otherDois: [...otherFound],
    retractedDois: [],
    allDois: [...new Set([...articleFound, ...referenceFound, ...otherFound])],
  };
}

function isGoogleSheets(doc: Document): boolean {
  try {
    const url = (doc.location?.href ?? "");
    // Match both top frame and iframes within Google Sheets
    return url.includes("docs.google.com/spreadsheets") ||
      doc.querySelector('meta[name="google"]')?.getAttribute("content") === "notranslate" &&
      !!doc.querySelector('[role="grid"]');
  } catch {
    return false;
  }
}

