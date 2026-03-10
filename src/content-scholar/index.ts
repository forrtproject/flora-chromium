import { observeScholarResults, processScholarResults } from "./observer";

console.log("[FLoRA] Scholar content script loaded");

// Process any results already on the page
processScholarResults(document);

// Start observing for dynamically loaded results
observeScholarResults();
