import {SessionCache} from "@shared/cache";
import {lookupDOIs} from "@shared/flora-api";
import type {DoiString, ReplicationResult} from "@shared/types";
import {
    isRetractionLookup,
    LookupResponse, RetractionLookupRequest, RetractionLookupResponse,
    SheetFetchResponse
} from "@shared/messages";
import {isLookupRequest, isSheetFetchRequest} from "@shared/messages";
import {isSetupComplete} from "@shared/settings";
import {retractionWatchLookup} from "@shared/doi-augment";

const cache = new SessionCache<ReplicationResult>("flora");

// Open the walkthrough on first install
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        chrome.tabs.create({ url: chrome.runtime.getURL("dist/walkthrough.html") });
    }
});

/** In-flight dedup: prevents duplicate API calls for the same DOI */
const inflight = new Map<DoiString, Promise<ReplicationResult | null>>();

chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
        if (isLookupRequest(message)) {
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
            return true;
        }

        if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string }).type === "FLORA_OPEN_OPTIONS"
        ) {
            chrome.runtime.openOptionsPage();
            return false;
        }

        if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string }).type === "FLORA_DISMISS_SETUP"
        ) {
            chrome.storage.session.set({flora_setup_dismissed: true}).then(() => {
                sendResponse({ok: true});
            });
            return true;
        }

        if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string }).type === "FLORA_IS_SETUP_DISMISSED"
        ) {
            chrome.storage.session.get("flora_setup_dismissed").then((result) => {
                sendResponse({dismissed: !!result.flora_setup_dismissed});
            });
            return true;
        }
        if (isRetractionLookup(message)) {
            const doi = (message as RetractionLookupRequest).doi;
            const key = doi + "_red";
            chrome.storage.local.get(key, result => {
                if (result && result.redacted)
                    sendResponse(result);
                else retractionWatchLookup(doi)
                    .then(result => {
                        if (result?.retracted) {
                            chrome.storage.local.set({[key]: result}, () => {
                            });
                        }
                        sendResponse(result)
                    }).catch();
            });
            return true;
        }

        if (isSheetFetchRequest(message)) {
            handleSheetFetch(message.spreadsheetId, message.gid)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_SHEET_FETCH_RESULT",
                        csv: null,
                        error: "Failed to fetch spreadsheet data",
                    } satisfies SheetFetchResponse)
                );
            return true;
        }

        return false;
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
        return {type: "FLORA_LOOKUP_RESULT", results, errors};
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

    return {type: "FLORA_LOOKUP_RESULT", results, errors};
}

async function handleSheetFetch(
    spreadsheetId: string,
    gid: string
): Promise<SheetFetchResponse> {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    try {
        const resp = await fetch(url, {credentials: "include"});
        if (!resp.ok) {
            return {
                type: "FLORA_SHEET_FETCH_RESULT",
                csv: null,
                error: `HTTP ${resp.status}`
            };
        }
        const csv = await resp.text();
        return {type: "FLORA_SHEET_FETCH_RESULT", csv, error: null};
    } catch (err) {
        return {
            type: "FLORA_SHEET_FETCH_RESULT",
            csv: null,
            error: err instanceof Error ? err.message : "Fetch failed",
        };
    }
}
