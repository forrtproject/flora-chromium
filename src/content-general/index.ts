import { extractDOIs } from "../shared/doi-extractor";
import { augmentDOIs } from "../shared/doi-augment";
import { debounce } from "../shared/debounce";
import type { DoiString, LookupState } from "../shared/types";
import type { LookupRequest, LookupResponse } from "../shared/messages";
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

  const dois = extractDOIs(document);
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

// Google Sheets needs extra time for all data to load into the DOM
if (isSheets) {
  setTimeout(debouncedRun, 5000);
} else {
  debouncedRun();
}

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
  // On Sheets, only re-scan when switching sheet tabs
  window.addEventListener("hashchange", () => debounce(run, 2000)());
}
