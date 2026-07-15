import type {DoiString, DoiAugmentRequest, ReplicationResult, RetractionResponse} from "./types";

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

/**
 * Identifies which cross-origin fetch a proxy request should perform in the
 * service worker. MV3 content scripts get no host-permission CORS bypass, so
 * every remote fetch below runs in the background context (see proxy-fetch.ts).
 */
export type ProxyFetcherId = "openAccess" | "pubpeer" | "validateDois" | "titleByDoi";

/** Content script → service worker: run a cross-origin fetch in the worker. */
export interface ProxyFetchRequest {
    type: "FLORA_PROXY_FETCH";
    fetcher: ProxyFetcherId;
    /** Fetcher-specific arguments, forwarded verbatim to the worker handler. */
    args: unknown[];
}

/** Service worker → content script: proxied fetch result (structured-clone-safe). */
export interface ProxyFetchResponse {
    type: "FLORA_PROXY_FETCH_RESULT";
    ok: boolean;
    /** Serializable payload on success. */
    data?: unknown;
    /** Human-readable error on failure. */
    error?: string;
    /** PubPeer 429 back-off signal, propagated so the caller can re-throw. */
    rateLimitMs?: number;
}

export function isProxyFetchRequest(msg: unknown): msg is ProxyFetchRequest {
    return (
        typeof msg === "object" &&
        msg !== null &&
        (msg as Record<string, unknown>).type === "FLORA_PROXY_FETCH"
    );
}

/**
 * True when running in the extension service worker (no DOM / `window`).
 * Shared modules bundled into both content scripts and the worker use this to
 * decide whether to fetch directly (worker) or proxy through the worker
 * (content script), where cross-origin fetches would otherwise be CORS-bound.
 */
export function isWorkerContext(): boolean {
    return typeof window === "undefined";
}

/** Error thrown by {@link proxyFetch}; carries a rate-limit hint when present. */
export class ProxyFetchError extends Error {
    constructor(message: string, public rateLimitMs?: number) {
        super(message);
    }
}

/**
 * Content-script side: ask the service worker to perform a cross-origin fetch
 * and return its serializable result. Throws {@link ProxyFetchError} on
 * failure (including when the extension context has been invalidated).
 */
export async function proxyFetch<R>(fetcher: ProxyFetcherId, args: unknown[]): Promise<R> {
    const resp = await safeSendMessage<ProxyFetchResponse>({
        type: "FLORA_PROXY_FETCH",
        fetcher,
        args,
    });
    if (!resp) {
        // safeSendMessage swallowed an "Extension context invalidated" reject.
        throw new ProxyFetchError("Extension context invalidated");
    }
    if (!resp.ok) {
        throw new ProxyFetchError(resp.error ?? `proxy fetch (${fetcher}) failed`, resp.rateLimitMs);
    }
    return resp.data as R;
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
