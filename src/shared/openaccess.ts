// Open Access status for a DOI via Unpaywall, cached in chrome.storage.local.
// Used to surface a lock/unlock icon next to the DOIs we inject on the page.

import { getSettings } from "./settings";
import { BlobCache } from "./blob-cache";

export interface OpenAccessLocation {
    /** Free full-text URL — the PDF when the location offers one. */
    url: string;
    /** Where the copy lives: publisher name, repository, or the bare host. */
    label: string;
    /** Author manuscript / published version, when Unpaywall states it. */
    version: string | null;
    isPdf: boolean;
}

export interface OpenAccessStatus {
    /** True when Unpaywall reports a free full-text location. */
    isOa: boolean;
    /** Best free full-text URL (PDF preferred), or null. */
    url: string | null;
    /**
     * Every free copy Unpaywall lists, best first. Absent on entries cached by
     * an older version, which stored only `url`.
     */
    locations?: OpenAccessLocation[];
}

interface UnpaywallLocation {
    url?: string | null;
    url_for_pdf?: string | null;
    host_type?: string | null;
    version?: string | null;
    repository_institution?: string | null;
}

const VERSION_LABELS: Record<string, string> = {
    publishedVersion: "published",
    acceptedVersion: "accepted",
    submittedVersion: "submitted",
};

function hostLabel(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "Free copy";
    }
}

function toLocation(raw: UnpaywallLocation): OpenAccessLocation | null {
    const url = raw.url_for_pdf ?? raw.url ?? null;
    if (!url) return null;
    const institution = raw.repository_institution?.trim();
    return {
        url,
        label: institution || (raw.host_type === "publisher" ? "Publisher" : hostLabel(url)),
        version: raw.version ? VERSION_LABELS[raw.version] ?? null : null,
        isPdf: !!raw.url_for_pdf,
    };
}

/** Unpaywall lists the same copy under several locations; one row each is noise. */
function dedupeByUrl(locations: OpenAccessLocation[]): OpenAccessLocation[] {
    const seen = new Set<string>();
    return locations.filter((loc) => !seen.has(loc.url) && seen.add(loc.url));
}

const OA_CACHE = new BlobCache<OpenAccessStatus>({
    storageKey: "flora_oa_blob",
    ttlMs: 30 * 24 * 60 * 60 * 1000, // 30 days — OA status changes rarely
});

let _cachedEmail: string | null = null;
async function getUserEmail(): Promise<string> {
    if (_cachedEmail) return _cachedEmail;
    const { email } = await getSettings();
    _cachedEmail = email;
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
        const resp = await fetch(
            `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`
        );
        if (!resp.ok) return null;
        const data = (await resp.json()) as {
            is_oa?: boolean;
            best_oa_location?: UnpaywallLocation | null;
            oa_locations?: UnpaywallLocation[] | null;
        };
        const best = data.best_oa_location ? toLocation(data.best_oa_location) : null;
        const rest = (data.oa_locations ?? [])
            .map(toLocation)
            .filter((loc): loc is OpenAccessLocation => loc !== null);
        const locations = dedupeByUrl(best ? [best, ...rest] : rest);
        const status: OpenAccessStatus = {
            isOa: !!data.is_oa,
            url: locations[0]?.url ?? null,
            locations,
        };
        void OA_CACHE.set(doi, status);
        return status;
    } catch {
        return null;
    }
}

/** Test-only: drop in-memory cache state so each case starts fresh. */
export function _resetOpenAccessCacheForTesting(): void {
    OA_CACHE.resetForTesting();
    _cachedEmail = null;
}
