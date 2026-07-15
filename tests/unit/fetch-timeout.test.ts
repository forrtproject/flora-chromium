import { describe, it, expect, vi } from "vitest";
import { fetchWithTimeout } from "../../src/shared/fetch-timeout";

describe("fetchWithTimeout", () => {
  it("aborts the underlying fetch once the timeout elapses and rejects", async () => {
    vi.useFakeTimers();

    // A fetch that never resolves on its own — it only settles when its
    // AbortSignal fires, exactly like a stalled network request.
    const fetchMock = vi.fn(
      (_input: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError"))
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithTimeout("https://example.com", {}, 1000);
    const settled = expect(promise).rejects.toThrow(/abort/i);

    await vi.advanceTimersByTimeAsync(1000);
    await settled;

    expect(fetchMock).toHaveBeenCalledOnce();
    const passedSignal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
    expect(passedSignal.aborted).toBe(true);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("passes the response through and clears the timer when fetch resolves in time", async () => {
    vi.useFakeTimers();

    const response = { ok: true, status: 200 } as Response;
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWithTimeout("https://example.com", {}, 1000);
    expect(result).toBe(response);
    // The abort timer must be cleared so it can't fire after a successful fetch.
    expect(vi.getTimerCount()).toBe(0);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("forwards init options (method, headers) alongside the injected signal", async () => {
    const response = { ok: true } as Response;
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithTimeout("https://example.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    vi.unstubAllGlobals();
  });
});
