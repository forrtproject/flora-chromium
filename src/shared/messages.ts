import type {DoiString, DoiAugmentRequest, ReplicationResult, RetractionResponse} from "./types";
import {debugLog, debugError} from "./debug";

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

/** Content script → service worker: resolve DOIs from article titles */
export interface AugmentRequest {
    type: "FLORA_AUGMENT";
    requests: DoiAugmentRequest[];
}

/** Service worker → content script: title → resolved DOI (or null) */
export interface AugmentResponse {
    type: "FLORA_AUGMENT_RESULT";
    results: Record<string, string | null>;
}

export function isAugmentRequest(msg: unknown): msg is AugmentRequest {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "FLORA_AUGMENT"
    );
}

/**
 * Ask the service worker to run augmentDOIs, routing all Crossref/OpenAlex
 * fetches through the extension background context (no CORS restrictions).
 */
export async function augmentDOIsViaWorker(
    inputs: Array<string | DoiAugmentRequest>
): Promise<Map<string, DoiString | null>> {
    const requests: DoiAugmentRequest[] = inputs.map((input) =>
        typeof input === "string" ? { title: input } : input
    );
    const response = await safeSendMessage<AugmentResponse>({
        type: "FLORA_AUGMENT",
        requests,
    });
    const result = new Map<string, DoiString | null>();
    for (const [title, doi] of Object.entries(response?.results ?? {})) {
        result.set(title, doi as DoiString | null);
    }
    return result;
}

/**
 * True when an error is Chrome's "Extension context invalidated" — raised when
 * a page still holds a content script from a previous extension instance after
 * the extension was reloaded, updated, or disabled. Such errors are benign: the
 * old script can no longer reach the service worker and should quietly stop.
 */
export function isContextInvalidated(err: unknown): boolean {
    return err instanceof Error && /Extension context invalidated/i.test(err.message);
}

/**
 * `chrome.runtime.sendMessage` wrapper that swallows "Extension context
 * invalidated" rejections (resolving to `undefined`) so stale content scripts
 * don't surface uncaught promise errors after an extension reload. All other
 * errors still reject so genuine failures stay visible.
 */
export async function safeSendMessage<T = unknown>(message: unknown): Promise<T | undefined> {
    const type = (message as { type?: string } | null)?.type ?? "(untyped)";
    debugLog("sendMessage →", type, message);
    try {
        const response = (await chrome.runtime.sendMessage(message)) as T;
        debugLog("sendMessage ←", type, response);
        return response;
    } catch (err) {
        if (isContextInvalidated(err)) {
            debugLog("sendMessage ✗", type, "— extension context invalidated");
            return undefined;
        }
        debugError("sendMessage ✗", type, err);
        throw err;
    }
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
