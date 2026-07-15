// Open Access status for a DOI via Unpaywall, cached in chrome.storage.local.
// Used to surface a lock/unlock icon next to the DOIs we inject on the page.

import { getSettings } from "./settings";
import { BlobCache } from "./blob-cache";
import { isWorkerContext, proxyFetch } from "./messages";
import { fetchWithTimeout } from "./fetch-timeout";

export interface OpenAccessStatus {
    /** True when Unpaywall reports a free full-text location. */
    isOa: boolean;
    /** Best free full-text URL (PDF preferred), or null. */
    url: string | null;
}

const OA_CACHE = new BlobCache<OpenAccessStatus>({
    storageKey: "flora_oa_blob",
    ttlMs: 30 * 24 * 60 * 60 * 1000, // 30 days — OA status changes rarely
});

// getSettings() already caches settings in module state and invalidates that
// cache via chrome.storage.onChanged, so it's cheap to call every time and
// never goes stale — no second email cache of our own to keep in sync.
async function getUserEmail(): Promise<string> {
    const { email } = await getSettings();
    return email;
}

/**
 * Resolve a DOI's Open Access status via Unpaywall (cached). Returns null when
 * the lookup can't be performed (no email configured, or the request failed) so
 * callers can choose to render nothing rather than a misleading "no access".
 */
export async function fetchOpenAccess(doi: string): Promise<OpenAccessStatus | null> {
    const cached = await OA_CACHE.get(doi);
    if (cached) return cached;

    const email = await getUserEmail();
    if (!email) return null;

    try {
        // Direct fetch in the worker; proxy through it from content scripts,
        // where a page-context cross-origin request has no CORS bypass (and is
        // dropped by Opera's built-in ad/tracker blocker).
        const status = isWorkerContext()
            ? await fetchOpenAccessRaw(doi, email)
            : await proxyFetch<OpenAccessStatus | null>("openAccess", [doi, email]);
        if (status) void OA_CACHE.set(doi, status);
        return status;
    } catch {
        return null;
    }
}

/**
 * Perform the Unpaywall network request (no caching). Runs in the service
 * worker — either directly for worker-side callers or via the proxy handler on
 * behalf of a content script. Returns null when the lookup fails.
 */
export async function fetchOpenAccessRaw(
    doi: string,
    email: string
): Promise<OpenAccessStatus | null> {
    const resp = await fetchWithTimeout(
        `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
        is_oa?: boolean;
        best_oa_location?: { url_for_pdf?: string | null; url?: string | null } | null;
    };
    return {
        isOa: !!data.is_oa,
        url: data.best_oa_location?.url_for_pdf ?? data.best_oa_location?.url ?? null,
    };
}

/** Test-only: drop in-memory cache state so each case starts fresh. */
export function _resetOpenAccessCacheForTesting(): void {
    OA_CACHE.resetForTesting();
}
