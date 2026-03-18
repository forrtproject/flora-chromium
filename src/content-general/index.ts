import { extractDOIs } from "../shared/doi-extractor";
import { augmentDOIs } from "../shared/doi-augment";
import { debounce } from "../shared/debounce";
import type { DoiString, LookupState } from "../shared/types";
import type { LookupRequest, LookupResponse } from "../shared/messages";
import { renderErrorBanner, renderMatchedBanner, removeBanner, renderInlineBadges } from "./injector";

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

  // Filter out already-processed DOIs
  const newDois = dois.filter((doi) => !processedDois.has(doi));

  // If no new DOIs found directly, try augmenting from page title in the background
  if (newDois.length === 0 && dois.length === 0) {
    augmentFromTitle();
    return;
  }

  if (newDois.length === 0) return;

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
      } else if (response.results[doi]) {
        pageState.set(doi, { status: "matched", result: response.results[doi], source: "extracted" });
      } else {
        pageState.set(doi, { status: "no-match" });
      }
    }

    // Collect matched DOIs for the banner — only those currently in the DOM
    const currentDois = new Set(extractDOIs(document));
    const matched = [...pageState.entries()]
      .filter(([doi, s]) => s.status === "matched" && currentDois.has(doi))
      .map(([doi, s]) => ({
        doi,
        result: (s as { status: "matched"; result: import("../shared/types").ReplicationResult; source: "extracted" }).result,
      }));

    if (matched.length > 0) {
      renderMatchedBanner(matched);
    } else {
      removeBanner();
    }

    // Inline badges for all matched DOIs (skip on Google Sheets — banner only)
    if (!isSheets) {
      renderInlineBadges(pageState);
    }
  } catch {
    renderErrorBanner("Failed to contact FLoRA service");
  }
}

const isSheets = location.href.includes("docs.google.com/spreadsheets");
const debouncedRun = debounce(run, 1000);

// Google Sheets needs extra time for the accessibility table to populate (PubPeer pattern: delayed init)
if (isSheets) {
  setTimeout(debouncedRun, 500);
  // TODO: TEMPORARY — inject a fake modal for testing, remove before release
  setTimeout(() => {
    const host = document.createElement("div");
    host.id = "flora-banner-host-temp";
    host.innerHTML = `
      <div role="dialog" aria-labelledby="flora-modal-title" style="
        position:fixed;top:60px;right:24px;z-index:2147483647;
        width:360px;background:#fff;border-radius:12px;
        box-shadow:0 8px 28px rgba(0,0,0,0.18),0 2px 8px rgba(0,0,0,0.08);
        font-family:'Google Sans',Roboto,-apple-system,sans-serif;
        overflow:hidden;animation:floraSlideIn 0.25s ease-out;
      ">
        <!-- Green accent header -->
        <div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:14px 16px;display:flex;align-items:center;gap:10px;">
          <span style="
            background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:13px;
            padding:4px 10px;border-radius:6px;letter-spacing:0.3px;
          ">FLoRA</span>
          <span id="flora-modal-title" style="color:#fff;font-size:13px;font-weight:500;flex:1;">
            Replication Data Found
          </span>
          <span id="flora-temp-close" role="button" tabindex="0" aria-label="Close" style="
            cursor:pointer;color:rgba(255,255,255,0.7);font-size:20px;line-height:1;
            width:28px;height:28px;display:flex;align-items:center;justify-content:center;
            border-radius:50%;transition:background 0.15s;
          " onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='none'">\u00d7</span>
        </div>

        <!-- Body -->
        <div style="padding:16px;">
          <div style="font-size:13px;color:#3c4043;margin-bottom:14px;line-height:1.5;">
            Found replication &amp; reproduction data for <strong style="color:#202124;">5 DOIs</strong> in this spreadsheet.
          </div>

          <!-- Stat cards -->
          <div style="display:flex;gap:10px;margin-bottom:4px;">
            <div style="
              flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
              padding:12px;text-align:center;
            ">
              <div style="font-size:22px;font-weight:600;color:#16a34a;line-height:1;">8</div>
              <div style="font-size:11px;color:#15803d;margin-top:4px;font-weight:500;">Replications</div>
            </div>
            <div style="
              flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
              padding:12px;text-align:center;
            ">
              <div style="font-size:22px;font-weight:600;color:#16a34a;line-height:1;">2</div>
              <div style="font-size:11px;color:#15803d;margin-top:4px;font-weight:500;">Reproductions</div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding:10px 16px 14px;display:flex;justify-content:flex-end;gap:8px;">
          <button id="flora-temp-dismiss" style="
            all:unset;cursor:pointer;padding:7px 18px;font-size:13px;font-weight:500;
            color:#5f6368;border-radius:6px;transition:background 0.15s;
          " onmouseover="this.style.background='#f1f3f4'" onmouseout="this.style.background='none'">Dismiss</button>
          <a href="https://forrt.org/fred_repl_landing_page/" target="_blank" rel="noopener" style="
            all:unset;cursor:pointer;padding:7px 18px;font-size:13px;font-weight:500;
            color:#fff;background:#1a73e8;border-radius:6px;text-align:center;
            transition:background 0.15s;
          " onmouseover="this.style.background='#1557b0'" onmouseout="this.style.background='#1a73e8'">View details</a>
        </div>
      </div>

      <style>
        @keyframes floraSlideIn {
          from { opacity:0; transform:translateY(-8px); }
          to { opacity:1; transform:translateY(0); }
        }
      </style>`;
    document.body.appendChild(host);

    document.getElementById("flora-temp-close")?.addEventListener("click", () => host.remove());
    document.getElementById("flora-temp-dismiss")?.addEventListener("click", () => host.remove());
  }, 1000);
} else {
  debouncedRun();
}

// SPA pagination detection: watch for significant DOM changes
const MIN_ADDED_NODES = isSheets ? 1 : 3;
const debouncedReRun = debounce(run, isSheets ? 3000 : 2000);

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
      debouncedReRun();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// SPA URL-based navigation
window.addEventListener("popstate", () => debouncedReRun());
window.addEventListener("hashchange", () => debouncedReRun());
