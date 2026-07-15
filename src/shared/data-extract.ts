import {fetchWithTimeout} from "./fetch-timeout";

export const RET_MAP_KEY = "RetractionLookupLocal"

/**
 * Prebuilt retraction data, refreshed daily by the GitHub Action
 * (`.github/workflows/update.yml` -> `retractions-updater.ts`) which parses and
 * filters the Retraction Watch CSV. The extension never parses the CSV itself;
 * it pulls this committed JSON and caches it in `chrome.storage`.
 */
const PREBUILT_JSON_URL =
    'https://raw.githubusercontent.com/forrtproject/flora-chromium/main/src/retractions.json'

/**
 * Maps from an original paper's DOI to the DOI of the notice about it.
 * Built by filtering Retraction Watch on `RetractionNature` (see
 * `retractions-updater.ts`): only papers whose latest status event is a
 * retraction or an expression of concern are kept. Corrections and reinstated
 * papers are dropped entirely.
 */
export interface RetractionMaps {
    /** originalPaperDOI -> retraction notice DOI */
    retractions: Record<string, string>;
    /** originalPaperDOI -> expression-of-concern notice DOI */
    concerns: Record<string, string>;
}

export async function fetchRetractionMap(): Promise<RetractionMaps | undefined> {
    try {
        const response = await fetchWithTimeout(PREBUILT_JSON_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data && typeof data === 'object' && data.retractions && data.concerns)
            return data as RetractionMaps;
        console.error("Unexpected retraction data shape from", PREBUILT_JSON_URL);
    } catch (error) {
        console.error("Error fetching retraction data:", error);
    }
}

export async function storageSync(): Promise<boolean> {
    const map = await fetchRetractionMap();
    if (!map) return false;
    await chrome.storage.local.set({[RET_MAP_KEY]: map});
    return true;
}
