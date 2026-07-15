import {describe, it, expect, vi, beforeEach} from "vitest";
import type {
    LookupRequest,
    LookupResponse,
    RetractionCheckResponse,
} from "../../src/shared/messages";
import type {RetractionMaps} from "../../src/shared/data-extract";
import {RET_MAP_KEY} from "../../src/shared/data-extract";
import {doi, mockResult} from "../helpers";


const MOCK_RESULT = mockResult();

// Mock flora-api before importing service worker
const mockLookupDOIs = vi.fn();
vi.mock("../../src/shared/flora-api", () => ({
    lookupDOIs: (...args: unknown[]) => mockLookupDOIs(...args),
}));

// Mock settings
vi.mock("../../src/shared/settings", () => ({
    isSetupComplete: vi.fn().mockResolvedValue(true),
    getSettings: vi.fn().mockResolvedValue({email: "test@example.com", cacheQuotaMb: 500}),
}));

// Mock cache
const cacheStore = new Map<string, unknown>();
// Records every cache.set(key, data, ttlMs) so tests can assert TTL is applied.
const cacheSetCalls: Array<{key: string; data: unknown; ttlMs: number | null}> = [];
// When set, cache.set throws (simulates a storage-quota write failure).
let cacheSetError: Error | null = null;
const getSpy = vi.fn();
const getManySpy = vi.fn();
vi.mock("../../src/shared/cache", () => ({
    MONTH_MS: 30 * 24 * 60 * 60 * 1000,
    LocalCache: class {
        prefix: string;

        constructor(prefix: string) {
            this.prefix = prefix;
        }

        setQuota(_bytes: number) {}

        async get(key: string) {
            getSpy(key);
            return cacheStore.has(`${this.prefix}:${key}`)
                ? cacheStore.get(`${this.prefix}:${key}`)
                : undefined;
        }

        async getMany(keys: string[]) {
            getManySpy(keys);
            const out = new Map<string, unknown>();
            for (const key of keys) {
                const storageKey = `${this.prefix}:${key}`;
                if (cacheStore.has(storageKey)) out.set(key, cacheStore.get(storageKey));
            }
            return out;
        }

        async set(key: string, data: unknown, ttlMs: number | null) {
            cacheSetCalls.push({key, data, ttlMs});
            if (cacheSetError) throw cacheSetError;
            cacheStore.set(`${this.prefix}:${key}`, data);
        }
    },
}));

