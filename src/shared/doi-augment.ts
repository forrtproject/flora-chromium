import type { DoiString } from "./types";
import { normaliseDOI } from "./doi-normalise";

const OPENALEX_BASE = "https://api.openalex.org/works";
const CROSSREF_BASE = "https://api.crossref.org/works";
const CACHE_PREFIX = "flora_doi:";
const DEFAULT_EMAIL = "flora-extension@example.com";
const MATCH_THRESHOLD_TSR = 88; // token_set_ratio threshold (0–100)

const LOG_PREFIX = "[FLoRA:augment]";

/**
 * Normalize a title for comparison: lowercase, strip non-word chars, collapse spaces.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clean a title for use in API search filters.
 * Strips characters that break filter syntax.
 */
function cleanTitleForSearch(title: string): string {
  return title
    .replace(/[:()\[\]&|\\,;'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Levenshtein-based similarity score between two strings (0 to 1).
 * 1.0 = identical, 0.0 = completely different.
 */
export function similarity(s1: string, s2: string): number {
  const longer = s1.length >= s2.length ? s1 : s2;

  if (longer.length === 0) return 1.0;

  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }

  return (longer.length - costs[s2.length]) / longer.length;
}

/**
 * Token-set-ratio fuzzy matching (pure JS port of fuzzywuzzy's token_set_ratio).
 * Tokenizes both strings, computes intersection/difference sets, and returns
 * the max Levenshtein similarity across three comparison pairs.
 * Returns a score from 0 to 100.
 */
export function tokenSetRatio(s1: string, s2: string): number {
  const tokens1 = new Set(normalizeTitle(s1).split(/\s+/).filter(Boolean));
  const tokens2 = new Set(normalizeTitle(s2).split(/\s+/).filter(Boolean));

  const intersection = [...tokens1].filter((t) => tokens2.has(t));
  const diff1 = [...tokens1].filter((t) => !tokens2.has(t));
  const diff2 = [...tokens2].filter((t) => !tokens1.has(t));

  const sortedIntersection = intersection.sort().join(" ");
  const combined1 = [sortedIntersection, ...diff1.sort()].join(" ").trim();
  const combined2 = [sortedIntersection, ...diff2.sort()].join(" ").trim();

  const r1 = similarity(sortedIntersection, combined1);
  const r2 = similarity(sortedIntersection, combined2);
  const r3 = similarity(combined1, combined2);

  return Math.max(r1, r2, r3) * 100;
}

interface CachedDoiResult {
  found: boolean;
  doi: string | null;
}

interface DoiCandidate {
  doi: DoiString;
  title: string;
  score: number;
  source: "crossref" | "openalex";
}

/**
 * Query Crossref for a single title, return the best-matching candidate.
 */
async function queryCrossref(title: string): Promise<DoiCandidate | null> {
  const cleaned = cleanTitleForSearch(title);
  const url = `${CROSSREF_BASE}?query.title=${encodeURIComponent(cleaned)}&rows=5&mailto=${encodeURIComponent(DEFAULT_EMAIL)}`;

  console.log(`${LOG_PREFIX} Crossref query for: "${title}"`);
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`${LOG_PREFIX} Crossref returned ${response.status}`);
    return null;
  }

  const data = (await response.json()) as {
    message?: {
      items?: Array<{
        DOI?: string;
        title?: string[];
      }>;
    };
  };

  const items = data.message?.items ?? [];
  console.log(`${LOG_PREFIX} Crossref returned ${items.length} candidates`);

  let best: DoiCandidate | null = null;

  for (const item of items) {
    if (!item.DOI || !item.title?.[0]) continue;

    const tsr = tokenSetRatio(title, item.title[0]);
    console.log(`${LOG_PREFIX}   Crossref candidate: "${item.title[0]}" → score=${tsr.toFixed(1)}, DOI=${item.DOI}`);
    if (tsr >= MATCH_THRESHOLD_TSR && (!best || tsr > best.score)) {
      const doi = normaliseDOI(item.DOI);
      if (doi) {
        best = { doi, title: item.title[0], score: tsr, source: "crossref" };
      }
    }
  }

  if (best) {
    console.log(`${LOG_PREFIX} Crossref best match: "${best.title}" (score=${best.score.toFixed(1)}, DOI=${best.doi})`);
  } else {
    console.log(`${LOG_PREFIX} Crossref: no match above threshold (${MATCH_THRESHOLD_TSR})`);
  }

  return best;
}

/**
 * Query OpenAlex for a single title, return the best-matching candidate.
 */
