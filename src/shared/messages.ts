import type { DoiString, ReplicationResult } from "./types";

/** Content script → service worker: request DOI lookups */
export interface LookupRequest {
  type: "FLORA_LOOKUP";
  dois: DoiString[];
}

/** Service worker → content script: lookup results */
export interface LookupResponse {
  type: "FLORA_LOOKUP_RESULT";
  results: Record<string, ReplicationResult>;
  errors: Record<string, string>;
}

export function isLookupRequest(msg: unknown): msg is LookupRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as Record<string, unknown>).type === "FLORA_LOOKUP"
  );
}
