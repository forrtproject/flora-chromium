import { observeScholarResults, processScholarResults } from "./observer";
import { debugLog } from "@shared/debug";
import { isSetupComplete } from "@shared/settings";
import { isDomainBlocked } from "@shared/domains";
import { renderSetupPrompt, hideAllFloraUI, showAllFloraUI } from "../content-general/injector";

// Tell the service worker whether FLoRA is active on this tab (toolbar icon).
function reportActiveState(active: boolean): void {
  try {
    chrome.runtime.sendMessage({ type: "FLORA_ACTIVE_STATE", active }).catch(() => {});
  } catch {
    // extension context unavailable — ignore
  }
}

(async () => {
  if (window !== window.top) return;

  if (await isDomainBlocked(location.hostname)) {
    debugLog("Domain is blocked:", location.hostname);
    reportActiveState(false);
    return;
  }
  reportActiveState(true);

  if (!(await isSetupComplete())) {
    renderSetupPrompt();
  }

  debugLog("Scholar content script loaded");

  // Process any results already on the page
  processScholarResults(document);

  // Start observing for dynamically loaded results
  observeScholarResults();
})();

let floraHidden = false;

function hideScholarUI(): void {
  hideAllFloraUI();
  for (const el of document.querySelectorAll<HTMLElement>(".flora-scholar-badge-host")) {
    el.style.display = "none";
  }
  for (const el of document.querySelectorAll<HTMLElement>(".flora-doi-label")) {
    el.style.display = "none";
  }
}

function showScholarUI(): void {
  showAllFloraUI();
  for (const el of document.querySelectorAll<HTMLElement>(".flora-scholar-badge-host")) {
    el.style.display = "";
  }
  for (const el of document.querySelectorAll<HTMLElement>(".flora-doi-label")) {
    el.style.display = "";
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== "object" || message === null) return;
  const type = (message as { type?: string }).type;

  if (type === "FLORA_HIDE_UI") {
    floraHidden = true;
    hideScholarUI();
    reportActiveState(false);
    sendResponse({ ok: true });
  } else if (type === "FLORA_SHOW_UI") {
    floraHidden = false;
    showScholarUI();
    reportActiveState(true);
    sendResponse({ ok: true });
  } else if (type === "FLORA_GET_STATE") {
    sendResponse({ hidden: floraHidden });
  }
});
