import { observeScholarResults, processScholarResults } from "./observer";
import { debugLog } from "../shared/debug";
import { isSetupComplete } from "../shared/settings";
import { renderSetupPrompt } from "../content-general/injector";

(async () => {
  if (window !== window.top) return;

  if (!(await isSetupComplete())) {
    debugLog("Setup incomplete — FLoRA is inactive on Scholar. Open extension options to configure.");
    renderSetupPrompt();
    return;
  }

  debugLog("Scholar content script loaded");

  // Process any results already on the page
  processScholarResults(document);

  // Start observing for dynamically loaded results
  observeScholarResults();
})();
