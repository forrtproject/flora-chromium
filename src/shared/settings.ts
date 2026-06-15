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

/** Read current settings (returns defaults for any missing keys). */
export async function getSettings(): Promise<FloraSettings> {
  try {
    const raw = await chrome.storage.sync.get(STORAGE_KEY);
    const stored = raw[STORAGE_KEY] as Partial<FloraSettings> | undefined;
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Persist settings (merges with existing). */
export async function saveSettings(
  partial: Partial<FloraSettings>
): Promise<void> {
  const current = await getSettings();
  await chrome.storage.sync.set({ [STORAGE_KEY]: { ...current, ...partial } });
}

/** Returns true if the user has completed initial setup (email provided). */
export async function isSetupComplete(): Promise<boolean> {
  const { email } = await getSettings();
  return email.trim().length > 0;
}
