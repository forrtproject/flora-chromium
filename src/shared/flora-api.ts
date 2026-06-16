import { z } from "zod";
import type { DoiString, ReplicationResult } from "./types";
import { ReplicationResultSchema } from "./types";
import { debugLog, debugError } from "./debug";

// Loose envelope — validate each result individually below so one malformed
// entry can't fail the whole batch.
const ResponseEnvelopeSchema = z.object({
  results: z.record(z.string(), z.unknown()),
});

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
  const envelope = ResponseEnvelopeSchema.parse(raw);

  const results = new Map<DoiString, ReplicationResult>();
  for (const [doi, rawResult] of Object.entries(envelope.results)) {
    if (rawResult == null) continue; // genuine no-record for this DOI
    const parsed = ReplicationResultSchema.safeParse(rawResult);
    if (parsed.success) {
      results.set(doi.toLowerCase() as DoiString, parsed.data);
    } else {
      // Skip a malformed entry rather than failing every DOI in the batch.
      debugError(`FLoRA API: skipping malformed result for ${doi}:`, parsed.error.issues);
    }
  }

  return results;
}
