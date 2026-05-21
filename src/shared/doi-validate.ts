import type { DoiString } from "./types";
import { debugLog } from "./debug";

/**
 * Validate DOIs by checking the doi.org Handle System API.
 * A responseCode of 1 means the DOI exists and resolves.
 * This is much cheaper than full augmentation (Crossref/OpenAlex title search).
 */

const HANDLE_API = "https://doi.org/api/handles/";
const CACHE_PREFIX = "flora_doival:";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedValidation {
  valid: boolean;
  timestamp: number;
}

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

  // Check cache first
  const uncached: DoiString[] = [];
  const cacheKeys = dois.map((d) => CACHE_PREFIX + d);

  try {
    const cached = await chrome.storage.local.get(cacheKeys);
    for (const doi of dois) {
      const entry = cached[CACHE_PREFIX + doi] as CachedValidation | undefined;
      if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
        results.set(doi, entry.valid);
      } else {
        uncached.push(doi);
      }
    }
  } catch {
    uncached.push(...dois);
  }

  if (uncached.length === 0) {
    debugLog(`DOI validation: ${dois.length} DOI(s) all cached`);
    return results;
  }

  debugLog(`DOI validation: ${uncached.length} uncached DOI(s) to check`);

  // Validate uncached DOIs in parallel. A DOI is recorded `false` only when
  // doi.org *definitively* reports it absent (HTTP 404, or responseCode ≠ 1).
  // Transient failures — network errors, rate limits, 5xx — leave the DOI out
  // of the result map entirely so callers treat it as "unknown" and don't drop
  // a possibly-valid DOI. (Marking it invalid here permanently strands the
  // reference: processReferenceDois sets its processed-marker before this
  // check, so a falsely-invalid DOI never gets a second chance at a pill.)
  await Promise.allSettled(
    uncached.map(async (doi) => {
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
          if (response.status === 404) {
            results.set(doi, false);
            cacheResult(doi, false);
          }
          return;
        }
        const data = (await response.json()) as { responseCode?: number };
        // responseCode 1 = success (handle exists)
        const valid = data.responseCode === 1;
        results.set(doi, valid);
        cacheResult(doi, valid);
        debugLog(`DOI validation: ${doi} → ${valid ? "valid" : "invalid"}`);
      } catch {
        // Network error — leave unknown (absent from map); don't cache.
      }
    })
  );
  return results;
}

function cacheResult(doi: DoiString, valid: boolean): void {
  const key = CACHE_PREFIX + doi;
  const entry: CachedValidation = { valid, timestamp: Date.now() };
  chrome.storage.local.set({ [key]: entry }).catch(() => {});
}
