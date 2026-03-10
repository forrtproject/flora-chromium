import type { DoiString } from "./types";
import { normaliseDOI } from "./doi-normalise";

// Allow parens inside DOIs (e.g. 10.1016/S0924-9338(98)80023-0)
// but stop at whitespace, commas, quotes, fragments, query strings, etc.
const DOI_REGEX = /(10\.\d{4,}(?:\.\d+)*\/[^\s,;\]}>'"<#?&]+)/g;

const LOG_PREFIX = "[FLoRA:extractor]";

// Characters inserted by browsers/sites for word-break purposes that can split DOIs
const WORD_BREAK_CHARS = /[\u200B\u200C\u200D\u00AD\uFEFF\u2060]/g;

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

  const before = found.size;
  extractFromUrl(doc, found);
  if (found.size > before)
    console.log(`${LOG_PREFIX} URL layer found ${found.size - before} DOI(s):`, [...found]);

  const beforeMeta = found.size;
  extractFromMeta(doc, found);
  if (found.size > beforeMeta)
    console.log(`${LOG_PREFIX} Meta tag layer found ${found.size - beforeMeta} new DOI(s)`);

  const beforeJsonLd = found.size;
  extractFromJsonLd(doc, found);
  if (found.size > beforeJsonLd)
    console.log(`${LOG_PREFIX} JSON-LD layer found ${found.size - beforeJsonLd} new DOI(s)`);

  const beforeDoiLinks = found.size;
  extractFromDoiLinks(doc, found);
  if (found.size > beforeDoiLinks)
    console.log(`${LOG_PREFIX} DOI link layer found ${found.size - beforeDoiLinks} new DOI(s)`);

  const beforeText = found.size;
  extractFromVisibleText(doc, found);
  if (found.size > beforeText)
    console.log(`${LOG_PREFIX} Visible text layer found ${found.size - beforeText} new DOI(s)`);

  const result = [...found];
  if (result.length > 0) {
    console.log(`${LOG_PREFIX} Total DOIs extracted: ${result.length}`, result);
  } else {
    console.log(`${LOG_PREFIX} No DOIs found on page`);
  }

  return result;
}

function extractFromUrl(doc: Document, found: Set<DoiString>): void {
  const url = doc.location?.href ?? "";
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
    // Only extract from known DOI resolver domains
    try {
      const url = new URL(href);
      const host = url.hostname.toLowerCase();
      if (host !== "doi.org" && host !== "dx.doi.org") continue;
    } catch {
      continue;
    }
    const doi = normaliseDOI(href);
    if (doi) found.add(doi);
  }
}

function extractFromVisibleText(doc: Document, found: Set<DoiString>): void {
  const rawText = doc.body?.innerText || doc.body?.textContent || "";
  // Strip invisible word-break characters that sites insert for overflow-wrap/break-word
  const bodyText = rawText.replace(WORD_BREAK_CHARS, "");
  const matches = bodyText.matchAll(DOI_REGEX);
  for (const match of matches) {
    const cleaned = cleanDoiTrailing(match[1]);
    if (!isValidDoiSuffix(cleaned)) continue;
    const doi = normaliseDOI(cleaned);
    if (doi) found.add(doi);
  }
}
