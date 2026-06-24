import {afterEach, describe, expect, it, vi} from "vitest";

// getSettings()/getBlockedDomains() cache their first read and invalidate via a
// storage.onChanged listener, so repeated reads (hot paths like augmentation
// and per-row Scholar checks) don't hit chrome.storage every time.
const FULL_SETTINGS = {
  email: "test@example.com",
  showDoiPillsOnAllReferences: false,
  cacheQuotaMb: 500,
};

describe("settings/domain storage caches", () => {
  afterEach(() => {
    vi.resetModules();
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockReset();
    (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mockReset();
  });

  it("caches settings reads within a module lifecycle", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_settings: {email: "test@example.com"},
    });

    const {getSettings, isSetupComplete} = await import("../../src/shared/settings");

    await expect(getSettings()).resolves.toEqual(FULL_SETTINGS);
    await expect(isSetupComplete()).resolves.toBe(true);
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1);
  });

  it("updates the settings cache when settings are saved", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_settings: {email: "old@example.com"},
    });
    (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const {getSettings, saveSettings} = await import("../../src/shared/settings");

    await saveSettings({email: "new@example.com"});
    await expect(getSettings()).resolves.toEqual({...FULL_SETTINGS, email: "new@example.com"});
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1);
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      flora_settings: {...FULL_SETTINGS, email: "new@example.com"},
    });
  });

  it("caches blocked-domain reads within a module lifecycle", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_blocked_domains: ["example.com"],
    });

    const {getBlockedDomains, isDomainBlocked} = await import("../../src/shared/domains");

    await expect(getBlockedDomains()).resolves.toEqual(["example.com"]);
    await expect(isDomainBlocked("sub.example.com")).resolves.toBe(true);
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1);
  });

  it("updates the blocked-domain cache when domains are saved", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      flora_blocked_domains: ["old.example"],
    });
    (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const {getBlockedDomains, saveBlockedDomains} = await import("../../src/shared/domains");

    await saveBlockedDomains(["new.example"]);
    await expect(getBlockedDomains()).resolves.toEqual(["new.example"]);
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      flora_blocked_domains: ["new.example"],
    });
  });
});
