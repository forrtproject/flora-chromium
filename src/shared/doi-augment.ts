import type {DoiString, DoiAugmentRequest} from "./types";
import {normaliseDOI} from "./doi-normalise";
import {getSettings} from "./settings";
import {BlobCache} from "./blob-cache";
import {isWorkerContext, proxyFetch} from "./messages";

const OPENALEX_BASE = "https://api.openalex.org/works";
const CROSSREF_BASE = "https://api.crossref.org/works";
const MATCH_THRESHOLD_TSR = 88; // token_set_ratio threshold (0–100)
// When page metadata (author/year) is available we accept candidates within this
// many points of the top title score, then let the metadata break the tie.
const METADATA_TITLE_BAND = 5;

const DOI_AUGMENT_CACHE = new BlobCache<CachedDoiResult>({
    storageKey: "flora_doi_blob",
    ttlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    legacyPrefixes: ["flora_doi:"],
});

/** Cached email — refreshed once per page/worker lifecycle. */
let _cachedEmail: string | null = null;

interface CachedDoiResult {
    found: boolean;
    doi: string | null;
}

// DoiAugmentRequest is defined in types.ts and re-exported for callers that
// import it from this module (preserves the public API surface).
export type { DoiAugmentRequest } from "./types";

interface DoiCandidate {
    doi: DoiString;
    title: string;
    score: number;
    source: "crossref" | "openalex";
    firstAuthor?: string | null;
    year?: number | null;
    urls?: string[];
}

async function getUserEmail(): Promise<string> {
    if (_cachedEmail) return _cachedEmail;
    const {email} = await getSettings();
    _cachedEmail = email;
    return email;
}

/**
 * Normalize a title for comparison: lowercase, strip non-word chars, collapse spaces.
 */
export function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Clean a title for use in API search filters.
 * Strips characters that break filter syntax.
 */
function cleanTitleForSearch(title: string): string {
    return title
        .replace(/[:?!()\[\]&|\\,;'"]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Reduce an author string to a comparable surname: strip diacritics, drop
 * single-letter initials, and keep the last remaining token.
 */
function normalizeAuthorName(author: string | null | undefined): string {
    if (!author) return "";
    const ascii = author
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^\w\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!ascii) return "";
    const tokens = ascii.split(/\s+/).filter((token) => token && !/^[a-z]\.?$/.test(token));
    return tokens[tokens.length - 1] ?? "";
}

function normalizeRequest(input: string | DoiAugmentRequest): DoiAugmentRequest {
    if (typeof input === "string") return {title: input};
    return {
        title: input.title,
        firstAuthor: input.firstAuthor ?? null,
        year: input.year ?? null,
        sourceUrl: input.sourceUrl ?? null,
    };
}

function normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, "");
}

function urlHostname(rawUrl: string | null | undefined): string {
    try {
        return rawUrl ? normalizeHostname(new URL(rawUrl).hostname) : "";
    } catch {
        return "";
    }
}

/**
 * True when a candidate is corroborated by the request's source URL: either the
 * URL embeds the candidate's DOI, or the URL's host matches one of the
 * candidate's landing/PDF hosts (ignoring doi.org redirectors).
 */
function candidateMatchesSourceUrl(request: DoiAugmentRequest, candidate: DoiCandidate): boolean {
    if (!request.sourceUrl) return false;
    const sourceDoi = normaliseDOI(request.sourceUrl);
    if (sourceDoi && sourceDoi === candidate.doi) return true;

    const sourceHost = urlHostname(request.sourceUrl);
    if (!sourceHost || sourceHost === "doi.org" || sourceHost === "dx.doi.org") return false;
    return (candidate.urls ?? []).some((candidateUrl) => urlHostname(candidateUrl) === sourceHost);
}

function yearsMatch(expected: number | null | undefined, actual: number | null | undefined): boolean {
    return typeof expected === "number" && typeof actual === "number" && Math.abs(expected - actual) <= 1;
}

function authorsMatch(expected: string | null | undefined, actual: string | null | undefined): boolean {
    const expectedAuthor = normalizeAuthorName(expected);
    const actualAuthor = normalizeAuthorName(actual);
    return expectedAuthor.length > 0 && actualAuthor.length > 0 && expectedAuthor === actualAuthor;
}

/** Title score plus small bonuses for corroborating metadata. */
function candidateMerit(request: DoiAugmentRequest, candidate: DoiCandidate): number {
    let merit = candidate.score;
    if (candidateMatchesSourceUrl(request, candidate)) merit += 8;
    if (yearsMatch(request.year, candidate.year)) merit += 3;
    if (authorsMatch(request.firstAuthor, candidate.firstAuthor)) merit += 3;
    return merit;
}

