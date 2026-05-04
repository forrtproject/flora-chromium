import { extractDOIs, extractDOIsFromText, extractPrimaryDOI } from "../shared/doi-extractor";
import { augmentDOIs } from "../shared/doi-augment";
import { validateDOIs } from "../shared/doi-validate";
import { debounce } from "../shared/debounce";
import type { DoiString, LookupState } from "../shared/types";
import type { LookupRequest, LookupResponse, SheetFetchRequest, SheetFetchResponse } from "../shared/messages";
import { renderErrorBanner, renderMatchedBanner, removeBanner, renderInlineBadges, renderSheetsModal, removeSheetsModal, renderSetupPrompt, renderPubPeerPanel, removePubPeerPanel, hideAllFloraUI, showAllFloraUI, type SheetsModalCallbacks } from "./injector";
import { lookupPubPeer } from "../shared/pubpeer-api";
import { debugLog, debugWarn } from "../shared/debug";
import { isSetupComplete } from "../shared/settings";
import { isDomainBlocked } from "../shared/domains";

const pageState = new Map<DoiString, LookupState>();
const processedDois = new Set<DoiString>();
let lastUrl = location.href;
let augmentAttempted = false;
let pubpeerChecked = false;

/** Monotonic counter — incremented on each sheet tab switch to discard stale CSV responses. */
let sheetFetchGen = 0;

/**
 * Silently try to resolve a DOI from the page title via Crossref/OpenAlex.
 * Runs in the background with no UI.
 */
async function augmentFromTitle(): Promise<void> {
  if (augmentAttempted) return;
  augmentAttempted = true;

  const pageTitle =
    document.querySelector<HTMLHeadingElement>("h1")?.textContent?.trim() ||
    document.title?.trim();

  if (!pageTitle) return;

  try {
    const augmented = await augmentDOIs([pageTitle]);
    const resolvedDoi = augmented.get(pageTitle);
    debugLog("Title augmentation:", resolvedDoi ? `resolved to ${resolvedDoi}` : "no match", `(title: "${pageTitle}")`);
    if (resolvedDoi) {
      processedDois.add(resolvedDoi);
      const request: LookupRequest = { type: "FLORA_LOOKUP", dois: [resolvedDoi] };
      await chrome.runtime.sendMessage(request);
    }
  } catch {
    // Augmentation failed silently
  }
}

async function checkPubPeer(): Promise<void> {
  if (pubpeerChecked || isSheets) return;
  pubpeerChecked = true;
  const primaryDoi = extractPrimaryDOI(document);
  if (!primaryDoi) return;
  try {
    const feedbacks = await lookupPubPeer([primaryDoi], [location.href]);
    renderPubPeerPanel(feedbacks);
  } catch {
    // PubPeer is supplementary — fail silently
  }
}

