// Single chrome.storage.local key holding a JSON object of all entries.
// Cross-context concurrent writes are last-writer-wins on the whole blob —
// acceptable for a cache (lost write = re-fetch).

import {debugLog} from "./debug";

interface CacheEntry<T> {
    v: T;
    t: number;
}

type CacheBlob<T> = Record<string, CacheEntry<T>>;

export interface BlobCacheOptions {
    storageKey: string;
    ttlMs: number;
    /** One-shot cleanup of legacy per-row keys from the pre-blob cache shape. */
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
            // best-effort
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
            // Likely storage quota. Attempt one recovery: evict the oldest half
            // of this blob's entries (by timestamp) and retry the write once.
            this.evictOldestHalf();
            try {
                await chrome.storage.local.set({[this.opts.storageKey]: this.mem});
            } catch {
                debugLog(
                    `BlobCache(${this.opts.storageKey}): write failed after evicting oldest half; keeping in-memory copy only`
                );
            }
        }
    }

    private evictOldestHalf(): void {
        if (!this.mem) return;
        const keys = Object.keys(this.mem);
        if (keys.length <= 1) return;
        keys.sort((a, b) => this.mem![a].t - this.mem![b].t);
        const dropCount = Math.floor(keys.length / 2);
        for (let i = 0; i < dropCount; i++) {
            delete this.mem[keys[i]];
        }
    }

    resetForTesting(): void {
        this.mem = null;
        this.loading = null;
    }
}
