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
      sendMessage: vi.fn().mockResolvedValue({
        type: "FLORA_LOOKUP_RESULT",
        results: {},
        errors: {},
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