/**
 * Pick the single best candidate, using page metadata to break ties between
 * similarly-titled works. Returns null when the field can't be narrowed to one
 * DOI — better to show nothing than to guess the wrong paper.
 */
function selectBestCandidate(request: DoiAugmentRequest, candidates: DoiCandidate[]): DoiCandidate | null {
    const eligible = candidates.filter((candidate) => candidate.score >= MATCH_THRESHOLD_TSR);
    if (eligible.length === 0) return null;

    const highestScore = Math.max(...eligible.map((candidate) => candidate.score));
    const titleBand = request.firstAuthor || request.year
        ? eligible.filter((candidate) => candidate.score >= highestScore - METADATA_TITLE_BAND)
        : eligible.filter((candidate) => candidate.score === highestScore);

    let narrowed = titleBand;
    if (request.sourceUrl && narrowed.some((candidate) => candidateMatchesSourceUrl(request, candidate))) {
        narrowed = narrowed.filter((candidate) => candidateMatchesSourceUrl(request, candidate));
    }
    if (request.year && narrowed.some((candidate) => yearsMatch(request.year, candidate.year))) {
        narrowed = narrowed.filter((candidate) => yearsMatch(request.year, candidate.year));
    }
    if (request.firstAuthor && narrowed.some((candidate) => authorsMatch(request.firstAuthor, candidate.firstAuthor))) {
        narrowed = narrowed.filter((candidate) => authorsMatch(request.firstAuthor, candidate.firstAuthor));
    }

    const highestMerit = Math.max(...narrowed.map((candidate) => candidateMerit(request, candidate)));
    const best = narrowed.filter((candidate) => candidateMerit(request, candidate) === highestMerit);
    const bestDois = new Set(best.map((candidate) => candidate.doi));
    if (bestDois.size !== 1) return null;

    return best[0];
}

function extractCrossrefYear(item: {
    issued?: {"date-parts"?: number[][]};
    "published-print"?: {"date-parts"?: number[][]};
    "published-online"?: {"date-parts"?: number[][]};
    published?: {"date-parts"?: number[][]};
}): number | null {
    const dateParts =
        item.issued?.["date-parts"] ??
        item["published-print"]?.["date-parts"] ??
        item["published-online"]?.["date-parts"] ??
        item.published?.["date-parts"];
    const year = dateParts?.[0]?.[0];
    return typeof year === "number" ? year : null;
}

function compactUrls(urls: Array<string | null | undefined>): string[] {
    return [...new Set(urls.filter((url): url is string => !!url))];
}

/**
 * Levenshtein-based similarity score between two strings (0 to 1).
 * 1.0 = identical, 0.0 = completely different.
 */
export function similarity(s1: string, s2: string): number {
    const longer = s1.length >= s2.length ? s1 : s2;

    if (longer.length === 0) return 1.0;

    const costs: number[] = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }

    return (longer.length - costs[s2.length]) / longer.length;
}

/**
 * Token-set-ratio fuzzy matching (pure JS port of fuzzywuzzy's token_set_ratio).
 * Tokenizes both strings, computes intersection/difference sets, and returns
 * the max Levenshtein similarity across three comparison pairs.
 * Returns a score from 0 to 100.
 */
export function tokenSetRatio(s1: string, s2: string): number {
    const tokens1 = new Set(normalizeTitle(s1).split(/\s+/).filter(Boolean));
    const tokens2 = new Set(normalizeTitle(s2).split(/\s+/).filter(Boolean));

    const intersection = [...tokens1].filter((t) => tokens2.has(t));
    const diff1 = [...tokens1].filter((t) => !tokens2.has(t));
    const diff2 = [...tokens2].filter((t) => !tokens1.has(t));

    const sortedIntersection = intersection.sort().join(" ");
    const combined1 = [sortedIntersection, ...diff1.sort()].join(" ").trim();
    const combined2 = [sortedIntersection, ...diff2.sort()].join(" ").trim();

    const r1 = similarity(sortedIntersection, combined1);
    const r2 = similarity(sortedIntersection, combined2);
    const r3 = similarity(combined1, combined2);

    return Math.max(r1, r2, r3) * 100;
}

/**
 * Query Crossref for a title, returning every candidate that clears the title
 * threshold (with author/year/URL metadata for later tie-breaking).
 */
