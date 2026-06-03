import { debugLog } from "./debug";
import { BlobCache } from "./blob-cache";

export interface PubPeerFeedback {
  id: string;
  title: string;
  total_comments: number;
  total_peeriodical_comments: number;
  last_commented_at: string;
  users: string;
  url: string;
}

export class PubPeerRateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`PubPeer rate limited (retry after ${retryAfterMs}ms)`);
  }
}

export async function lookupPubPeer(
  dois: string[],
  urls: string[]
): Promise<PubPeerFeedback[]> {
  const response = await fetch(
    "https://pubpeer.com/v3/publications?devkey=PubMedChrome",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: "1.6.2",
        browser: "Chrome",
        urls,
        dois,
      }),
    }
  );
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") ?? "0", 10);
    throw new PubPeerRateLimitError((retryAfter > 0 ? retryAfter : 60) * 1000);
  }
  if (!response.ok) {
    throw new Error(`PubPeer API error: ${response.status}`);
  }
  const data = (await response.json()) as { status: string; feedbacks?: PubPeerFeedback[] };
  return data.feedbacks ?? [];
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

const PUBPEER_CACHE = new BlobCache<{ feedback: PubPeerFeedback | null }>({
  storageKey: "flora_pubpeer_blob",
  ttlMs: CACHE_TTL,
  legacyPrefixes: ["flora_pubpeer:"],
});

// Module-level back-off — when PubPeer returns 429, suppress further requests
// until this timestamp passes so we don't keep retrying every DOM tick.
let rateLimitedUntil = 0;

/**
 * Look up PubPeer feedback for many DOIs in a single batch request.
 * The v3/publications endpoint returns `id` = the DOI for each hit, so results
 * are mapped back to their queried DOI without any secondary lookups.
 *
 * Cache strategy:
 *  1. Read chrome.storage for all DOIs — serve hits immediately.
 *  2. One batch POST for all cache-misses.
 *  3. Write results (hits and confirmed misses) back to cache.
 *
 * Returns a Map containing only the DOIs PubPeer has a record for.
 */
export async function lookupPubPeerForDois<T extends string>(
  dois: T[]
): Promise<Map<T, PubPeerFeedback>> {
  const result = new Map<T, PubPeerFeedback>();
  if (dois.length === 0) return result;

  // 1. Serve from cache; collect DOIs that need a network call.
  const uncached: T[] = [];
  const now = Date.now();
  const cached = await PUBPEER_CACHE.getMany(dois);
  for (const doi of dois) {
    const entry = cached.get(doi);
    if (entry) {
      if (entry.feedback) result.set(doi, entry.feedback);
    } else {
      uncached.push(doi);
    }
  }

  if (uncached.length === 0) {
    debugLog(`PubPeer: ${result.size}/${dois.length} reference DOI(s) matched (all cached)`);
    return result;
  }

  if (now < rateLimitedUntil) {
    debugLog(`PubPeer: rate-limited, skipping ${uncached.length} uncached DOI(s)`);
    return result;
  }

  // 2. One batch call for all uncached DOIs.
  let feedbacks: PubPeerFeedback[] = [];
  try {
    feedbacks = await lookupPubPeer(uncached, []);
  } catch (err) {
    if (err instanceof PubPeerRateLimitError) {
      rateLimitedUntil = now + err.retryAfterMs;
      debugLog(`PubPeer: rate limited; backing off ${err.retryAfterMs}ms`);
    }
    return result;
  }

  // feedback.id is the DOI — build a lookup map from the response.
  const hitByDoi = new Map<string, PubPeerFeedback>();
  for (const fb of feedbacks) {
    if (fb.id) hitByDoi.set(fb.id, fb);
  }

  // 3. Cache every uncached DOI (hit → feedback, miss → null) and populate result.
  const writes: Array<[string, { feedback: PubPeerFeedback | null }]> = [];
  for (const doi of uncached) {
    const feedback = hitByDoi.get(doi) ?? null;
    writes.push([doi, { feedback }]);
    if (feedback) result.set(doi, feedback);
  }
  void PUBPEER_CACHE.setMany(writes);

  debugLog(`PubPeer: ${result.size}/${dois.length} reference DOI(s) have a PubPeer record`);
  return result;
}

/** Test-only: drop in-memory cache state so each case starts fresh. */
export function _resetPubPeerCacheForTesting(): void {
  PUBPEER_CACHE.resetForTesting();
}
