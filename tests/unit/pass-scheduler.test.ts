import { describe, it, expect, vi } from "vitest";
import { createPassScheduler, registerStuckRetry, type ScanHint } from "../../src/content-general/pass-scheduler";

// Flush the microtask queue (and a macrotask) so the scheduler's `finally`
// block and its fire-and-forget coalesced re-run have a chance to run.
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A `run` whose invocations block until the matching gate is released. */
function gatedRun() {
  const gates: Array<() => void> = [];
  const run = vi.fn((_hint?: ScanHint) => new Promise<void>((resolve) => { gates.push(resolve); }));
  return { run, gates };
}

describe("createPassScheduler — serialization + coalescing", () => {
  it("runs a single pass at a time and coalesces concurrent triggers into ONE re-run", async () => {
    const { run, gates } = gatedRun();
    const s = createPassScheduler(run);

    // Fire the handler three times before the first pass finishes.
    void s.trigger({ couldBeRelevant: true });
    void s.trigger({ couldBeRelevant: false });
    void s.trigger({ couldBeRelevant: false });

    // Only the first pass is in flight — the other two are coalesced.
    expect(run).toHaveBeenCalledTimes(1);

    gates[0](); // finish pass #1
    await tick();

    // Exactly one coalesced re-run fired — never a growing queue.
    expect(run).toHaveBeenCalledTimes(2);

    gates[1](); // finish the re-run
    await tick();
    expect(run).toHaveBeenCalledTimes(2); // nothing else queued
  });

  it("a hintless (full-scan) coalesced request wins over localized ones", async () => {
    const { run, gates } = gatedRun();
    const s = createPassScheduler(run);

    void s.trigger({ couldBeRelevant: false }); // pass #1
    void s.trigger({ couldBeRelevant: false }); // coalesced, localized
    void s.trigger(undefined);                  // coalesced, full scan

    gates[0]();
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toBeUndefined(); // re-run is a full scan
    gates[1]();
    await tick();
  });

  it("OR-s the couldBeRelevant flags of coalesced localized requests", async () => {
    const { run, gates } = gatedRun();
    const s = createPassScheduler(run);

    void s.trigger({ couldBeRelevant: false }); // pass #1 (in flight)
    void s.trigger({ couldBeRelevant: false }); // coalesced
    void s.trigger({ couldBeRelevant: true });  // coalesced — relevant
    void s.trigger({ couldBeRelevant: false }); // coalesced

    gates[0]();
    await tick();
    expect(run.mock.calls[1][0]).toEqual({ couldBeRelevant: true }); // relevance not dropped
    gates[1]();
    await tick();
  });
});

describe("createPassScheduler — generation token", () => {
  it("capture/isStale track the generation counter", () => {
    const s = createPassScheduler(async () => {});
    const g0 = s.capture();
    expect(s.isStale(g0)).toBe(false);

    s.bumpGeneration();
    expect(s.isStale(g0)).toBe(true); // an in-flight pass that captured g0 aborts

    const g1 = s.capture();
    expect(s.isStale(g1)).toBe(false);
    s.bumpGeneration();
    s.bumpGeneration();
    expect(s.isStale(g1)).toBe(true);
  });

  it("models a mid-pass navigation: a captured pass sees itself as stale after a bump", () => {
    const s = createPassScheduler(async () => {});
    const captured = s.capture(); // pass begins on page A
    s.bumpGeneration();           // SPA navigation to page B observed mid-pass
    // The pass's post-await continuation checks isStale and bails without
    // committing — this is the guard used after every await in runRenderPass.
    expect(s.isStale(captured)).toBe(true);
  });
});

describe("registerStuckRetry — capped retry budget", () => {
  it("permits retries up to the cap, then gives up quietly", () => {
    const counts = new Map<string, number>();
    const doi = "10.1038/nature12373";

    expect(registerStuckRetry(doi, counts, 3)).toBe(true);  // attempt 1
    expect(registerStuckRetry(doi, counts, 3)).toBe(true);  // attempt 2
    expect(registerStuckRetry(doi, counts, 3)).toBe(true);  // attempt 3
    expect(registerStuckRetry(doi, counts, 3)).toBe(false); // attempt 4 — over cap
    expect(registerStuckRetry(doi, counts, 3)).toBe(false); // stays capped
    expect(counts.get(doi)).toBe(5);
  });

  it("tracks each DOI's budget independently", () => {
    const counts = new Map<string, number>();
    expect(registerStuckRetry("a", counts, 1)).toBe(true);
    expect(registerStuckRetry("a", counts, 1)).toBe(false);
    expect(registerStuckRetry("b", counts, 1)).toBe(true); // b unaffected by a
  });
});
