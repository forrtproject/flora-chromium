import {containsDoiCandidate} from "@shared/doi-extractor";
import {isExternalMutation, isFloraOwnedNode} from "@shared/flora-ui";
import {debugLog} from "@shared/debug";

// Above this many added subtrees in one debounce window, probing each one costs
// more than the scan it is trying to avoid.
const MAX_INCREMENTAL_NODES = 50;

const DEBOUNCE_MS = 300;

/** True when any added subtree actually introduces DOI-like content. */
export function scanAddedNodes(nodes: Element[]): boolean {
    for (const el of nodes) {
        if (!el.isConnected) continue;
        if (containsDoiCandidate(el)) return true;
    }
    return false;
}

export interface DomListenerOptions {
    /** Full-page rescan. Run for the initial load, SPA navigation, structural
     *  changes, and any mutation that brings DOI-like content onto the page. */
    scanWholePage: () => void;
    /** Current URL as of the last full scan — a change means SPA navigation. */
    getLastUrl: () => string;
}

/**
 * Watch the page for changes worth rescanning. Mutations that carry no DOI-like
 * content — ads, cookie banners, chat widgets, SPA chrome — are dropped after a
 * cheap per-node probe instead of triggering a full document extraction.
 */
export function startDomListener({scanWholePage, getLastUrl}: DomListenerOptions): MutationObserver {
    let debounceTimer: ReturnType<typeof setTimeout>;
    let pendingNodes: Element[] = [];
    let pendingFullScan = false;

    const flush = (): void => {
        const nodes = pendingNodes;
        const full = pendingFullScan;
        pendingNodes = [];
        pendingFullScan = false;
        // SPA navigation resets all page state, so it always needs a full pass.
        if (full || location.href !== getLastUrl() || scanAddedNodes(nodes)) {
            scanWholePage();
        } else {
            debugLog("General: mutation carried no DOI candidates — skipped full scan");
        }
    };

    const observer = new MutationObserver((mutations) => {
        // Do no work while this tab is in the background.
        if (document.hidden) return;
        let hasExternalChange = false;
        for (const m of mutations) {
            if (!isExternalMutation(m)) continue;
            hasExternalChange = true;
            // A re-render of the page shell can't be reasoned about node by node.
            if (m.target === document.body || m.target === document.documentElement) {
                pendingFullScan = true;
            }
            for (const node of m.addedNodes) {
                if (isFloraOwnedNode(node)) continue;
                pendingNodes.push(node as Element);
            }
        }
        if (!hasExternalChange) return;
        if (pendingNodes.length > MAX_INCREMENTAL_NODES) pendingFullScan = true;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flush, DEBOUNCE_MS);
    });
    observer.observe(document.body, {childList: true, subtree: true});
    // Re-scan when the tab becomes active again — mutations that happened while
    // it was hidden were ignored above.
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) scanWholePage();
    });
    return observer;
}
