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

// For visible body text only — innerText contains no HTML tags, so < and >
// appear as literal characters (e.g. SICI DOIs decoded from &lt; / &gt; HTML
// entities). We allow them here so that DOIs like
// 10.1002/(SICI)...18:4<303::AID-SMJ869>3.0.CO;2-G are not truncated at '<'.
const TEXT_SUFFIX_CHARS = `[^\\s,/\\]'"#?&\\\\]`;
const TEXT_EXTRA_SLASH = `(?:\\/(?![a-zA-Z-]+(?:[/\\s,#?&<>{}\\[\\]]|$))${TEXT_SUFFIX_CHARS}+)*`;
export const DOI_TEXT_REGEX = new RegExp(`(10\\.\\d{4,}(?:\\.\\d+)*\\/${TEXT_SUFFIX_CHARS}+${TEXT_EXTRA_SLASH})`, "g");

// Characters inserted by browsers/sites for word-break purposes that can split DOIs
const WORD_BREAK_CHARS = /[\u200B\u200C\u200D\u00AD\uFEFF\u2060]/g;

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

function extractFromVisibleText(doc: Document, found: Set<DoiString>): void {
  const rawText = doc.body?.innerText || doc.body?.textContent || "";
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

// Class/id tokens that indicate a reference or bibliography section
const REFERENCE_SECTION_RE = /^(?:cited|cites?|citations?|bibliography|bibliograph(?:y|ies)|references?|reflist|ref-list|works-cited|footnotes?)$/i;

function isReferenceContainer(el: Element): boolean {
  if (el.className) {
    const cls = typeof el.className === "string" ? el.className : "";
    for (const token of cls.split(/\s+/)) {
      if (token && REFERENCE_SECTION_RE.test(token)) return true;
    }
  }
  if (el.id && REFERENCE_SECTION_RE.test(el.id)) return true;
  return false;
}

function findReferenceContainers(doc: Document): Element[] {
  const matched: Element[] = [];
  for (const el of doc.querySelectorAll<Element>("[class],[id]")) {
    if (isReferenceContainer(el)) matched.push(el);
  }
  // Keep only outermost containers to avoid double-counting nested elements
  return matched.filter(
    (el) => !matched.some((other) => other !== el && other.contains(el))
  );
}

function extractFromReferenceContainers(doc: Document, found: Set<DoiString>): void {
  for (const container of findReferenceContainers(doc)) {
    // DOI links inside the container
    for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const doi = normaliseDOI(link.href);
      if (doi) found.add(doi);
    }
    // Visible text inside the container
    const text = (container as HTMLElement).innerText ?? container.textContent ?? "";
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
export function classifyPageDois(doc: Document): ClassifiedDois {
  // Article DOIs — authoritative sources only
  const articleFound = new Set<DoiString>();
  extractFromUrl(doc, articleFound);
  extractFromMeta(doc, articleFound);
  extractFromJsonLd(doc, articleFound);

  // Reference section DOIs
  const referenceFound = new Set<DoiString>();
  extractFromReferenceContainers(doc, referenceFound);
  // The article's own DOI might appear in its reference list — keep it as article
  for (const doi of articleFound) referenceFound.delete(doi);

  // All DOIs on the page
  const allFound = new Set<DoiString>();
  extractFromUrl(doc, allFound);
  extractFromMeta(doc, allFound);
  extractFromJsonLd(doc, allFound);
  extractFromDoiLinks(doc, allFound);
  extractFromVisibleText(doc, allFound);

  // Other = everything not already classified
  const otherFound = new Set<DoiString>();
  for (const doi of allFound) {
    if (!articleFound.has(doi) && !referenceFound.has(doi)) otherFound.add(doi);
  }

  const pageType = detectPageType(doc);

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