async function run(): Promise<void> {
  // Detect full URL change (SPA navigation) — clear state
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    processedDois.clear();
    pageState.clear();
    augmentAttempted = false;
    pubpeerChecked = false;
    if (isSheets) {
      removeSheetsModal();
    } else {
      removeBanner();
      removePubPeerPanel();
    }
  }

  let dois = extractDOIs(document);

  // On Sheets, also extract DOIs from the full sheet data fetched via CSV
  if (isSheets && sheetCsvDois.length > 0) {
    const combined = new Set([...dois, ...sheetCsvDois]);
    dois = [...combined];
  }
  debugLog(isSheets ? "Sheets:" : "General:", "Extracted DOIs:", dois.length, dois);

  // Validate extracted DOIs via doi.org — remove invalid ones
  if (dois.length > 0 && !isSheets) {
    try {
      const validation = await validateDOIs(dois);
      const before = dois.length;
      dois = dois.filter((doi) => validation.get(doi) !== false);
      const removed = before - dois.length;
      if (removed > 0) {
        debugLog(`Validation: removed ${removed} invalid DOI(s)`);
      }
    } catch {
      // Validation failed — keep all extracted DOIs as-is
    }
  }

  // Check PubPeer concurrently — runs once per page, fire-and-forget
  if (!isSheets) {
    void checkPubPeer();
  }

  // Filter out already-processed DOIs
  const newDois = dois.filter((doi) => !processedDois.has(doi));

  // If no valid DOIs found, try augmenting from page title in the background
  if (newDois.length === 0 && dois.length === 0) {
    debugLog("No valid DOIs found on page, attempting title augmentation");
    if (!isSheets) augmentFromTitle();
    return;
  }

  if (newDois.length === 0) {
    debugLog("No new DOIs (all already processed)");
    return;
  }
  debugLog(isSheets ? "Sheets:" : "General:", "New DOIs to look up:", newDois.length, newDois);

  for (const doi of newDois) {
    processedDois.add(doi);
  }

  // Mark all as loading
  for (const doi of newDois) {
    pageState.set(doi, { status: "loading" });
  }

  const request: LookupRequest = { type: "FLORA_LOOKUP", dois: newDois };

  try {
    const response: LookupResponse =
      await chrome.runtime.sendMessage(request);
    debugLog("Lookup response:", Object.keys(response.results).length, "results,", Object.keys(response.errors).length, "errors");

    for (const doi of newDois) {
      if (response.errors[doi]) {
        pageState.set(doi, { status: "error", message: response.errors[doi] });
      } else if (response.results[doi]) {
        pageState.set(doi, { status: "matched", result: response.results[doi], source: "extracted" });
      } else {
        pageState.set(doi, { status: "no-match" });
      }
    }

    // Collect matched DOIs for display
    // On Sheets, skip the "still in DOM" re-check — the canvas DOM is unreliable
    const currentDois = isSheets ? null : new Set(extractDOIs(document));
    const matched = [...pageState.entries()]
      .filter(([doi, s]) => {
        if (s.status !== "matched") return false;
        if (!isSheets && !currentDois!.has(doi)) return false;
        // Only include DOIs that actually have replication or reproduction data
        const stats = s.result.record.stats;
        return stats.n_replications_total > 0 || stats.n_reproductions_total > 0;
      })
      .map(([doi, s]) => ({
        doi,
        result: (s as { status: "matched"; result: import("../shared/types").ReplicationResult; source: "extracted" }).result,
      }));

    debugLog("Matched DOIs with replication data:", matched.length, matched.map(m => m.doi));

    if (matched.length > 0) {
      if (isSheets) {
        if (!isSheetsModalSuppressed()) {
          renderSheetsModal(matched, sheetsModalCallbacks);
        }
      } else {
        renderMatchedBanner(matched);
      }
    } else {
      if (isSheets) {
        removeSheetsModal();
      } else {
        removeBanner();
      }
    }

    // Inline badges (skip on Google Sheets — modal only)
    if (!isSheets) {
      renderInlineBadges(pageState);
    }
  } catch {
    renderErrorBanner("Failed to contact FLoRA service");
  }
}

const isSheets = location.href.includes("docs.google.com/spreadsheets");
const debouncedRun = debounce(run, 1000);


// DOIs extracted from the full sheet CSV (populated asynchronously on Sheets)
let sheetCsvDois: DoiString[] = [];

// ── Sheets modal: per-gid dismiss tracking & snooze ──
/** Gids where the user explicitly dismissed the modal (session only). */
const dismissedGids = new Set<string>();
/** Timestamp until which all Sheets modals are snoozed. */
let snoozeUntil = 0;

function currentGid(): string {
  return parseSheetsUrl(location.href)?.gid ?? "0";
}

function isSheetsModalSuppressed(): boolean {
  if (Date.now() < snoozeUntil) return true;
  if (dismissedGids.has(currentGid())) return true;
  return false;
}

const sheetsModalCallbacks: SheetsModalCallbacks = {
  onDismiss() {
    dismissedGids.add(currentGid());
    debugLog("Sheets modal dismissed for gid:", currentGid());
  },
  onSnooze() {
    snoozeUntil = Date.now() + 10 * 60 * 1000; // 10 minutes
    debugLog("Sheets modal snoozed until", new Date(snoozeUntil).toLocaleTimeString());
  },
};

/**
 * Parse the spreadsheet ID and gid from a Google Sheets URL.
 */