async function queryOpenAlex(title: string): Promise<DoiCandidate | null> {
  const cleaned = cleanTitleForSearch(title);
  const url = `${OPENALEX_BASE}?filter=title.search:${encodeURIComponent(cleaned)}&select=id,doi,title&per_page=5&mailto=${encodeURIComponent(DEFAULT_EMAIL)}`;

  console.log(`${LOG_PREFIX} OpenAlex query for: "${title}"`);
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`${LOG_PREFIX} OpenAlex returned ${response.status}`);
    return null;
  }

  const data = (await response.json()) as {
    results?: Array<{ doi?: string; title?: string }>;
  };

  const works = data.results ?? [];
  console.log(`${LOG_PREFIX} OpenAlex returned ${works.length} candidates`);

  let best: DoiCandidate | null = null;

  for (const work of works) {
    if (!work.doi || !work.title) continue;

    const tsr = tokenSetRatio(title, work.title);
    console.log(`${LOG_PREFIX}   OpenAlex candidate: "${work.title}" → score=${tsr.toFixed(1)}, DOI=${work.doi}`);
    if (tsr >= MATCH_THRESHOLD_TSR && (!best || tsr > best.score)) {
      const doi = normaliseDOI(work.doi);
      if (doi) {
        best = { doi, title: work.title, score: tsr, source: "openalex" };
      }
    }
  }

  if (best) {
    console.log(`${LOG_PREFIX} OpenAlex best match: "${best.title}" (score=${best.score.toFixed(1)}, DOI=${best.doi})`);
  } else {
    console.log(`${LOG_PREFIX} OpenAlex: no match above threshold (${MATCH_THRESHOLD_TSR})`);
  }

  return best;
}

/**
 * Augment DOIs for article titles that don't have a DOI.
 * Queries both Crossref and OpenAlex APIs in parallel, then picks
 * the best-matching candidate using token-set-ratio fuzzy scoring.
 * Returns a Map of original title -> resolved DoiString (or null if not found).
 */
export async function augmentDOIs(
  titles: string[]
): Promise<Map<string, DoiString | null>> {
  const results = new Map<string, DoiString | null>();
  if (titles.length === 0) return results;

  console.log(`${LOG_PREFIX} Augmenting ${titles.length} title(s):`, titles);

  // Check cache first
  const uncached: string[] = [];
  const cacheKeys = titles.map((t) => CACHE_PREFIX + normalizeTitle(t));

  try {
    const cached = await chrome.storage.local.get(cacheKeys);
    for (const title of titles) {
      const key = CACHE_PREFIX + normalizeTitle(title);
      const entry = cached[key] as CachedDoiResult | undefined;
      if (entry) {
        const doi = entry.found && entry.doi ? normaliseDOI(entry.doi) : null;
        results.set(title, doi);
        console.log(`${LOG_PREFIX} Cache hit for "${title}": ${doi ?? "not found"}`);
      } else {
        uncached.push(title);
      }
    }
  } catch {
    uncached.push(...titles);
  }

  if (uncached.length === 0) return results;

  console.log(`${LOG_PREFIX} ${uncached.length} title(s) uncached, querying Crossref + OpenAlex`);

  // Process each uncached title with parallel Crossref + OpenAlex
  const lookupPromises = uncached.map(async (title) => {
    const [crossrefResult, openalexResult] = await Promise.allSettled([
      queryCrossref(title),
      queryOpenAlex(title),
    ]);

    const candidates: DoiCandidate[] = [];
    if (crossrefResult.status === "fulfilled" && crossrefResult.value) {
      candidates.push(crossrefResult.value);
    } else if (crossrefResult.status === "rejected") {
      console.warn(`${LOG_PREFIX} Crossref query failed:`, crossrefResult.reason);
    }
    if (openalexResult.status === "fulfilled" && openalexResult.value) {
      candidates.push(openalexResult.value);
    } else if (openalexResult.status === "rejected") {
      console.warn(`${LOG_PREFIX} OpenAlex query failed:`, openalexResult.reason);
    }

    // Deduplicate by DOI: keep higher score
    const byDoi = new Map<string, DoiCandidate>();
    for (const c of candidates) {
      const existing = byDoi.get(c.doi);
      if (!existing || c.score > existing.score) {
        byDoi.set(c.doi, c);
      }
    }

    // Pick best overall candidate
    let best: DoiCandidate | null = null;
    for (const c of byDoi.values()) {
      if (!best || c.score > best.score) {
        best = c;
      }
    }

    const doi = best?.doi ?? null;
    results.set(title, doi);

    if (best) {
      console.log(`${LOG_PREFIX} Resolved "${title}" → ${best.doi} (via ${best.source}, score=${best.score.toFixed(1)})`);
    } else {
      console.log(`${LOG_PREFIX} No DOI found for "${title}"`);
    }

    // Cache result
    const cacheKey = CACHE_PREFIX + normalizeTitle(title);
    const cacheEntry: CachedDoiResult = { found: doi !== null, doi };
    chrome.storage.local.set({ [cacheKey]: cacheEntry }).catch(() => {});
  });

  await Promise.allSettled(lookupPromises);

  // Set null for any titles that weren't resolved
  for (const title of uncached) {
    if (!results.has(title)) {
      results.set(title, null);
    }
  }

  return results;
}
