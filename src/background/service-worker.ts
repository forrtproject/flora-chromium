import {LocalCache, MONTH_MS} from "@shared/cache";
import {lookupDOIs} from "@shared/flora-api";
import {RET_MAP_KEY, storageSync, type RetractionMaps} from "@shared/data-extract";
import type {DoiString, ReplicationResult, RetractionResponse} from "@shared/types";
import {LookupResponse, RetractionCheckResponse, SheetFetchResponse, AugmentResponse, AugmentRequest} from "@shared/messages";
import {isLookupRequest, isRetractionCheckRequest, isSheetFetchRequest, isAugmentRequest, isProxyFetchRequest} from "@shared/messages";
import {augmentDOIs} from "@shared/doi-augment";
import {handleProxyFetch} from "./proxy-fetch";
import {getSettings, isSetupComplete} from "@shared/settings";
import {fetchWithTimeout} from "@shared/fetch-timeout";
import {debugError} from "@shared/debug";

const cache = new LocalCache<ReplicationResult>("flora");

// Initialise cache quota from persisted settings (service worker may restart).
getSettings().then(({ cacheQuotaMb }) => {
    cache.setQuota(cacheQuotaMb === 0 ? 0 : cacheQuotaMb * 1024 * 1024);
}).catch((err) => debugError("Failed to init cache quota:", err));

// Keep quota in sync when the user changes the setting; drop the cached
// retraction source whenever a fresh map is synced into local storage.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && "flora_settings" in changes) {
        const next = (changes["flora_settings"].newValue as { cacheQuotaMb?: number } | undefined);
        if (next?.cacheQuotaMb != null) {
            cache.setQuota(next.cacheQuotaMb === 0 ? 0 : next.cacheQuotaMb * 1024 * 1024);
        }
    }
    if (area === "local" && RET_MAP_KEY in changes) {
        cachedRetractionSource = null;
    }
});