describe("service-worker", () => {
    let messageHandler: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void
    ) => boolean | undefined;

    beforeEach(async () => {
        cacheStore.clear();
        cacheSetCalls.length = 0;
        cacheSetError = null;
        getSpy.mockClear();
        getManySpy.mockClear();
        mockLookupDOIs.mockReset();
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});


        const addListenerMock = vi.fn();
        (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>) =
            addListenerMock;

        vi.resetModules();
        await import("../../src/background/service-worker");

        messageHandler = addListenerMock.mock.calls[0][0];
    });

    function sendMessage(request: LookupRequest): Promise<LookupResponse> {
        return new Promise((resolve) => {
            messageHandler(request, {}, resolve as (r: unknown) => void);
        });
    }

    function sendRetractionCheck(dois: string[]): Promise<RetractionCheckResponse> {
        return new Promise((resolve) => {
            messageHandler(
                {type: "FLORA_RET_CHECK", dois},
                {},
                resolve as (r: unknown) => void
            );
        });
    }

    function storeRetractionMap(map: RetractionMaps): void {
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(
            async (keys: unknown) => {
                const wants = (key: string) =>
                    keys === key || (Array.isArray(keys) && keys.includes(key));
                if (wants(RET_MAP_KEY)) return {[RET_MAP_KEY]: map};
                return {};
            }
        );
    }

    it("returns results for matched DOIs", async () => {
        mockLookupDOIs.mockResolvedValue(
            new Map([[doi("10.1038/nature12373"), MOCK_RESULT]])
        );

        const response = await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.1038/nature12373")],
        });

        expect(response.type).toBe("FLORA_LOOKUP_RESULT");
        expect(response.results["10.1038/nature12373"]).toEqual(MOCK_RESULT);
        expect(Object.keys(response.errors)).toHaveLength(0);
    });

    it("returns empty results for unmatched DOIs", async () => {
        mockLookupDOIs.mockResolvedValue(new Map());

        const response = await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.9999/nonexistent")],
        });

        expect(Object.keys(response.results)).toHaveLength(0);
        expect(Object.keys(response.errors)).toHaveLength(0);
    });

    it("uses cache on second request", async () => {
        mockLookupDOIs.mockResolvedValue(
            new Map([[doi("10.1038/nature12373"), MOCK_RESULT]])
        );

        await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.1038/nature12373")],
        });
        expect(mockLookupDOIs).toHaveBeenCalledOnce();

        const response = await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.1038/nature12373")],
        });
        expect(mockLookupDOIs).toHaveBeenCalledOnce();
        expect(response.results["10.1038/nature12373"]).toEqual(MOCK_RESULT);
    });

    it("re-queries no-match DOIs (does not negative-cache)", async () => {
        // FORRT may add a record later, so an unmatched DOI must hit the API
        // again on the next request rather than being suppressed by the cache.
        mockLookupDOIs.mockResolvedValue(new Map());

        await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.9999/not.yet.in.forrt")],
        });
        expect(mockLookupDOIs).toHaveBeenCalledOnce();

        const response = await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.9999/not.yet.in.forrt")],
        });
        // Second request re-hits the API instead of serving a cached no-match.
        expect(mockLookupDOIs).toHaveBeenCalledTimes(2);
        expect(Object.keys(response.results)).toHaveLength(0);
    });

    it("returns errors on API failure", async () => {
        mockLookupDOIs.mockRejectedValue(new Error("FLoRA API error: 500"));

        const response = await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.1038/nature12373")],
        });

        expect(Object.keys(response.results)).toHaveLength(0);
        expect(response.errors["10.1038/nature12373"]).toBe(
            "FLoRA API error: 500"
        );
    });

    it("applies a finite TTL to lookup cache writes (not forever)", async () => {
        mockLookupDOIs.mockResolvedValue(
            new Map([[doi("10.1038/nature12373"), MOCK_RESULT]])
        );

        await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.1038/nature12373")],
        });

        expect(cacheSetCalls).toHaveLength(1);
        // ~30 days, not null/forever — this is what makes eviction possible.
        expect(cacheSetCalls[0].ttlMs).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it("does not turn a cache-WRITE failure into a lookup error", async () => {
        // The API returns a real result, but persisting it to storage fails
        // (e.g. quota). The result must still be returned and NOT reported as an
        // error — this is the storage-quota time-bomb regression.
        mockLookupDOIs.mockResolvedValue(
            new Map([[doi("10.1038/nature12373"), MOCK_RESULT]])
        );
        cacheSetError = new Error("QUOTA_BYTES quota exceeded");

        const response = await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.1038/nature12373")],
        });

        expect(response.results["10.1038/nature12373"]).toEqual(MOCK_RESULT);
        expect(Object.keys(response.errors)).toHaveLength(0);
        // The write was attempted (and threw) but did not corrupt the response.
        expect(cacheSetCalls).toHaveLength(1);
    });

    it("ignores non-lookup messages", () => {
        const result = messageHandler({type: "UNKNOWN"}, {}, vi.fn());
        expect(result).toBe(false);
    });

    describe("retraction checks", () => {
        it("returns the notice DOI for a retracted paper in the synced map", async () => {
            storeRetractionMap({
                retractions: {"10.1234/paper": "10.1234/notice"},
                concerns: {},
            });

            const response = await sendRetractionCheck([doi("10.1234/paper")]);
            expect(response.type).toBe("FLORA_RET_CHECK_RESULT");
            expect(response.results).toEqual([
                {originDoi: "10.1234/paper", doi: "10.1234/notice", kind: "retraction"},
            ]);
        });

        it("tags expressions of concern as 'concern'", async () => {
            storeRetractionMap({
                retractions: {},
                concerns: {"10.5678/eoc-paper": "10.5678/eoc-notice"},
            });

            const response = await sendRetractionCheck([doi("10.5678/eoc-paper")]);
            expect(response.results).toEqual([
                {originDoi: "10.5678/eoc-paper", doi: "10.5678/eoc-notice", kind: "concern"},
            ]);
        });

        it("prefers retraction over concern when a DOI is in both maps", async () => {
            storeRetractionMap({
                retractions: {"10.1234/dual": "10.1234/dual-retraction"},
                concerns: {"10.1234/dual": "10.1234/dual-concern"},
            });

            const response = await sendRetractionCheck([doi("10.1234/dual")]);
            expect(response.results).toEqual([
                {originDoi: "10.1234/dual", doi: "10.1234/dual-retraction", kind: "retraction"},
            ]);
        });

        it("matches mixed-case source keys against lowercased DOI input", async () => {
            // Retraction Watch publishes DOIs in publisher case; normaliseDOI
            // lowercases lookups, so the worker must lowercase the source keys.
            storeRetractionMap({
                retractions: {"10.1016/S0140-6736(20)32656-8": "10.1016/S0140-6736(22)02370-4"},
                concerns: {"10.1056/NEJMicm2518379": "10.1056/NEJMicm9999999"},
            });

            // Lookups arrive already lowercased (normaliseDOI runs before the
            // message is sent); the source keys are in publisher case.
            const retracted = await sendRetractionCheck([doi("10.1016/s0140-6736(20)32656-8")]);
            expect(retracted.results).toEqual([
                {
                    originDoi: "10.1016/s0140-6736(20)32656-8",
                    doi: "10.1016/S0140-6736(22)02370-4",
                    kind: "retraction",
                },
            ]);

            const concerned = await sendRetractionCheck([doi("10.1056/nejmicm2518379")]);
            expect(concerned.results).toEqual([
                {
                    originDoi: "10.1056/nejmicm2518379",
                    doi: "10.1056/NEJMicm9999999",
                    kind: "concern",
                },
            ]);
        });

        it("returns nothing for a DOI in neither map", async () => {
            storeRetractionMap({
                retractions: {"10.1234/keep": "10.1234/retraction"},
                concerns: {},
            });

            const response = await sendRetractionCheck([doi("10.9999/not-there")]);
            expect(response.results).toEqual([]);
        });

        it("falls back to the bundled JSON when storage is empty", async () => {
            // Storage empty (default mock); the worker fetches the packaged
            // dist/retractions.json and lowercases its keys.
            const bundled: RetractionMaps = {
                retractions: {"10.1000/Bundled": "10.1000/bundled-notice"},
                concerns: {},
            };
            const fetchMock = vi.fn(async (url: string) => ({
                ok: true,
                status: 200,
                json: async () =>
                    String(url).includes("retractions.json")
                        ? bundled
                        : {retractions: {}, concerns: {}},
            }));
            vi.stubGlobal("fetch", fetchMock);

            const response = await sendRetractionCheck([doi("10.1000/bundled")]);
            expect(response.results).toEqual([
                {originDoi: "10.1000/bundled", doi: "10.1000/bundled-notice", kind: "retraction"},
            ]);
            expect(fetchMock).toHaveBeenCalledWith(
                "chrome-extension://test-extension-id/dist/retractions.json"
            );
            vi.unstubAllGlobals();
        });

        it("reports an error when no data source is available", async () => {
            const fetchMock = vi.fn(async () => ({ok: false, status: 404, json: async () => ({})}));
            vi.stubGlobal("fetch", fetchMock);

            const response = await sendRetractionCheck([doi("10.1234/paper")]);
            expect(response.results).toEqual([]);
            expect(response.error).toBeTruthy();
            vi.unstubAllGlobals();
        });
    });

    it("splits cached and uncached DOIs in one request", async () => {
        cacheStore.set("flora:10.1038/nature12373", MOCK_RESULT);

        const otherResult = mockResult({doi: "10.1126/science.9999999"});
        mockLookupDOIs.mockResolvedValue(
            new Map([[doi("10.1126/science.9999999"), otherResult]])
        );

        const response = await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [doi("10.1038/nature12373"), doi("10.1126/science.9999999")],
        });

        expect(mockLookupDOIs).toHaveBeenCalledWith([
            doi("10.1126/science.9999999"),
        ]);
        expect(response.results["10.1038/nature12373"]).toEqual(MOCK_RESULT);
        expect(response.results["10.1126/science.9999999"]).toEqual(otherResult);
    });

    it("reads the cache with one batched getMany, not per-DOI get()", async () => {
        mockLookupDOIs.mockResolvedValue(new Map());

        await sendMessage({
            type: "FLORA_LOOKUP",
            dois: [
                doi("10.1038/nature12373"),
                doi("10.1126/science.9999999"),
                doi("10.1000/third"),
            ],
        });

        // One batched read covering every DOI; no per-DOI cache.get() round-trips.
        expect(getManySpy).toHaveBeenCalledOnce();
        expect(getManySpy).toHaveBeenCalledWith([
            "10.1038/nature12373",
            "10.1126/science.9999999",
            "10.1000/third",
        ]);
        expect(getSpy).not.toHaveBeenCalled();
    });

    describe("setup-dismissed handlers respond even when storage rejects", () => {
        it("FLORA_DISMISS_SETUP responds {ok:false} on a session.set rejection", async () => {
            (chrome.storage.session.set as ReturnType<typeof vi.fn>)
                .mockRejectedValueOnce(new Error("storage unavailable"));

            const response = await new Promise((resolve) => {
                messageHandler({type: "FLORA_DISMISS_SETUP"}, {}, resolve as (r: unknown) => void);
            });
            expect(response).toEqual({ok: false});
        });

        it("FLORA_IS_SETUP_DISMISSED responds {dismissed:false} on a session.get rejection", async () => {
            (chrome.storage.session.get as ReturnType<typeof vi.fn>)
                .mockRejectedValueOnce(new Error("storage unavailable"));

            const response = await new Promise((resolve) => {
                messageHandler({type: "FLORA_IS_SETUP_DISMISSED"}, {}, resolve as (r: unknown) => void);
            });
            expect(response).toEqual({dismissed: false});
        });
    });

    it("deduplicates concurrent retraction syncs into a single fetch", async () => {
        // Storage is empty (default mock) → isEmpty → each call would otherwise
        // fetch + write the full map. The in-flight guard collapses them to one.
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({retractions: {}, concerns: {}}),
        }));
        vi.stubGlobal("fetch", fetchMock);

        const {syncRetractionsInfo} = await import("../../src/background/service-worker");
        await Promise.all([
            syncRetractionsInfo(),
            syncRetractionsInfo(),
            syncRetractionsInfo(),
        ]);

        expect(fetchMock).toHaveBeenCalledTimes(1);

        // After the batch settles the guard clears, so a later call syncs again.
        await syncRetractionsInfo();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        vi.unstubAllGlobals();
    });
});
