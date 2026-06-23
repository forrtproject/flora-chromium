import type {DoiString, ReplicationResult, RetractionResponse} from "./types";

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

/** Content script → service worker: request retraction status for DOI(s) */
export interface RetractionCheckRequest {
    type: "FLORA_RET_CHECK";
    dois: DoiString[];
}

/** Service worker → content script: retraction lookup results */
export interface RetractionCheckResponse {
    type: "FLORA_RET_CHECK_RESULT";
    results: RetractionResponse[];
    error?: string;
}

/** Content script → service worker: fetch Google Sheet CSV for DOI extraction */
export interface SheetFetchRequest {
    type: "FLORA_SHEET_FETCH";
    spreadsheetId: string;
    gid: string;
}

/** Service worker → content script: raw CSV text */
export interface SheetFetchResponse {
    type: "FLORA_SHEET_FETCH_RESULT";
    csv: string | null;
    error: string | null;
}

export function isLookupRequest(msg: unknown): msg is LookupRequest {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "FLORA_LOOKUP"
    );
}

export function isRetractionCheckRequest(msg: unknown): msg is RetractionCheckRequest {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "FLORA_RET_CHECK"
    );
}

export function isSheetFetchRequest(msg: unknown): msg is SheetFetchRequest {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "FLORA_SHEET_FETCH"
    );
}
