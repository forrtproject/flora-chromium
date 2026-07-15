// Concurrency primitives for the general content script's render pipeline.
//
// Two intertwined guarantees the render handler needs, factored out here so
// they are unit-testable in isolation from the DOM-heavy pass itself:
//
//   1. Serialization + coalescing. Overlapping triggers (mutation debounce,
//      visibilitychange, Sheets CSV fetch) must not run passes concurrently.
//      At most one pass runs at a time and at most ONE re-run is coalesced to
//      fire afterwards — never a growing queue.
//
//   2. A generation token. Incremented the instant an SPA URL change is
//      observed; each pass captures the generation at its start and, after
//      every await, checks it is still current (`isStale`). A pass begun on
//      page A therefore aborts instead of committing results after navigation
//      to page B.

/** Hint passed from the mutation observer to the render handler. */
export interface ScanHint {
    /**
     * True when a node added in this mutation batch could carry a DOI — used by
     * the relevance pre-gate to cheaply skip passes on irrelevant pages. Absent
     * hint (initial run, tab re-show) always forces a full scan.
     */
    couldBeRelevant: boolean;
}

export interface PassScheduler {
    /** Serialize + coalesce: run now, or coalesce into a single pending re-run. */
    trigger(hint?: ScanHint): Promise<void>;
    /** Bump the generation — call the instant an SPA URL change is observed. */
    bumpGeneration(): void;
    /** Snapshot the current generation at the start of a pass. */
    capture(): number;
    /** True once a newer generation has superseded the captured one. */
    isStale(captured: number): boolean;
}

/**
 * Build a scheduler around the actual pass function. Hints for coalesced
 * re-runs are merged so the re-run is at least as thorough as any request it
 * absorbed: a hintless (full-scan) request wins outright; otherwise the
 * couldBeRelevant flags are OR-ed so no relevant mutation is dropped.
 */
export function createPassScheduler(run: (hint?: ScanHint) => Promise<void>): PassScheduler {
    let generation = 0;
    let inFlight = false;
    let rerunQueued = false;
    let queuedHint: ScanHint | undefined;
    let queuedHintFull = false;

    const trigger = async (hint?: ScanHint): Promise<void> => {
        if (inFlight) {
            rerunQueued = true;
            if (!hint) {
                queuedHintFull = true; // full-scan request is strongest — it wins
                queuedHint = undefined;
            } else if (!queuedHintFull) {
                queuedHint = {
                    couldBeRelevant: (queuedHint?.couldBeRelevant ?? false) || hint.couldBeRelevant,
                };
            }
            return;
        }

        inFlight = true;
        try {
            await run(hint);
        } finally {
            inFlight = false;
            if (rerunQueued) {
                rerunQueued = false;
                const nextHint = queuedHintFull ? undefined : queuedHint;
                queuedHint = undefined;
                queuedHintFull = false;
                void trigger(nextHint);
            }
        }
    };

    return {
        trigger,
        bumpGeneration: () => { generation++; },
        capture: () => generation,
        isStale: (captured: number) => captured !== generation,
    };
}

/**
 * Record one stuck-lookup retry for a DOI and decide whether it should be
 * rolled back for another attempt. Returns true while the DOI is still within
 * its per-page retry budget; false once the cap is exceeded, so a permanently
 * unreachable service worker can't drive an unbounded retry storm.
 */
export function registerStuckRetry(
    doi: string,
    retryCount: Map<string, number>,
    maxRetries: number,
): boolean {
    const attempts = (retryCount.get(doi) ?? 0) + 1;
    retryCount.set(doi, attempts);
    return attempts <= maxRetries;
}
