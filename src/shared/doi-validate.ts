import type { DoiString } from "./types";
import { debugLog } from "./debug";
import { BlobCache } from "./blob-cache";
import { isWorkerContext, proxyFetch } from "./messages";

/**
 * Validate DOIs by checking the doi.org Handle System API.
 * A responseCode of 1 means the DOI exists and resolves.
 * This is much cheaper than full augmentation (Crossref/OpenAlex title search).
 */

const HANDLE_API = "https://doi.org/api/handles/";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

const VALIDATION_CACHE = new BlobCache<{ valid: boolean }>({
  storageKey: "flora_doival_blob",
  ttlMs: CACHE_TTL,
  legacyPrefixes: ["flora_doival:"],
});

/**
 * Check whether a single DOI resolves via doi.org.
 * Results are cached in chrome.storage.local for 7 days.
 */
export async function validateDOI(doi: DoiString): Promise<boolean> {
  const result = await validateDOIs([doi]);
  return result.get(doi) ?? false;
}

/**
 * Validate multiple DOIs in parallel via the doi.org Handle System API.
 * Returns a Map of DOI → valid (true/false).
 * Cached results are reused; uncached DOIs are checked in parallel.
 */
export async function validateDOIs(
  dois: DoiString[]
): Promise<Map<DoiString, boolean>> {
  const results = new Map<DoiString, boolean>();
  if (dois.length === 0) return results;

  // Check cache first — single-blob lookup keyed by DOI.
  const uncached: DoiString[] = [];
  const cached = await VALIDATION_CACHE.getMany(dois);
  for (const doi of dois) {
    const entry = cached.get(doi);
    if (entry) {
      results.set(doi, entry.valid);
    } else {
      uncached.push(doi);
    }
  }

  if (uncached.length === 0) {
    debugLog(`DOI validation: ${dois.length} DOI(s) all cached`);
    return results;
  }

  debugLog(`DOI validation: ${uncached.length} uncached DOI(s) to check`);

  // Fetch the doi.org verdicts for uncached DOIs: directly in the worker, or
  // proxied through it from a content script (doi.org sends no CORS headers, so
  // a page-context request cannot read the response). A proxy failure (e.g. an
  // invalidated extension context) leaves every DOI unknown, matching the
  // transient-error semantics below.
  const entries = isWorkerContext()
    ? await validateDOIsRaw(uncached)
    : await proxyFetch<Array<[DoiString, boolean]>>("validateDois", [uncached]).catch(() => []);

  // Accumulate cache writes and flush the blob once for the whole batch rather
  // than once per resolved DOI (each VALIDATION_CACHE.set is a full
  // chrome.storage.local write of the whole blob).
  const updates: Array<[DoiString, { valid: boolean }]> = [];
  for (const [doi, valid] of entries) {
    results.set(doi, valid);
    updates.push([doi, { valid }]);
  }

  if (updates.length > 0) await VALIDATION_CACHE.setMany(updates);
  return results;
}

/**
 * Query doi.org's Handle System for a batch of DOIs (no caching). Runs in the
 * service worker. Returns only the DOIs doi.org answers *definitively* for:
 * a DOI is `true` when responseCode is 1, `false` on a 404 or responseCode ≠ 1.
 * Transient failures — network errors, rate limits, 5xx — are omitted entirely
 * so callers treat them as "unknown" and don't drop a possibly-valid DOI.
 * (Marking it invalid permanently strands the reference: processReferenceDois
 * sets its processed-marker before this check, so a falsely-invalid DOI never
 * gets a second chance at a pill.)
 */
export async function validateDOIsRaw(
  dois: DoiString[]
): Promise<Array<[DoiString, boolean]>> {
  const entries: Array<[DoiString, boolean]> = [];
  await Promise.allSettled(
    dois.map(async (doi) => {
      try {
        // Preserve slashes as URL path separators so multi-slash DOIs
        // (e.g. 10.6338/JDA.202212/SP_17(4).0000) route correctly on doi.org.
        // encodeURIComponent on the full DOI would collapse all '/' to %2F,
        // making the server see a single opaque segment instead of a path.
        const encodedHandle = doi.split("/").map(encodeURIComponent).join("/");
        const response = await fetch(`${HANDLE_API}${encodedHandle}`);
        if (!response.ok) {
          // 404 = the Handle System has no record of this DOI → invalid.
          // Any other non-OK status (429, 5xx) is transient — leave unknown.
          if (response.status === 404) entries.push([doi, false]);
          return;
        }
        const data = (await response.json()) as { responseCode?: number };
        // responseCode 1 = success (handle exists)
        const valid = data.responseCode === 1;
        entries.push([doi, valid]);
        debugLog(`DOI validation: ${doi} → ${valid ? "valid" : "invalid"}`);
      } catch {
        // Network error — leave unknown (absent from result); don't cache.
      }
    })
  );
  return entries;
}

/** Test-only: drop in-memory cache state so each case starts fresh. */
export function _resetValidationCacheForTesting(): void {
  VALIDATION_CACHE.resetForTesting();
}
