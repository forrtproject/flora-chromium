/** Centralised extension settings stored in chrome.storage.sync. */

export interface FloraSettings {
  /** Contact email for Crossref/OpenAlex polite pool (required). */
  email: string;
  /**
   * When true, a DOI pill is shown on every reference (including ones that
   * already carry a DOI). When false (default), only references with no
   * visible DOI of their own get a pill.
   */
  showDoiPillsOnAllReferences: boolean;
  /**
   * Soft cap on chrome.storage.local usage in MB. 0 = unlimited.
   * Expired cache entries are evicted when this limit is approached.
   */
  cacheQuotaMb: number;
}

const STORAGE_KEY = "flora_settings";

const DEFAULTS: FloraSettings = {
  email: "",
  showDoiPillsOnAllReferences: false,
  cacheQuotaMb: 500,
};

let cachedSettings: FloraSettings | null = null;
let settingsListenerInstalled = false;

function installSettingsInvalidation(): void {
  if (settingsListenerInstalled) return;
  settingsListenerInstalled = true;
  try {
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === "sync" && changes[STORAGE_KEY]) {
        const stored = changes[STORAGE_KEY].newValue as Partial<FloraSettings> | undefined;
        cachedSettings = { ...DEFAULTS, ...stored };
      }
    });
  } catch {
    // Storage change events are unavailable in tests and some non-extension contexts.
  }
}

/** Read current settings (returns defaults for any missing keys). */
export async function getSettings(): Promise<FloraSettings> {
  installSettingsInvalidation();
  if (cachedSettings) return cachedSettings;
  try {
    const raw = await chrome.storage.sync.get(STORAGE_KEY);
    const stored = raw[STORAGE_KEY] as Partial<FloraSettings> | undefined;
    cachedSettings = { ...DEFAULTS, ...stored };
    return cachedSettings;
  } catch {
    cachedSettings = { ...DEFAULTS };
    return cachedSettings;
  }
}

/** Persist settings (merges with existing). */
export async function saveSettings(
  partial: Partial<FloraSettings>
): Promise<void> {
  const current = await getSettings();
  cachedSettings = { ...current, ...partial };
  await chrome.storage.sync.set({ [STORAGE_KEY]: cachedSettings });
}

/** Returns true if the user has completed initial setup (email provided). */
export async function isSetupComplete(): Promise<boolean> {
  const { email } = await getSettings();
  return email.trim().length > 0;
}
