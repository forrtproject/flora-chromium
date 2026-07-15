/// <reference types="vitest/globals" />

// Mock chrome APIs for testing
const storageMock = {
  sync: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
  },
  session: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
  local: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
};

Object.defineProperty(globalThis, "chrome", {
  value: {
    storage: {
      ...storageMock,
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      id: "test-extension-id",
      getURL: vi.fn((path: string) => `chrome-extension://test-extension-id/${path}`),
      // Default: content-script proxy fetches (FLORA_PROXY_FETCH) round-trip to
      // the real worker handler so the shared modules' worker-side fetch runs
      // (msw intercepts it). Any other message resolves to an empty lookup. The
      // worker handler is imported lazily so per-test vi.mock() of the shared
      // modules (e.g. settings) still applies to its module graph.
      sendMessage: vi.fn(async (message: unknown) => {
        if (
          typeof message === "object" &&
          message !== null &&
          (message as { type?: string }).type === "FLORA_PROXY_FETCH"
        ) {
          const { handleProxyFetch } = await import("../src/background/proxy-fetch");
          return handleProxyFetch(message as never);
        }
        return { type: "FLORA_LOOKUP_RESULT", results: {}, errors: {} };
      }),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
      },
      onStartup: {
        addListener: vi.fn(),
      },
      openOptionsPage: vi.fn(),
    },
    tabs: {
      create: vi.fn(),
      onUpdated: {
        addListener: vi.fn(),
      },
    },
    action: {
      setIcon: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
    },
  },
  writable: true,
});