function parseSheetsUrl(url: string): { spreadsheetId: string; gid: string } | null {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return null;
  const gidMatch = url.match(/[#&]gid=(\d+)/);
  return { spreadsheetId: idMatch[1], gid: gidMatch?.[1] ?? "0" };
}

/**
 * Fetch all cell data from the current sheet tab via CSV export,
 * extract DOIs, and trigger a run() so the modal updates.
 */
async function fetchSheetDois(): Promise<void> {
  const parsed = parseSheetsUrl(location.href);
  if (!parsed) return;

  const myGen = sheetFetchGen;
  console.log("[FLoRA:Sheets] Fetching full sheet data via CSV export…");
  const request: SheetFetchRequest = {
    type: "FLORA_SHEET_FETCH",
    spreadsheetId: parsed.spreadsheetId,
    gid: parsed.gid,
  };

  try {
    const response: SheetFetchResponse = await chrome.runtime.sendMessage(request);
    if (myGen !== sheetFetchGen) return; // stale response — tab changed while fetching
    if (!response || response.error || !response.csv) {
      console.warn("[FLoRA:Sheets] CSV fetch failed:", response?.error);
      return;
    }
    sheetCsvDois = extractDOIsFromText(response.csv);
    console.log(`[FLoRA:Sheets] CSV export found ${sheetCsvDois.length} DOIs`);
  } catch (err) {
    if (myGen !== sheetFetchGen) return;
    console.warn("[FLoRA:Sheets] CSV fetch error:", err);
  }

  // Always run — even if CSV fetch failed, this ensures the modal state is
  // re-evaluated after a tab switch (processedDois was already cleared).
  run();
}

// Gate: skip iframes and blocked domains
(async () => {
  if (window !== window.top) {
    if (location.hostname === "pubpeer.com" || location.hostname.endsWith(".pubpeer.com")) {
      const style = document.createElement("style");
      style.textContent = "nav, .breadcrumb, ol.breadcrumb, div.forum-sub-title, div.vertical-timeline-block.add-comment, div.sticky.affix, div.extension-installer.container, div.footer.fixed, div.page-component-up, div.comment-footer.clearfix { display: none !important; } a.forum-item-title {padding-top:10px!important;} div.vertical-timeline-block {margin:0 15px 0px 10px;}";
      (document.head ?? document.documentElement).appendChild(style);
      window.parent.postMessage({ type: "FLORA_PUBPEER_CSS_READY" }, "*");
    }
    return;
  }

  if (await isDomainBlocked(location.hostname)) {
    debugLog("Domain is blocked:", location.hostname);
    return;
  }

  // Show setup prompt if email not configured (non-blocking — extension still runs)
  if (!(await isSetupComplete())) {
    renderSetupPrompt();
  }

  // Run immediately — same timing as PubPeer (fires after webNavigation.onCompleted)
  debouncedRun();

  // SPA pagination detection: watch for significant DOM changes (skip on Sheets —
  // cell clicks/selections cause constant mutations that trigger needless re-scans)
  if (!isSheets) {
  const debouncedReRun = debounce(run, 2000);

  if (document.body) {
    const observer = new MutationObserver((mutations) => {
      let addedCount = 0;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            addedCount++;
          }
        }
      }
      if (addedCount >= 3) {
        debouncedReRun();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // SPA URL-based navigation
  window.addEventListener("popstate", () => debouncedReRun());
  window.addEventListener("hashchange", () => debouncedReRun());
} else {
  // Fetch full sheet data via CSV export to get all DOIs regardless of scroll
  fetchSheetDois();

  // Detect sheet tab switches — Google Sheets uses replaceState, which doesn't
  // fire hashchange/popstate, so we poll for gid changes instead.
  let lastGid = parseSheetsUrl(location.href)?.gid ?? "0";
  setInterval(() => {
    const nowGid = parseSheetsUrl(location.href)?.gid ?? "0";
    if (nowGid !== lastGid) {
      lastGid = nowGid;
      console.log("[FLoRA:Sheets] Tab change detected (gid:", nowGid, ") — re-fetching…");
      sheetFetchGen++;
      sheetCsvDois = [];
      processedDois.clear();
      pageState.clear();
      removeSheetsModal();
      fetchSheetDois();
    }
  }, 1500);
}

})();

// Track whether the popup has hidden FLoRA UI on this page (session only)
let floraHidden = false;

// Listen for popup messages (works regardless of gate checks above)
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== "object" || message === null) return;
  const type = (message as { type?: string }).type;

  if (type === "FLORA_HIDE_UI") {
    floraHidden = true;
    hideAllFloraUI();
    sendResponse({ ok: true });
  } else if (type === "FLORA_SHOW_UI") {
    floraHidden = false;
    showAllFloraUI();
    sendResponse({ ok: true });
  } else if (type === "FLORA_GET_STATE") {
    sendResponse({ hidden: floraHidden });
  }
});