// ── Toolbar icon: maroon "F" when FLoRA is active on a tab, gray when not.
// Drawn on an OffscreenCanvas so no separate icon assets are needed.
function drawFloraIcon(size: number, active: boolean): ImageData {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const r = size * 0.22;
    ctx.fillStyle = active ? "#853953" : "#9aa0a6";
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, size - 1, size - 1, r);
    ctx.fill();
    ctx.fillStyle = active ? "#ffffff" : "#eceff1";
    ctx.font = `bold ${Math.round(size * 0.68)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("F", size / 2, size * 0.56);
    return ctx.getImageData(0, 0, size, size);
}

function setActionIcon(active: boolean, tabId?: number): void {
    let imageData: Record<number, ImageData>;
    try {
        imageData = { 16: drawFloraIcon(16, active), 32: drawFloraIcon(32, active) };
    } catch {
        return; // OffscreenCanvas unavailable — leave the default icon
    }
    const details = tabId != null ? { tabId, imageData } : { imageData };
    chrome.action.setIcon(details).catch(() => {});

    const title = active
        ? "FLoRA — active on this page"
        : "FLoRA — inactive on this page";
    chrome.action.setTitle(tabId != null ? { tabId, title } : { title }).catch(() => {});
}

// Default to inactive; an applicable page's content script flips it to active.
setActionIcon(false);

// Reset to inactive while a tab navigates — the content script re-activates it
// if the new page is applicable (so leaving a site clears the active state).
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") setActionIcon(false, tabId);
});

// Open the walkthrough on first install and seed retraction data immediately.
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        chrome.tabs.create({ url: chrome.runtime.getURL("dist/walkthrough.html") });
    }
    syncRetractionsInfo().catch((err) => debugError("Retraction sync failed:", err));
});

// Refresh retraction data once per browser session (weekly interval enforced inside).
chrome.runtime.onStartup.addListener(() => {
    syncRetractionsInfo().catch((err) => debugError("Retraction sync failed:", err));
});


/** In-flight dedup: prevents duplicate API calls for the same DOI */
const inflight = new Map<DoiString, Promise<ReplicationResult | null>>();

chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
        if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string }).type === "FLORA_ACTIVE_STATE"
        ) {
            const active = (message as { active?: boolean }).active === true;
            const tabId = sender.tab?.id;
            if (tabId != null) setActionIcon(active, tabId);
            return false;
        }

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

        if (isRetractionCheckRequest(message)) {
            handleRetractionCheck(message.dois)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_RET_CHECK_RESULT",
                        results: [],
                        error: "Service worker error",
                    } satisfies RetractionCheckResponse)
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
            chrome.storage.session.set({flora_setup_dismissed: true})
                .then(() => sendResponse({ok: true}))
                .catch(() => sendResponse({ok: false}));
            return true;
        }

        if (
            typeof message === "object" &&
            message !== null &&
            (message as { type?: string }).type === "FLORA_IS_SETUP_DISMISSED"
        ) {
            chrome.storage.session.get("flora_setup_dismissed")
                .then((result) => sendResponse({dismissed: !!result.flora_setup_dismissed}))
                .catch(() => sendResponse({dismissed: false}));
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

        if (isAugmentRequest(message)) {
            handleAugment(message.requests)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_AUGMENT_RESULT",
                        results: {},
                    } satisfies AugmentResponse)
                );
            return true;
        }

        if (isProxyFetchRequest(message)) {
            handleProxyFetch(message)
                .then(sendResponse)
                .catch(() =>
                    sendResponse({
                        type: "FLORA_PROXY_FETCH_RESULT",
                        ok: false,
                        error: "Service worker error",
                    })
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
    const awaitingInflight: DoiString[] = [];

    // One batched cache read for every DOI (a single chrome.storage.local.get)
    // instead of one round-trip per DOI. We only persist matched results, so a
    // truthy cache hit is a real result. A null entry (legacy negative cache) or
    // a miss both fall through to re-query, so newly added FORRT data surfaces.
    const cachedMap = await cache.getMany(dois);

    // Synchronous classification pass: no awaits interleave between reading the
    // in-flight map and registering new entries below, so two lookups for the
    // same DOI can't both slip past the check and each fire the API (stampede).
    for (const doi of dois) {
        const cached = cachedMap.get(doi);
        if (cached) {
            results[doi] = cached;
        } else if (inflight.has(doi)) {
            awaitingInflight.push(doi);
        } else {
            toFetch.push(doi);
        }
    }

    // Register every to-fetch DOI as in-flight BEFORE any further await, so a
    // concurrent lookup arriving now sees them as in-flight rather than
    // re-fetching. (catch prevents unhandled rejection — the try/catch below
    // handles the actual error reporting.)
    const batchPromise = toFetch.length > 0 ? lookupDOIs(toFetch) : null;
    if (batchPromise) {
        for (const doi of toFetch) {
            inflight.set(
                doi,
                batchPromise.then((map) => map.get(doi) ?? null).catch(() => null)
            );
        }
    }

    // Now it's safe to await: collect results for DOIs a prior call is fetching.
    for (const doi of awaitingInflight) {
        const r = await inflight.get(doi)!;
        if (r) results[doi] = r;
    }

    if (!batchPromise) {
        return {type: "FLORA_LOOKUP_RESULT", results, errors};
    }

    try {
        const apiResults = await batchPromise;

        for (const doi of toFetch) {
            const r = apiResults.get(doi);
            if (r) {
                results[doi] = r;
                // Cache the result with a finite TTL. A cache-WRITE failure
                // (e.g. storage quota) must never demote a successful lookup to
                // an error: the result is already in `results`, so we swallow
                // the write error here rather than letting it hit the outer
                // catch (which would mark the whole batch as failed).
                try {
                    await cache.set(doi, r, MONTH_MS);
                } catch {
                    // Non-fatal: the result stands; we just re-fetch next time.
                }
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

async function handleAugment(
    requests: AugmentRequest["requests"]
): Promise<AugmentResponse> {
    const resultMap = await augmentDOIs(requests);
    const results: Record<string, string | null> = {};
    for (const [title, doi] of resultMap) results[title] = doi ?? null;
    return { type: "FLORA_AUGMENT_RESULT", results };
}

async function handleSheetFetch(
    spreadsheetId: string,
    gid: string
): Promise<SheetFetchResponse> {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    try {
        const resp = await fetchWithTimeout(url, {credentials: "include"});
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

// ── Retraction lookups ──────────────────────────────────────────────────────
// Retraction data lives in the service worker so the multi-megabyte
// `retractions.json` never ships inside content bundles. Content scripts ask
// for a verdict via FLORA_RET_CHECK; the worker reads the synced map (falling
// back to the bundled JSON), tags each hit as a retraction or concern, and
// returns the notice DOIs.

/**
 * Retraction Watch publishes DOIs in their original publisher case (SICI-style
 * Elsevier identifiers, NEJM, ASCE, etc. carry uppercase letters), but every
 * DOI we look up has been through normaliseDOI() which lowercases it. Without
 * normalising the source keys too, ~12.7k of the ~58.6k retractions would
 * never match.
 */
function lowercaseKeys(obj: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!obj) return out;
    for (const k in obj) out[k.toLowerCase()] = obj[k];
    return out;
}

// Normalised retraction source, cached so lowercaseKeys runs once per sync
// rather than once per lookup. Invalidated by the storage.onChanged listener
// above whenever a fresh map is written.
let cachedRetractionSource: RetractionMaps | null = null;

// The bundled fallback is fetched lazily (not statically imported) so it stays
// out of the worker bundle until the very first install before any sync.
let bundledRetractionMapPromise: Promise<RetractionMaps> | null = null;

async function loadBundledRetractionMap(): Promise<RetractionMaps> {
    if (!bundledRetractionMapPromise) {
        bundledRetractionMapPromise = (async () => {
            const response = await fetch(chrome.runtime.getURL("dist/retractions.json"));
            if (!response.ok) {
                throw new Error(`Failed to load bundled retractions: ${response.status}`);
            }
            const data = await response.json() as RetractionMaps;
            return {
                retractions: lowercaseKeys(data.retractions),
                concerns: lowercaseKeys(data.concerns),
            };
        })();
    }
    try {
        return await bundledRetractionMapPromise;
    } catch (error) {
        bundledRetractionMapPromise = null; // allow a retry on the next call
        throw error;
    }
}

async function getRetractionSource(): Promise<RetractionMaps> {
    if (cachedRetractionSource) return cachedRetractionSource;

    const storageResult = await chrome.storage.local.get([RET_MAP_KEY]);
    const stored = storageResult[RET_MAP_KEY] as RetractionMaps | undefined;
    const hasStoredData = !!stored && (
        Object.keys(stored.retractions || {}).length > 0 ||
        Object.keys(stored.concerns || {}).length > 0
    );

    if (hasStoredData) {
        cachedRetractionSource = {
            retractions: lowercaseKeys(stored!.retractions),
            concerns: lowercaseKeys(stored!.concerns),
        };
        return cachedRetractionSource;
    }

    // Nothing synced yet: kick off a sync for next time and answer from the
    // bundled JSON now. Don't cache the fallback — onChanged will pick up the
    // synced map, but until then we re-read so an in-flight sync is noticed.
    syncRetractionsInfo().catch((err) => debugError("Retraction sync failed:", err));
    return loadBundledRetractionMap();
}

async function handleRetractionCheck(dois: DoiString[]): Promise<RetractionCheckResponse> {
    let source: RetractionMaps;
    try {
        source = await getRetractionSource();
    } catch {
        return {type: "FLORA_RET_CHECK_RESULT", results: [], error: "Retraction data unavailable"};
    }

    const results: RetractionResponse[] = [];
    for (const doi of dois) {
        const retractionDoi = source.retractions[doi];
        if (retractionDoi) {
            results.push({originDoi: doi, doi: retractionDoi, kind: "retraction"});
            continue;
        }
        const concernDoi = source.concerns?.[doi];
        if (concernDoi) {
            results.push({originDoi: doi, doi: concernDoi, kind: "concern"});
        }
    }
    return {type: "FLORA_RET_CHECK_RESULT", results};
}

// A single in-flight sync shared across onInstalled/onStartup/getRetractionSource.
// Without this, several triggers can each fetch + write the ~3.6MB retraction
// map concurrently. While a sync is running, later callers await the same
// promise instead of starting their own.
let syncInFlight: Promise<void> | null = null;

export function syncRetractionsInfo(): Promise<void> {
    if (syncInFlight) return syncInFlight;
    syncInFlight = runRetractionSync().finally(() => {
        syncInFlight = null;
    });
    return syncInFlight;
}

async function runRetractionSync(): Promise<void> {
    const minInterval = 1000 * 60 * 60 * 24 * 7; // weekly
    const currentTime = Date.now();
    const previous = await chrome.storage.local.get(["synctime"]) ?? 0;
    const lastSync = previous.synctime || 0;
    const nextUpdate = lastSync + minInterval;
    const storageResult = await chrome.storage.local.get(RET_MAP_KEY);
    const map = storageResult[RET_MAP_KEY] as RetractionMaps | undefined;
    const isEmpty = !map || (
        Object.keys(map.retractions || {}).length === 0 &&
        Object.keys(map.concerns || {}).length === 0
    );
    if (isEmpty || currentTime > nextUpdate) {
        const synced = await storageSync();
        if (synced) await chrome.storage.local.set({synctime: currentTime});
    }
}
