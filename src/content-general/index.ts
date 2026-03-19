import { extractDOIs, extractDOIsFromText } from "../shared/doi-extractor";
import { augmentDOIs } from "../shared/doi-augment";
import { debounce } from "../shared/debounce";
import type { DoiString, LookupState } from "../shared/types";
import type { LookupRequest, LookupResponse, SheetFetchRequest, SheetFetchResponse } from "../shared/messages";
import { renderErrorBanner, renderMatchedBanner, removeBanner, renderInlineBadges, renderSheetsModal, removeSheetsModal } from "./injector";

const pageState = new Map<DoiString, LookupState>();
const processedDois = new Set<DoiString>();
let lastUrl = location.href;
let augmentAttempted = false;

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
    if (resolvedDoi) {
      processedDois.add(resolvedDoi);
      const request: LookupRequest = { type: "FLORA_LOOKUP", dois: [resolvedDoi] };
      await chrome.runtime.sendMessage(request);
    }
  } catch {
    // Augmentation failed silently
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
    removeBanner();
  }

  let dois = extractDOIs(document);

  // On Sheets, also extract DOIs from the full sheet data fetched via CSV
  if (isSheets && sheetCsvDois.length > 0) {
    const combined = new Set([...dois, ...sheetCsvDois]);
    dois = [...combined];
  }
  if (isSheets) console.log("[FLoRA:Sheets] Extracted DOIs:", dois.length, dois);

  // Filter out already-processed DOIs
  const newDois = dois.filter((doi) => !processedDois.has(doi));

  // If no new DOIs found directly, try augmenting from page title in the background
  if (newDois.length === 0 && dois.length === 0) {
    if (!isSheets) augmentFromTitle();
    return;
  }

  if (newDois.length === 0) return;
  if (isSheets) console.log("[FLoRA:Sheets] New DOIs to look up:", newDois);

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
    if (isSheets) console.log("[FLoRA:Sheets] Lookup response:", response);

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
      .filter(([doi, s]) => s.status === "matched" && (isSheets || currentDois!.has(doi)))
      .map(([doi, s]) => ({
        doi,
        result: (s as { status: "matched"; result: import("../shared/types").ReplicationResult; source: "extracted" }).result,
      }));

    if (isSheets) console.log("[FLoRA:Sheets] Matched DOIs with replication data:", matched.length, matched.map(m => m.doi));

    if (matched.length > 0) {
      if (isSheets) {
        renderSheetsModal(matched);
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

  console.log("[FLoRA:Sheets] Fetching full sheet data via CSV export…");
  const request: SheetFetchRequest = {
    type: "FLORA_SHEET_FETCH",
    spreadsheetId: parsed.spreadsheetId,
    gid: parsed.gid,
  };

  try {
    const response: SheetFetchResponse = await chrome.runtime.sendMessage(request);
    if (response.error || !response.csv) {
      console.warn("[FLoRA:Sheets] CSV fetch failed:", response.error);
      return;
    }
    sheetCsvDois = extractDOIsFromText(response.csv);
    console.log(`[FLoRA:Sheets] CSV export found ${sheetCsvDois.length} DOIs`);
    if (sheetCsvDois.length > 0) {
      run();
    }
  } catch (err) {
    console.warn("[FLoRA:Sheets] CSV fetch error:", err);
  }
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
    const currentGid = parseSheetsUrl(location.href)?.gid ?? "0";
    if (currentGid !== lastGid) {
      lastGid = currentGid;
      console.log("[FLoRA:Sheets] Tab change detected (gid:", currentGid, ") — re-fetching…");
      sheetCsvDois = [];
      processedDois.clear();
      pageState.clear();
      removeSheetsModal();
      fetchSheetDois();
    }
  }, 1500);
}
