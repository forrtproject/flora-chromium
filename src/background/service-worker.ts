import {LocalCache} from "@shared/cache";
import {lookupDOIs} from "@shared/flora-api";
import {RET_MAP_KEY, storageSync} from "@shared/data-extract";
import type {DoiString, ReplicationResult} from "@shared/types";
import {LookupResponse, SheetFetchResponse} from "@shared/messages";
import {isLookupRequest, isSheetFetchRequest} from "@shared/messages";
import {getSettings, isSetupComplete} from "@shared/settings";

const cache = new LocalCache<ReplicationResult>("flora");

// Initialise cache quota from persisted settings (service worker may restart).
getSettings().then(({ cacheQuotaMb }) => {
    cache.setQuota(cacheQuotaMb === 0 ? 0 : cacheQuotaMb * 1024 * 1024);
}).catch();

// Keep quota in sync when the user changes the setting.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && "flora_settings" in changes) {
        const next = (changes["flora_settings"].newValue as { cacheQuotaMb?: number } | undefined);
        if (next?.cacheQuotaMb != null) {
            cache.setQuota(next.cacheQuotaMb === 0 ? 0 : next.cacheQuotaMb * 1024 * 1024);
        }
    }
});

// Open the walkthrough on first install and seed retraction data immediately.
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        chrome.tabs.create({ url: chrome.runtime.getURL("dist/walkthrough.html") });
    }
    syncRetractionsInfo().then().catch();
});

// Refresh retraction data once per browser session (weekly interval enforced inside).
chrome.runtime.onStartup.addListener(() => {
    syncRetractionsInfo().then().catch();
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

    // Check cache and in-flight requests. We only persist matched results, so a
    // truthy cache hit is a real result. A null entry (legacy negative cache) or
    // a miss both fall through to re-query, so newly added FORRT data surfaces.
    for (const doi of dois) {
        const cached = await cache.get(doi);
        if (cached) {
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
                await cache.set(doi, r, null); // resolved — cache forever
            }
            // No result (no record yet, or a transient batch failure): do NOT
            // cache. We re-query every time so newly added FORRT data surfaces
            // instead of being suppressed by a stale negative cache entry.
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

export async function syncRetractionsInfo() {
    const minInterval = 1000 * 60 * 60 * 24 * 7; // weekly
    const currentTime = Date.now();
    const previous = await chrome.storage.local.get(["synctime"]) ?? 0;
    const lastSync = previous.synctime || 0;
    const nextUpdate = lastSync + minInterval;
    const storageResult = await chrome.storage.local.get(RET_MAP_KEY);
    if (Object.keys(storageResult).length === 0 || currentTime > nextUpdate) {
        await storageSync();
        await chrome.storage.local.set({synctime: currentTime});
    }
}
