import { extractDOIs } from "../shared/doi-extractor";
import { augmentDOIs } from "../shared/doi-augment";
import { debounce } from "../shared/debounce";
import type { DoiString, LookupState } from "../shared/types";
import type { LookupRequest, LookupResponse } from "../shared/messages";
import { renderErrorBanner, renderMatchedBanner, removeBanner, renderInlineBadges } from "./injector";

const LOG_PREFIX = "[FLoRA]";

const pageState = new Map<DoiString, LookupState>();
const processedDois = new Set<DoiString>();
let lastUrl = location.href;
let augmentAttempted = false;

/**
 * Silently try to resolve a DOI from the page title via Crossref/OpenAlex.
 * Runs in the background with no UI — only logs to the console.
 */
async function augmentFromTitle(): Promise<void> {
  if (augmentAttempted) return;
  augmentAttempted = true;

  const pageTitle =
    document.querySelector<HTMLHeadingElement>("h1")?.textContent?.trim() ||
    document.title?.trim();

  if (!pageTitle) {
    console.log(`${LOG_PREFIX} No page title available for augmentation`);
    return;
  }

  console.log(`${LOG_PREFIX} No DOIs extracted, augmenting from title in background: "${pageTitle}"`);
  try {
    const augmented = await augmentDOIs([pageTitle]);
    const resolvedDoi = augmented.get(pageTitle);
    if (resolvedDoi) {
      console.log(`${LOG_PREFIX} Title augmented to DOI: ${resolvedDoi} (background, no UI)`);
      processedDois.add(resolvedDoi);

      // Silently look up replication data — log result but don't render any UI
      const request: LookupRequest = { type: "FLORA_LOOKUP", dois: [resolvedDoi] };
      const response: LookupResponse = await chrome.runtime.sendMessage(request);
      if (response.results[resolvedDoi]) {
        console.log(`${LOG_PREFIX} Background augmented DOI ${resolvedDoi} has replication data`);
      } else {
        console.log(`${LOG_PREFIX} Background augmented DOI ${resolvedDoi} has no replication data`);
      }
    } else {
      console.log(`${LOG_PREFIX} Title augmentation found no DOI`);
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Background augmentation failed:`, err);
  }
}

async function run(): Promise<void> {
  console.log(`${LOG_PREFIX} Running on ${location.href}`);

  // Detect full URL change (SPA navigation) — clear state
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    console.log(`${LOG_PREFIX} URL changed: ${lastUrl} → ${currentUrl}`);
    lastUrl = currentUrl;
    processedDois.clear();
    pageState.clear();
    augmentAttempted = false;
    removeBanner();
  }

  const dois = extractDOIs(document);

  // Filter out already-processed DOIs
  const newDois = dois.filter((doi) => !processedDois.has(doi));

  // If no new DOIs found directly, try augmenting from page title in the background
  if (newDois.length === 0 && dois.length === 0) {
    augmentFromTitle();
    if (processedDois.size > 0) {
      console.log(`${LOG_PREFIX} No new DOIs to process (${processedDois.size} already processed)`);
    }
    return;
  }

  if (newDois.length === 0) {
    console.log(`${LOG_PREFIX} No new DOIs to process (${processedDois.size} already processed)`);
    return;
  }

  console.log(`${LOG_PREFIX} Processing ${newDois.length} new DOI(s):`, newDois);

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

    for (const doi of newDois) {
      if (response.errors[doi]) {
        pageState.set(doi, { status: "error", message: response.errors[doi] });
        console.warn(`${LOG_PREFIX} Lookup error for ${doi}: ${response.errors[doi]}`);
      } else if (response.results[doi]) {
        pageState.set(doi, { status: "matched", result: response.results[doi] });
        console.log(`${LOG_PREFIX} MATCH: ${doi} has replication data`);
      } else {
        pageState.set(doi, { status: "no-match" });
        console.log(`${LOG_PREFIX} No replication data for ${doi}`);
      }
    }

    // Collect all matched DOIs for the banner (including previously found)
    const allDois = [...pageState.keys()];
    const matched = allDois
      .filter((doi) => pageState.get(doi)?.status === "matched")
      .map((doi) => ({
        doi,
        result: (pageState.get(doi) as { status: "matched"; result: import("../shared/types").ReplicationResult }).result,
      }));

    if (matched.length > 0) {
      console.log(`${LOG_PREFIX} Rendering banner for ${matched.length} matched DOI(s)`);
      renderMatchedBanner(matched);
    } else {
      removeBanner();
    }

    // Inline badges for all matched DOIs
    renderInlineBadges(pageState);
  } catch (err) {
    console.error(`${LOG_PREFIX} FLoRA lookup failed:`, err);
    renderErrorBanner("Failed to contact FLoRA service");
  }
}

const debouncedRun = debounce(run, 1000);
debouncedRun();

// SPA pagination detection: watch for significant DOM changes
const MIN_ADDED_NODES = 3;
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
    if (addedCount >= MIN_ADDED_NODES) {
      console.log(`${LOG_PREFIX} DOM mutation detected (${addedCount} elements added), re-running`);
      debouncedReRun();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// SPA URL-based navigation
window.addEventListener("popstate", () => {
  console.log(`${LOG_PREFIX} popstate event, re-running`);
  debouncedReRun();
});
window.addEventListener("hashchange", () => {
  console.log(`${LOG_PREFIX} hashchange event, re-running`);
  debouncedReRun();
});
