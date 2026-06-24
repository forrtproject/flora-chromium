import type {DoiString, ReplicationResult} from "./types";

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
    try {
        return (await chrome.runtime.sendMessage(message)) as T;
    } catch (err) {
        if (isContextInvalidated(err)) return undefined;
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

export function isSheetFetchRequest(msg: unknown): msg is SheetFetchRequest {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "FLORA_SHEET_FETCH"
    );
}
