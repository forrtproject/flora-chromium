/**
 * Disabled-domain list for FLoRA.
 *
 * FLoRA runs on ALL sites by default.  Users can disable specific domains
 * from the options page.  A disabled domain prevents the content script
 * from scanning/injecting on that hostname (exact match or subdomain).
 */

const BLACKLIST_KEY = "flora_blocked_domains";
let cachedBlockedDomains: string[] | null = null;
let domainListenerInstalled = false;

function installDomainInvalidation(): void {
  if (domainListenerInstalled) return;
  domainListenerInstalled = true;
  try {
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === "sync" && changes[BLACKLIST_KEY]) {
        cachedBlockedDomains = (changes[BLACKLIST_KEY].newValue as string[] | undefined) ?? [];
      }
    });
  } catch {
    // Storage change events are unavailable in tests and some non-extension contexts.
  }
}

/** Read the blocked-domain list from chrome.storage.sync. */
export async function getBlockedDomains(): Promise<string[]> {
  installDomainInvalidation();
  if (cachedBlockedDomains) return cachedBlockedDomains;
  try {
    const raw = await chrome.storage.sync.get(BLACKLIST_KEY);
    cachedBlockedDomains = (raw[BLACKLIST_KEY] as string[] | undefined) ?? [];
    return cachedBlockedDomains;
  } catch {
    cachedBlockedDomains = [];
    return cachedBlockedDomains;
  }
}

/** Persist the blocked-domain list. */
export async function saveBlockedDomains(domains: string[]): Promise<void> {
  cachedBlockedDomains = domains;
  await chrome.storage.sync.set({ [BLACKLIST_KEY]: domains });
}

/**
 * Check whether a hostname is blocked.
 *
 * Returns `true` if `hostname` equals a blocked domain or is a
 * subdomain of one (e.g. blocking `example.com` also blocks
 * `sub.example.com`).
 */
export async function isDomainBlocked(hostname: string): Promise<boolean> {
  const blocked = await getBlockedDomains();
  const host = hostname.toLowerCase();

  for (const domain of blocked) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}
