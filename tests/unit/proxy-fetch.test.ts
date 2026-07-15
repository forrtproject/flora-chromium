import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// getUserEmail() must return a configured email for the Unpaywall lookup.
vi.mock("../../src/shared/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({ email: "test@example.com" }),
  isSetupComplete: vi.fn().mockResolvedValue(true),
}));

import { validateDOIs, _resetValidationCacheForTesting } from "../../src/shared/doi-validate";
import { fetchOpenAccess, _resetOpenAccessCacheForTesting } from "../../src/shared/openaccess";
import { handleProxyFetch } from "../../src/background/proxy-fetch";
import { isWorkerContext } from "../../src/shared/messages";
import type { DoiString } from "../../src/shared/types";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const doi = (s: string) => s as DoiString;

describe("cross-origin fetch proxying", () => {
  beforeEach(() => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    _resetValidationCacheForTesting();
    _resetOpenAccessCacheForTesting();
  });

  it("runs in a window (content-script) context under jsdom", () => {
    // The whole point of proxying is that content scripts have a DOM/window and
    // therefore no host-permission CORS bypass.
    expect(isWorkerContext()).toBe(false);
    expect(typeof window).not.toBe("undefined");
  });

  it("validateDOIs routes doi.org through chrome.runtime.sendMessage, and the worker handler performs the fetch", async () => {
    let handleFetched = 0;
    server.use(
      http.get("https://doi.org/api/handles/*", () => {
        handleFetched += 1;
        return HttpResponse.json({ responseCode: 1 });
      })
    );

    const results = await validateDOIs([doi("10.1038/nature12373")]);

    // Transport: the content-script call proxied via a FLORA_PROXY_FETCH message.
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "FLORA_PROXY_FETCH", fetcher: "validateDois" })
    );
    // The doi.org fetch actually ran (in the worker handler), not the content script.
    expect(handleFetched).toBe(1);
    expect(results.get(doi("10.1038/nature12373"))).toBe(true);
  });

  it("fetchOpenAccess routes Unpaywall through chrome.runtime.sendMessage, and the worker handler performs the fetch", async () => {
    let oaFetched = 0;
    server.use(
      http.get("https://api.unpaywall.org/v2/:doi", () => {
        oaFetched += 1;
        return HttpResponse.json({
          is_oa: true,
          best_oa_location: { url_for_pdf: "https://example.org/paper.pdf" },
        });
      })
    );

    const status = await fetchOpenAccess("10.1038/nature12373");

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "FLORA_PROXY_FETCH", fetcher: "openAccess" })
    );
    expect(oaFetched).toBe(1);
    expect(status).toEqual({ isOa: true, url: "https://example.org/paper.pdf" });
  });

  it("handleProxyFetch performs the fetch directly and returns a serializable payload", async () => {
    server.use(
      http.get("https://doi.org/api/handles/*", () => HttpResponse.json({ responseCode: 1 }))
    );

    const resp = await handleProxyFetch({
      type: "FLORA_PROXY_FETCH",
      fetcher: "validateDois",
      args: [[doi("10.1038/nature12373")]],
    });

    expect(resp.ok).toBe(true);
    // Entries are plain [doi, boolean] tuples — structured-clone-safe across sendMessage.
    expect(resp.data).toEqual([["10.1038/nature12373", true]]);
  });
});