async function queryCrossref(request: DoiAugmentRequest, email: string): Promise<DoiCandidate[]> {
    const {title} = request;
    const cleaned = cleanTitleForSearch(title);
    const url = `${CROSSREF_BASE}?query.title=${encodeURIComponent(cleaned)}&rows=5&select=DOI,title,author,issued,published-print,published-online,published,URL,link&mailto=${encodeURIComponent(email)}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = (await response.json()) as {
        message?: {
            items?: Array<{
                DOI?: string;
                title?: string[];
                author?: Array<{family?: string; given?: string; name?: string}>;
                issued?: {"date-parts"?: number[][]};
                "published-print"?: {"date-parts"?: number[][]};
                "published-online"?: {"date-parts"?: number[][]};
                published?: {"date-parts"?: number[][]};
                URL?: string;
                link?: Array<{URL?: string}>;
            }>;
        };
    };

    const items = data.message?.items ?? [];
    const candidates: DoiCandidate[] = [];

    for (const item of items) {
        if (!item.DOI || !item.title?.[0]) continue;

        const tsr = tokenSetRatio(title, item.title[0]);
        if (tsr >= MATCH_THRESHOLD_TSR) {
            const doi = normaliseDOI(item.DOI);
            if (doi) {
                candidates.push({
                    doi,
                    title: item.title[0],
                    score: tsr,
                    source: "crossref",
                    firstAuthor: item.author?.[0]?.family ?? item.author?.[0]?.name ?? null,
                    year: extractCrossrefYear(item),
                    urls: compactUrls([item.URL, ...(item.link ?? []).map((link) => link.URL)]),
                });
            }
        }
    }

    return candidates;
}

/**
 * Query OpenAlex for a title, returning every candidate that clears the title
 * threshold (with author/year/URL metadata for later tie-breaking).
 */
async function queryOpenAlex(request: DoiAugmentRequest, email: string): Promise<DoiCandidate[]> {
    const {title} = request;
    const cleaned = cleanTitleForSearch(title);
    const url = `${OPENALEX_BASE}?filter=title.search:${encodeURIComponent(cleaned)}&select=id,doi,title,publication_year,authorships,primary_location,locations&per_page=5&mailto=${encodeURIComponent(email)}`;

    const response = await fetch(url);
    if (response.status === 429) {
        // Rate-limited — throw so Promise.allSettled marks this as rejected and
        // the caller falls back to Crossref results.
        throw new Error("OpenAlex rate limited (429)");
    }
    if (!response.ok) return [];

    const data = (await response.json()) as {
        results?: Array<{
            doi?: string;
            title?: string;
            publication_year?: number | null;
            authorships?: Array<{author?: {display_name?: string | null} | null}>;
            primary_location?: {landing_page_url?: string | null; pdf_url?: string | null} | null;
            locations?: Array<{landing_page_url?: string | null; pdf_url?: string | null}>;
        }>;
    };

    const works = data.results ?? [];
    const candidates: DoiCandidate[] = [];

    for (const work of works) {
        if (!work.doi || !work.title) continue;

        const tsr = tokenSetRatio(title, work.title);
        if (tsr >= MATCH_THRESHOLD_TSR) {
            const doi = normaliseDOI(work.doi);
            if (doi) {
                candidates.push({
                    doi,
                    title: work.title,
                    score: tsr,
                    source: "openalex",
                    firstAuthor: work.authorships?.[0]?.author?.display_name ?? null,
                    year: work.publication_year ?? null,
                    urls: compactUrls([
                        work.primary_location?.landing_page_url,
                        work.primary_location?.pdf_url,
                        ...(work.locations ?? []).flatMap((location) => [
                            location.landing_page_url,
                            location.pdf_url,
                        ]),
                    ]),
                });
            }
        }
    }

    return candidates;
}

/**
 * Augment DOIs for article titles that don't have a DOI.
 * Queries both Crossref and OpenAlex APIs in parallel, then picks
 * the best-matching candidate using token-set-ratio fuzzy scoring.
 * Returns a Map of original title -> resolved DoiString (or null if not found).
 */
export async function augmentDOIs(
    inputs: Array<string | DoiAugmentRequest>
): Promise<Map<string, DoiString | null>> {
    const results = new Map<string, DoiString | null>();
    if (inputs.length === 0) return results;
    const requests = inputs.map(normalizeRequest).filter((request) => request.title.trim());
    if (requests.length === 0) return results;

    // Check cache first — single-blob lookup keyed by normalized title. The
    // cache stays title-keyed; page metadata only influences candidate choice,
    // not the cache identity.
    const keyByTitle = new Map(requests.map((r) => [r.title, normalizeTitle(r.title)] as const));
    const cached = await DOI_AUGMENT_CACHE.getMany([...new Set(keyByTitle.values())]);

    // Group cache misses by their normalized key so titles that only differ in
    // punctuation/whitespace/case (same key) are queried once, not once each.
    const uncachedByKey = new Map<string, DoiAugmentRequest[]>();
    for (const request of requests) {
        const key = keyByTitle.get(request.title)!;
        const entry = cached.get(key);
        if (entry) {
            results.set(request.title, entry.found && entry.doi ? normaliseDOI(entry.doi) : null);
        } else {
            const group = uncachedByKey.get(key);
            if (group) group.push(request);
            else uncachedByKey.set(key, [request]);
        }
    }

    if (uncachedByKey.size === 0) return results;

    // No email means we can't query the APIs at all. Resolve every uncached
    // title to null but DO NOT write the cache: a cached no-match would
    // suppress these titles for the cache TTL (30 days) even after the user
    // configures their email.
    const email = await getUserEmail();
    if (!email) {
        for (const group of uncachedByKey.values()) {
            for (const request of group) results.set(request.title, null);
        }
        return results;
    }

    // Query each distinct title once (Crossref + OpenAlex in parallel), then use
    // the page metadata to pick the single best candidate. Cache writes are
    // accumulated and flushed once at the end.
    const updates: Array<[string, CachedDoiResult]> = [];
    const lookupPromises = [...uncachedByKey.entries()].map(async ([key, group]) => {
        const request = group[0];
        const [crossrefResult, openalexResult] = await Promise.allSettled([
            queryCrossref(request, email),
            queryOpenAlex(request, email),
        ]);

        const candidates: DoiCandidate[] = [];
        if (crossrefResult.status === "fulfilled") candidates.push(...crossrefResult.value);
        if (openalexResult.status === "fulfilled") candidates.push(...openalexResult.value);

        // Deduplicate by DOI, merging metadata across the two sources so a
        // candidate seen by both keeps the author/year/urls either provided.
        const byDoi = new Map<string, DoiCandidate>();
        for (const c of candidates) {
            const existing = byDoi.get(c.doi);
            if (!existing) {
                byDoi.set(c.doi, c);
            } else {
                byDoi.set(c.doi, {
                    ...(c.score > existing.score ? c : existing),
                    firstAuthor: existing.firstAuthor ?? c.firstAuthor,
                    year: existing.year ?? c.year,
                    urls: compactUrls([...(existing.urls ?? []), ...(c.urls ?? [])]),
                });
            }
        }

        const best = selectBestCandidate(request, [...byDoi.values()]);
        const doi = best?.doi ?? null;
        for (const r of group) results.set(r.title, doi);
        updates.push([key, {found: doi !== null, doi}]);
    });

    await Promise.allSettled(lookupPromises);

    if (updates.length > 0) await DOI_AUGMENT_CACHE.setMany(updates);

    // Defensive: set null for any titles a rejected lookup left unresolved.
    for (const request of requests) {
        if (!results.has(request.title)) results.set(request.title, null);
    }

    return results;
}


const TITLE_CACHE = new BlobCache<{ title: string | null }>({
    storageKey: "flora_title_blob",
    ttlMs: 90 * 24 * 60 * 60 * 1000, // 90 days — published titles are stable.
    legacyPrefixes: ["flora_title:"],
});

/**
 * Resolve a paper's canonical title from its DOI. Tries Crossref first, then
 * OpenAlex. Cached in chrome.storage.local since a published title never
 * changes. Returns null when neither service has the DOI.
 */
export async function fetchTitleByDoi(doi: string): Promise<string | null> {
    const cached = await TITLE_CACHE.get(doi);
    if (cached) return cached.title;

    // Direct fetch in the worker; proxy through it from content scripts, where
    // the Crossref/OpenAlex requests have no CORS bypass. A proxy failure
    // (e.g. an invalidated extension context) is transient — return null
    // without caching so a later call can retry.
    let title: string | null;
    try {
        title = isWorkerContext()
            ? await fetchTitleByDoiRaw(doi)
            : await proxyFetch<string | null>("titleByDoi", [doi]);
    } catch {
        return null;
    }

    void TITLE_CACHE.set(doi, {title});
    return title;
}

/**
 * Resolve a title from Crossref (then OpenAlex) with no caching. Runs in the
 * service worker. Returns null when neither service has the DOI.
 */
export async function fetchTitleByDoiRaw(doi: string): Promise<string | null> {
    let title: string | null = null;

    try {
        const email = await getUserEmail();
        const mailto = email ? `?mailto=${encodeURIComponent(email)}` : "";
        const response = await fetch(`${CROSSREF_BASE}/${doi}${mailto}`);
        if (response.ok) {
            const data = (await response.json()) as { message?: { title?: string[] } };
            title = data.message?.title?.[0] ?? null;
        }
    } catch {
        // Crossref failed — fall through to OpenAlex
    }

    if (!title) {
        try {
            const response = await fetch(`${OPENALEX_BASE}/doi:${doi}?select=title`);
            if (response.ok) {
                const data = (await response.json()) as { title?: string };
                title = data.title ?? null;
            }
        } catch {
            // give up — caller falls back to the DOI string
        }
    }

    return title;
}

/** Test-only: drop in-memory cache state so each case starts fresh. */
export function _resetAugmentCachesForTesting(): void {
    DOI_AUGMENT_CACHE.resetForTesting();
    TITLE_CACHE.resetForTesting();
    _cachedEmail = null;
}
