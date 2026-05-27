/**
 * BlobCache — a single chrome.storage.local key holding a JSON object map
 * of all entries for a given cache. Collapses what used to be hundreds of
 * `prefix:<key>` rows into one entry per cache so the storage view stays
 * readable.
 *
 * Each entry carries a timestamp; reads honour the supplied TTL and lazily
 * evict expired entries on access. The in-memory map is loaded once per
 * script lifetime; writes serialize the whole blob back to storage.
 *
 * Trade-off: cross-context concurrent writes can clobber each other
 * (last-writer-wins on the whole blob). For a cache this is acceptable —
 * a lost write just means a subsequent re-fetch.
 */

interface CacheEntry<T> {
    /** value */
    v: T;
    /** timestamp (ms since epoch) */
    t: number;
}

type CacheBlob<T> = Record<string, CacheEntry<T>>;

export interface BlobCacheOptions {
    /** chrome.storage.local key under which the whole blob lives. */
    storageKey: string;
    /** Max entry age before it's treated as missing. */
    ttlMs: number;
    /**
     * Optional one-shot cleanup: legacy per-row prefixes (e.g. "flora_doi:")
     * left behind by the pre-consolidation cache shape. Cleared the first
     * time this cache is loaded after the upgrade.
     */
    legacyPrefixes?: string[];
}

export class BlobCache<T> {
    private mem: CacheBlob<T> | null = null;
    private loading: Promise<void> | null = null;

    constructor(private readonly opts: BlobCacheOptions) {}

    private async ensureLoaded(): Promise<void> {
        if (this.mem) return;
        if (!this.loading) {
            this.loading = this.load();
        }
        await this.loading;
    }

    private async load(): Promise<void> {
        try {
            const raw = await chrome.storage.local.get(this.opts.storageKey);
            const blob = raw[this.opts.storageKey] as CacheBlob<T> | undefined;
            this.mem = blob && typeof blob === "object" ? blob : {};
        } catch {
            this.mem = {};
        }
        // Fire-and-forget legacy cleanup — never blocks reads/writes.
        if (this.opts.legacyPrefixes && this.opts.legacyPrefixes.length > 0) {
            void this.sweepLegacy(this.opts.legacyPrefixes);
        }
    }

    private async sweepLegacy(prefixes: string[]): Promise<void> {
        try {
            const all = await chrome.storage.local.get(null);
            const stale = Object.keys(all).filter((k) =>
                prefixes.some((p) => k.startsWith(p))
            );
            if (stale.length > 0) {
                await chrome.storage.local.remove(stale);
            }
        } catch {
            // Best-effort cleanup; ignore failures.
        }
    }

    async get(key: string): Promise<T | undefined> {
        await this.ensureLoaded();
        const entry = this.mem![key];
        if (!entry) return undefined;
        if (Date.now() - entry.t > this.opts.ttlMs) {
            delete this.mem![key];
            void this.flush();
            return undefined;
        }
        return entry.v;
    }

    async getMany(keys: string[]): Promise<Map<string, T>> {
        await this.ensureLoaded();
        const out = new Map<string, T>();
        const now = Date.now();
        let mutated = false;
        for (const key of keys) {
            const entry = this.mem![key];
            if (!entry) continue;
            if (now - entry.t > this.opts.ttlMs) {
                delete this.mem![key];
                mutated = true;
                continue;
            }
            out.set(key, entry.v);
        }
        if (mutated) void this.flush();
        return out;
    }

    async set(key: string, value: T): Promise<void> {
        await this.ensureLoaded();
        this.mem![key] = {v: value, t: Date.now()};
        await this.flush();
    }

    /** Write many entries with a single blob flush. */
    async setMany(entries: Iterable<[string, T]>): Promise<void> {
        await this.ensureLoaded();
        const now = Date.now();
        for (const [key, value] of entries) {
            this.mem![key] = {v: value, t: now};
        }
        await this.flush();
    }

    private async flush(): Promise<void> {
        if (!this.mem) return;
        try {
            await chrome.storage.local.set({[this.opts.storageKey]: this.mem});
        } catch {
            // Storage write failures are non-fatal for a cache.
        }
    }

    /**
     * Drop the in-memory view so the next access re-reads from storage.
     * Used by tests to isolate cache state between cases.
     */
    resetForTesting(): void {
        this.mem = null;
        this.loading = null;
    }
}
