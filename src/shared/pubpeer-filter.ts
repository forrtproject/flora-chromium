// Commenters muted in the embedded PubPeer panel, matched case-insensitively
// on their PubPeer display name.

const HIDDEN_COMMENTERS_KEY = "flora_hidden_pubpeer_commenters";

export const DEFAULT_HIDDEN_COMMENTERS = ["FORRT"];

let cachedHiddenCommenters: string[] | null = null;
let listenerInstalled = false;

function installInvalidation(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  try {
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === "sync" && changes[HIDDEN_COMMENTERS_KEY]) {
        cachedHiddenCommenters =
          (changes[HIDDEN_COMMENTERS_KEY].newValue as string[] | undefined) ??
          [...DEFAULT_HIDDEN_COMMENTERS];
      }
    });
  } catch {
    // Storage change events are unavailable in tests and some non-extension contexts.
  }
}

/** Read the hidden-commenter list from chrome.storage.sync. */
export async function getHiddenCommenters(): Promise<string[]> {
  installInvalidation();
  if (cachedHiddenCommenters) return cachedHiddenCommenters;
  try {
    const raw = await chrome.storage.sync.get(HIDDEN_COMMENTERS_KEY);
    const stored = raw[HIDDEN_COMMENTERS_KEY] as string[] | undefined;
    cachedHiddenCommenters = stored ?? [...DEFAULT_HIDDEN_COMMENTERS];
    return cachedHiddenCommenters;
  } catch {
    cachedHiddenCommenters = [...DEFAULT_HIDDEN_COMMENTERS];
    return cachedHiddenCommenters;
  }
}

/** Persist the hidden-commenter list. */
export async function saveHiddenCommenters(ids: string[]): Promise<void> {
  cachedHiddenCommenters = ids;
  await chrome.storage.sync.set({ [HIDDEN_COMMENTERS_KEY]: ids });
}

/** Subscribe to list changes. Returns an unsubscribe function. */
export function onHiddenCommentersChanged(fn: (ids: string[]) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "sync" || !changes[HIDDEN_COMMENTERS_KEY]) return;
    fn(
      (changes[HIDDEN_COMMENTERS_KEY].newValue as string[] | undefined) ??
        [...DEFAULT_HIDDEN_COMMENTERS]
    );
  };
  try {
    chrome.storage.onChanged?.addListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      chrome.storage.onChanged?.removeListener(listener);
    } catch {
      // Nothing to detach.
    }
  };
}

/** Case-insensitive membership test against a hidden-commenter list. */
export function isHiddenCommenter(id: string, hidden: readonly string[]): boolean {
  const needle = id.trim().toLowerCase();
  if (!needle) return false;
  return hidden.some((h) => h.trim().toLowerCase() === needle);
}

/** Marks a comment block hidden by FLoRA, so unmuting can restore it. */
export const HIDDEN_COMMENTER_ATTR = "data-flora-hidden-commenter";

const COMMENT_BLOCK_SELECTOR = ".vertical-timeline-content";

/**
 * The commenter's display name: the first `strong` that is not `.inner-id`
 * (which holds the comment number). Pseudonyms are wrapped in `<em>`.
 */
export function commenterNameOf(block: Element): string | null {
  const left = block.querySelector(".ibox-title .left");
  const nameEl = left?.querySelector("strong:not(.inner-id)");
  const name = nameEl?.textContent?.trim();
  return name ? name : null;
}

/** Hide, and re-show on unmute, PubPeer comment blocks under `root`. */
export function applyCommenterFilter(root: Node | null, hidden: readonly string[]): void {
  if (!root) return;
  const el = root instanceof Element ? root : root.parentElement;
  if (!el) return;

  const blocks: Element[] = el.matches?.(COMMENT_BLOCK_SELECTOR) ? [el] : [];
  blocks.push(...el.querySelectorAll(COMMENT_BLOCK_SELECTOR));

  for (const block of blocks) {
    const name = commenterNameOf(block);
    // No name means this isn't a real comment (e.g. the reply editor shares the
    // block class) — leave it alone.
    if (!name) continue;
    const el = block as HTMLElement;
    if (isHiddenCommenter(name, hidden)) {
      el.style.display = "none";
      el.setAttribute(HIDDEN_COMMENTER_ATTR, name);
    } else if (el.hasAttribute(HIDDEN_COMMENTER_ATTR)) {
      el.style.removeProperty("display");
      el.removeAttribute(HIDDEN_COMMENTER_ATTR);
    }
  }
}
