import type { DoiString } from "./types";
import { normaliseDOI } from "./doi-normalise";

// Allow parens inside DOIs (e.g. 10.1016/S0924-9338(98)80023-0)
// but stop at whitespace, commas, quotes, fragments, query strings, etc.
const DOI_REGEX = /(10\.\d{4,}(?:\.\d+)*\/[^\s,;\]}>'"<#?&]+)/g;


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
 * 6. Google Sheets cells (accessibility table + ARIA labels)
 */
export function extractDOIs(doc: Document): DoiString[] {
  const found = new Set<DoiString>();

  extractFromUrl(doc, found);
  extractFromMeta(doc, found);
  extractFromJsonLd(doc, found);
  extractFromDoiLinks(doc, found);
  extractFromVisibleText(doc, found);
  extractFromSheetsCells(doc, found);

  return [...found];
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

/**
 * Extract DOIs from a raw text string, with URI-decoding support
 * (PubPeer pattern: DOIs may be URI-encoded in HTML attributes, e.g. 10.1000%2Fxyz → 10.1000/xyz)
 */
function extractDoisFromText(text: string, found: Set<DoiString>): number {
  let count = 0;
  const cleaned = text.replace(WORD_BREAK_CHARS, "");

  // First pass: direct regex match
  for (const match of cleaned.matchAll(DOI_REGEX)) {
    const raw = cleanDoiTrailing(match[1]);
    if (!isValidDoiSuffix(raw)) continue;
    const doi = normaliseDOI(raw);
    if (doi) { found.add(doi); count++; }
  }

  // Second pass: URI-decode and re-scan (catches %2F-encoded DOIs from Sheets HTML attributes)
  try {
    const decoded = decodeURIComponent(cleaned);
    if (decoded !== cleaned) {
      for (const match of decoded.matchAll(DOI_REGEX)) {
        const raw = cleanDoiTrailing(match[1]);
        if (!isValidDoiSuffix(raw)) continue;
        const doi = normaliseDOI(raw);
        if (doi) { found.add(doi); count++; }
      }
    }
  } catch {
    // malformed URI, skip decode pass
  }

  return count;
}

function extractFromSheetsCells(doc: Document, found: Set<DoiString>): void {
  if (!isGoogleSheets(doc)) return;

  const beforeCount = found.size;

  // Layer 1: Accessibility table (.waffle) — primary source of cell text
  const waffleCells = doc.querySelectorAll<HTMLTableCellElement>("table.waffle td");
  let waffleDois = 0;
  for (const cell of waffleCells) {
    const text = cell.textContent?.trim();
    if (!text) continue;
    waffleDois += extractDoisFromText(text, found);
  }

  // Layer 2: ARIA labels on gridcell elements (screen reader layer)
  const ariaCells = doc.querySelectorAll<HTMLElement>('[role="gridcell"][aria-label]');
  let ariaDois = 0;
  for (const cell of ariaCells) {
    const label = cell.getAttribute("aria-label") ?? "";
    if (!label) continue;
    ariaDois += extractDoisFromText(label, found);
  }

  // Layer 3: Any element with role="gridcell" — textContent fallback
  const gridCells = doc.querySelectorAll<HTMLElement>('[role="gridcell"]');
  let gridDois = 0;
  for (const cell of gridCells) {
    const text = cell.textContent?.trim();
    if (!text) continue;
    gridDois += extractDoisFromText(text, found);
  }

  // Layer 4: Input/textarea elements inside the sheet (formula bar, cell editor)
  const inputs = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input[aria-label], textarea[aria-label], [contenteditable="true"]'
  );
  let inputDois = 0;
  for (const input of inputs) {
    const text = (input as HTMLInputElement).value ?? input.textContent ?? "";
    if (!text.trim()) continue;
    inputDois += extractDoisFromText(text, found);
  }

  // Layer 5: innerHTML scan of the full body (PubPeer pattern — catches DOIs anywhere in the DOM)
  let htmlDois = 0;
  if (doc.body) {
    htmlDois = extractDoisFromText(doc.body.innerHTML, found);
  }

  const newDois = found.size - beforeCount;
  console.log(
    `[FLoRA] Google Sheets scan: waffle=${waffleCells.length}(${waffleDois}), ` +
    `aria=${ariaCells.length}(${ariaDois}), grid=${gridCells.length}(${gridDois}), ` +
    `inputs=${inputs.length}(${inputDois}), innerHTML(${htmlDois}) — ${newDois} unique new DOIs`
  );
}
