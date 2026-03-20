import { observeScholarResults, processScholarResults } from "./observer";
import { debugLog } from "../shared/debug";

debugLog("Scholar content script loaded");

// Process any results already on the page
processScholarResults(document);

// Start observing for dynamically loaded results
observeScholarResults();
