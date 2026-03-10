import { SessionCache } from "../shared/cache";
import { lookupDOIs } from "../shared/flora-api";
import type { DoiString, ReplicationResult } from "../shared/types";
import type { LookupResponse } from "../shared/messages";
import { isLookupRequest } from "../shared/messages";

const cache = new SessionCache<ReplicationResult>("flora");

/** In-flight dedup: prevents duplicate API calls for the same DOI */
const inflight = new Map<DoiString, Promise<ReplicationResult | null>>();

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (!isLookupRequest(message)) return false;

    handleLookup(message.dois)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          type: "FLORA_LOOKUP_RESULT",
          results: {},
          errors: Object.fromEntries(
            message.dois.map((d) => [d, "Service worker error"])
          ),
        } satisfies LookupResponse)
      );

    return true; // keep channel open for async sendResponse
  }
);

async function handleLookup(dois: DoiString[]): Promise<LookupResponse> {
  const results: Record<string, ReplicationResult> = {};
  const errors: Record<string, string> = {};
  const toFetch: DoiString[] = [];

  // Check cache and in-flight requests
  for (const doi of dois) {
    const cached = await cache.get(doi);
    if (cached !== null) {
      results[doi] = cached;
    } else if (inflight.has(doi)) {
      const r = await inflight.get(doi)!;
      if (r) results[doi] = r;
    } else {
      toFetch.push(doi);
    }
  }

  if (toFetch.length === 0) {
    return { type: "FLORA_LOOKUP_RESULT", results, errors };
  }

  // Batch API call for uncached DOIs
  const batchPromise = lookupDOIs(toFetch);

  // Register each DOI as in-flight (catch to prevent unhandled rejection —
  // the main try/catch below handles the actual error reporting)
  for (const doi of toFetch) {
    inflight.set(
      doi,
      batchPromise.then((map) => map.get(doi) ?? null).catch(() => null)
    );
  }

  try {
    const apiResults = await batchPromise;

    for (const doi of toFetch) {
      const r = apiResults.get(doi);
      if (r) {
        results[doi] = r;
        await cache.set(doi, r);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    for (const doi of toFetch) {
      errors[doi] = msg;
    }
  } finally {
    for (const doi of toFetch) {
      inflight.delete(doi);
    }
  }

  return { type: "FLORA_LOOKUP_RESULT", results, errors };
}
