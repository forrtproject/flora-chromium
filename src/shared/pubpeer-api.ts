import { debugLog } from "./debug";

export interface PubPeerFeedback {
  id: string;
  title: string;
  total_comments: number;
  total_peeriodical_comments: number;
  last_commented_at: string;
  users: string;
  url: string;
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
  if (!response.ok) {
    throw new Error(`PubPeer API error: ${response.status}`);
  }
  const data = (await response.json()) as { status: string; feedbacks?: PubPeerFeedback[] };
  return data.feedbacks ?? [];
}

const CACHE_PREFIX = "flora_pubpeer:";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h — comment counts change over time
// How many per-DOI PubPeer requests to keep in flight at once. Reference lists
// can be long; this keeps page load from issuing dozens of parallel requests.
const DOI_LOOKUP_CONCURRENCY = 6;

interface CachedFeedback {
  feedback: PubPeerFeedback | null;
  timestamp: number;
}

/**
 * Look up PubPeer feedback for a single DOI, with a 24h chrome.storage cache.
 * Unlike the batch {@link lookupPubPeer}, the result is reliably tied to the
 * queried DOI. Returns null when PubPeer has no record for the DOI.
 */
export async function lookupPubPeerByDoi(doi: string): Promise<PubPeerFeedback | null> {
  const key = CACHE_PREFIX + doi;

  try {
    const cached = await chrome.storage.local.get(key);
    const entry = cached[key] as CachedFeedback | undefined;
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.feedback;
    }
  } catch {
    // storage unavailable — fall through to network
  }

  let feedback: PubPeerFeedback | null;
  try {
    feedback = (await lookupPubPeer([doi], []))[0] ?? null;
  } catch {
    return null; // network/API error — don't cache a failure
  }

  try {
    const entry: CachedFeedback = { feedback, timestamp: Date.now() };
    await chrome.storage.local.set({ [key]: entry });
  } catch {
    // ignore cache write failures
  }
  return feedback;
}

/**
 * Look up PubPeer feedback for many DOIs individually (concurrency-limited and
 * cached), so each result is reliably keyed by its DOI. Returns a Map
 * containing only the DOIs PubPeer actually has a record for.
 */
export async function lookupPubPeerForDois<T extends string>(
  dois: T[]
): Promise<Map<T, PubPeerFeedback>> {
  const result = new Map<T, PubPeerFeedback>();
  if (dois.length === 0) return result;

  let index = 0;
  const worker = async (): Promise<void> => {
    while (index < dois.length) {
      const doi = dois[index++];
      const feedback = await lookupPubPeerByDoi(doi);
      if (feedback) result.set(doi, feedback);
    }
  };

  const workerCount = Math.min(DOI_LOOKUP_CONCURRENCY, dois.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  debugLog(`PubPeer: ${result.size}/${dois.length} reference DOI(s) have a PubPeer record`);
  return result;
}
