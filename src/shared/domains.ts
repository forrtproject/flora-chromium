/**
 * Domain blacklist for FLoRA.
 *
 * FLoRA runs on ALL sites by default.  Users can block specific domains
 * from the options page.  A blocked domain prevents the content script
 * from scanning/injecting on that hostname (exact match or subdomain).
 */

const BLACKLIST_KEY = "flora_blocked_domains";

/** Read the blocked-domain list from chrome.storage.sync. */
export async function getBlockedDomains(): Promise<string[]> {
  try {
    const raw = await chrome.storage.sync.get(BLACKLIST_KEY);
    return (raw[BLACKLIST_KEY] as string[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/** Persist the blocked-domain list. */
export async function saveBlockedDomains(domains: string[]): Promise<void> {
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
