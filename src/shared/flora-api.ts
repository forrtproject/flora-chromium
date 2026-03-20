import type { DoiString, ReplicationResult } from "./types";
import { ApiResponseSchema } from "./types";
import { debugLog, debugError } from "./debug";

const API_BASE = "https://rep-api.forrt.org";
const BATCH_SIZE = 50;

/**
 * Look up replication data for a batch of DOIs.
 * Uses the FORRT replication API: GET /v1/original-lookup?dois=doi1,doi2,...
 * Splits into batches of 50 to avoid 414 URI-too-long errors.
 */
export async function lookupDOIs(
  dois: DoiString[]
): Promise<Map<DoiString, ReplicationResult>> {
  if (dois.length === 0) {
    return new Map();
  }

  const results = new Map<DoiString, ReplicationResult>();
  const totalBatches = Math.ceil(dois.length / BATCH_SIZE);
  debugLog(`Looking up ${dois.length} DOIs in ${totalBatches} batch(es) of ${BATCH_SIZE}`);

  for (let i = 0; i < dois.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = dois.slice(i, i + BATCH_SIZE);
    debugLog(`Batch ${batchNum}/${totalBatches}: ${batch.length} DOIs`);
    try {
      const batchResults = await lookupBatch(batch);
      for (const [doi, result] of batchResults) {
        results.set(doi, result);
      }
      debugLog(`Batch ${batchNum} returned ${batchResults.size} results`);
    } catch (err) {
      debugError(`Batch ${batchNum} failed:`, err);
    }
  }

  debugLog(`Total results across all batches: ${results.size}`);
  return results;
}

async function lookupBatch(
  dois: DoiString[]
): Promise<Map<DoiString, ReplicationResult>> {
  const doisParam = dois.join(",");
  const response = await fetch(
    `${API_BASE}/v1/original-lookup?dois=${encodeURIComponent(doisParam)}`
  );

  if (!response.ok) {
    throw new Error(`FLoRA API error: ${response.status}`);
  }

  const raw = await response.json();
  const parsed = ApiResponseSchema.parse(raw);

  const results = new Map<DoiString, ReplicationResult>();
  for (const [doi, result] of Object.entries(parsed.results)) {
    if (result !== null) {
      results.set(doi.toLowerCase() as DoiString, result);
    }
  }

  return results;
}
