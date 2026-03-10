import type { DoiString, ReplicationResult } from "./types";
import { ApiResponseSchema } from "./types";

const API_BASE = "https://rep-api.forrt.org";

/**
 * Look up replication data for a batch of DOIs.
 * Uses the FORRT replication API: GET /v1/original-lookup?dois=doi1,doi2,...
 * Returns a Map of DOI → ReplicationResult for matched DOIs.
 */
export async function lookupDOIs(
  dois: DoiString[]
): Promise<Map<DoiString, ReplicationResult>> {
  if (dois.length === 0) {
    return new Map();
  }

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
