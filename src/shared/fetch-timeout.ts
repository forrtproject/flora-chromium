// Small shared wrapper that aborts a fetch after a timeout so a stalled network
// request can't hang a lookup forever. An abort surfaces as a rejected promise
// (an AbortError DOMException), so callers' existing catch/try blocks treat a
// timeout exactly like any other network failure.

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
