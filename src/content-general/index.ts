import {
    classifyPageDois,
    extractDOIs,
    extractDOIsFromText,
    extractDoiOccurrences,
    extractPrimaryDOI,
    findReferenceEntries
} from "@shared/doi-extractor";
import {augmentDOIs, fetchTitleByDoi} from "@shared/doi-augment";
import {validateDOIs} from "@shared/doi-validate";
import {debounce} from "@shared/debounce";
import type {DoiContext, DoiString, LookupState} from "@shared/types";
import type {
    LookupRequest,
    LookupResponse,
    SheetFetchRequest,
    SheetFetchResponse
} from "@shared/messages";
import {
    hideAllFloraUI,
    removeBanner,
    removePubPeerPanel,
    removeSheetsModal,
    renderErrorBanner,
    renderInlineBadges,
    renderPubPeerPanel,
    renderSetupPrompt,
    renderSheetsModal,
    type SheetsModalCallbacks,
    showAllFloraUI
} from "./injector";
import {lookupPubPeer, lookupPubPeerForDois, type PubPeerFeedback} from "@shared/pubpeer-api";
import {debugLog} from "@shared/debug";
import {isSetupComplete} from "@shared/settings";
import {isDomainBlocked} from "@shared/domains";
import {injectRetractionInfo, resetRetractionPills, retractionCheck, RetractionResponse} from "@shared/doi-retraction"
import {processReferenceDois} from "./references";

const pageState = new Map<DoiString, LookupState>();
let redacts: RetractionResponse[] = [];
// Keep memory of detected DOIs to track dynamic page changes
const processedDois = new Set<DoiString>();
const doiContext = new Map<DoiString, DoiContext>();
let lastUrl = location.href;
let augmentAttempted = false;
let articleFeedbacksFetched = false;
let lastReferenceDoiKey = "";
let lastArticleFeedbacks: PubPeerFeedback[] = [];
let lastRefFeedbackByDoi: Map<DoiString, PubPeerFeedback> = new Map();

/** Monotonic counter — incremented on each sheet tab switch to discard stale CSV responses. */
let sheetFetchGen = 0;
// DOIs extracted from the full sheet CSV (populated asynchronously on Sheets)
let sheetCsvDois: DoiString[] = [];
// Sheets modal: per-gid dismiss tracking & snooze
// Gids where the user explicitly dismissed the modal (session only).
const dismissedGids = new Set<string>();
// Timestamp until which all Sheets modals are snoozed.
let snoozeUntil = 0;
// Google sheets match condition
const isSheets = location.href.includes("docs.google.com/spreadsheets");
// Track whether the popup has hidden FLoRA UI on this page (session only)
let floraHidden = false;
let dismissRedacts = false;

// Listen for popup messages (works regardless of gate checks above)
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return;
    const type = (message as { type?: string }).type;

    if (type === "FLORA_HIDE_UI") {
        floraHidden = true;
        hideAllFloraUI();
        sendResponse({ok: true});
    } else if (type === "FLORA_SHOW_UI") {
        floraHidden = false;
        showAllFloraUI();
        sendResponse({ok: true});
    } else if (type === "FLORA_GET_STATE") {
        sendResponse({hidden: floraHidden});
    }
});

async function pageRenderChangeHandler(): Promise<void> {
    // Detect full URL change (SPA navigation) — clear state
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        processedDois.clear();
        doiContext.clear();
        lastArticleFeedbacks = [];
        lastRefFeedbackByDoi = new Map();
        articleFeedbacksFetched = false;
        lastReferenceDoiKey = "";
        pageState.clear();
        augmentAttempted = false;
        resetRetractionPills();
        if (isSheets) {
            removeSheetsModal();
        } else {
            removePubPeerPanel();
        }
    }
    // Resolve & inline-render DOIs for DOI-less reference-list entries.
    // Fire-and-forget; idempotent via a per-entry processed marker.
    void processReferenceDois();

    let dois = extractDOIs(document);
    // Capture DOI occurrences (with source + anchor) at extraction time so
    // renderInlineBadges can place badges directly on the right DOM element
    // without re-scanning. The anchor lifts to the reference entry for DOIs
    // inside a citation so badges don't land next to a tiny "Crossref" button.
    const occurrences = extractDoiOccurrences(document);

    const hasDoiChange = processedDois.size !== dois.length ||
        !dois.every(doi => processedDois.has(doi));

    // On Sheets, also extract DOIs from the full sheet data fetched via CSV
    if (isSheets && sheetCsvDois.length > 0) {
        const combined = new Set([...dois, ...sheetCsvDois]);
        dois = [...combined];
    } else if (hasDoiChange) {
        const classified = classifyPageDois(document);
        for (const doi of classified.articleDois) doiContext.set(doi, "article");
        for (const doi of classified.referenceDois) doiContext.set(doi, "reference");
        for (const doi of classified.otherDois) doiContext.set(doi, "other");
        dois = [...classified.articleDois, ...classified.referenceDois, ...classified.otherDois];
        debugLog("General: pageType =", classified.pageType);
        debugLog(classified.articleDois, "article DOIs,", classified.referenceDois, "reference DOIs,", classified.otherDois, "other DOIs");
    }
    debugLog(isSheets ? "Sheets:" : "General:", "Extracted DOIs:", dois.length, dois);

    // Validate extracted DOIs via doi.org — remove invalid ones
    if (hasDoiChange && !isSheets && dois.length > 0) {
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

    // retraction check logic
    if (hasDoiChange && dois.length > 0) {
        // Retraction status is tracked via `redacts` — kept separate from
        // doiContext so it can't clobber the article/reference classification
        // (a DOI can be both the article and retracted).
        redacts = await retractionCheck(dois);
    }

    // Exclude occurrences whose anchor sits inside FLoRA-injected UI elements
    // (the PubPeer panel, retracts modal, banner). Without this guard the
    // mutation observer re-fires after each UI injection, extractDoiOccurrences
    // picks up DOI links inside the panel, and we'd stamp retraction pills onto
    // our own panel's reference rows.
    const FLORA_UI_IDS = ["flora-pubpeer-panel", "flora-retracts-modal", "flora-banner-host", "flora-setup-prompt", "flora-sheets-modal"];
    const pageOccurrences = occurrences.filter(
        (occ) => !FLORA_UI_IDS.some((id) => occ.anchor.closest(`#${id}`) !== null)
    );

    // Render inline "Retracted" pills at every occurrence of a retracted DOI
    // on the page (reference entries, body links, prose mentions). Uses the
    // anchors captured by extractDoiOccurrences so the renderer never has to
    // re-scan the DOM; idempotent via FLORA_RET_CHECK_KEY on each anchor.
    if (redacts.length > 0) {
        const retractionByDoi = new Map(redacts.map((r) => [r.originDoi, r] as const));
        for (const occ of pageOccurrences) {
            const retraction = retractionByDoi.get(occ.doi);
            if (retraction) injectRetractionInfo(occ.anchor, retraction);
        }
    }

    // Filter out already-processed DOIs
    const newDois = dois.filter((doi) => !processedDois.has(doi));

    // If no valid DOIs found, try augmenting from page title in the background
    if (newDois.length === 0 && dois.length === 0) {
        debugLog("No valid DOIs found on page, attempting title augmentation");
        if (!isSheets) augmentFromTitle().then().catch();
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
        pageState.set(doi, {status: "loading"});
    }

    const request: LookupRequest = {type: "FLORA_LOOKUP", dois: newDois};

    try {
        const response: LookupResponse =
            await chrome.runtime.sendMessage(request);
        debugLog("Lookup response:", Object.keys(response.results).length, "results,", Object.keys(response.errors).length, "errors");

        for (const doi of newDois) {
            if (response.errors[doi]) {
                pageState.set(doi, {
                    status: "error",
                    message: response.errors[doi]
                });
            } else if (response.results[doi]) {
                pageState.set(doi, {
                    status: "matched",
                    result: response.results[doi],
                    source: "extracted"
                });
            } else {
                pageState.set(doi, {status: "no-match"});
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
                result: (s as {
                    status: "matched";
                    result: import("../shared/types").ReplicationResult;
                    source: "extracted"
                }).result,
            }));

        debugLog("Matched DOIs with replication data:", matched.length, matched.map(m => m.doi));
        if (matched.length > 0) {
            if (isSheets) {
                if (!isSheetsModalSuppressed()) {
                    renderSheetsModal(matched, sheetsModalCallbacks);
                }
            } else {
                void checkPubPeer();
            }
        } else {
            if (isSheets) {
                removeSheetsModal();
            } else {
                void checkPubPeer();
                // removeBanner();
            }
        }

        // Inline badges (skip on Google Sheets — modal only)
        if (!isSheets) {
            renderInlineBadges(pageState, pageOccurrences);
        }
    } catch {
        renderErrorBanner("Failed to contact FLoRA service");
    }
}

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
            const request: LookupRequest = {
                type: "FLORA_LOOKUP",
                dois: [resolvedDoi]
            };
            await chrome.runtime.sendMessage(request);
        }
    } catch {
        // Augmentation failed silently
    }
}

async function checkPubPeer(): Promise<void> {
    if (isSheets) return;
    const primaryDoi = extractPrimaryDOI(document);
    if (!primaryDoi) return;
    try {
        // Source of truth for "what counts as a reference" = the page's actual
        // reference-list entries. Using classifyPageDois().referenceDois here
        // would pull in DOIs from related-articles sidebars or any element
        // whose class/id matches the reference regex — phantom rows in the panel.
        const seen = new Set<DoiString>();
        const referenceDois: DoiString[] = [];
        for (const entry of findReferenceEntries(document)) {
            if (!entry.doi || seen.has(entry.doi)) continue;
            seen.add(entry.doi);
            referenceDois.push(entry.doi);
        }

        // Content-keyed gate: skip re-rendering when the article side is
        // already fetched AND the set of reference DOIs is unchanged. This is
        // what lets lazily-loaded references (e.g. Wiley's collapsible "Citing
        // Literature" / references section) flow into the panel — the DOM
        // observer fires checkPubPeer again, finds new DOIs, and re-renders.
        const refKey = [...referenceDois].sort().join("|");
        if (articleFeedbacksFetched && refKey === lastReferenceDoiKey) return;

        // Article: URL-based lookup, fetched once per page. References: one
        // batched lookup keyed by DOI (PubPeer's v3 endpoint returns `id` =
        // the DOI), cached in chrome.storage so lazy-load re-runs are cheap.
        const articlePromise = articleFeedbacksFetched
            ? Promise.resolve(lastArticleFeedbacks)
            : lookupPubPeer([primaryDoi], [location.href]);
        const [articleFeedbacks, refFeedbackByDoi] = await Promise.all([
            articlePromise,
            lookupPubPeerForDois(referenceDois),
        ]);
        articleFeedbacksFetched = true;
        lastArticleFeedbacks = articleFeedbacks;
        lastRefFeedbackByDoi = refFeedbackByDoi;
        lastReferenceDoiKey = refKey;

        // The panel only lists references worth a reader's attention: those
        // with PubPeer comments, a retraction, or FORRT replication data.
        // Titles are taken from PubPeer when it has the paper, otherwise
        // resolved from Crossref/OpenAlex — never from page-scraped citation
        // text, which varies too much between publishers to render cleanly.
        const retractedDois = new Set(redacts.map((r) => r.originDoi));
        const hasReplication = (doi: DoiString): boolean => {
            const s = pageState.get(doi);
            if (s?.status !== "matched") return false;
            const {n_replications_total, n_reproductions_total, n_originals_total} =
                s.result.record.stats;
            return n_replications_total > 0 || n_reproductions_total > 0 || n_originals_total > 0;
        };
        // A PubPeer record can exist with zero comments — only count it as a
        // reason to surface the reference when it actually has comments.
        const flagged = referenceDois.filter((doi) => {
            const fb = refFeedbackByDoi.get(doi);
            return (fb !== undefined && fb.total_comments > 0)
                || retractedDois.has(doi)
                || hasReplication(doi);
        });
        const panelRefs = await Promise.all(flagged.map(async (doi) => {
            const title = refFeedbackByDoi.get(doi)?.title
                ?? (await fetchTitleByDoi(doi))
                ?? doi;
            return {doi, title};
        }));

        renderPubPeerPanel(articleFeedbacks, panelRefs, pageState, doiContext, refFeedbackByDoi, redacts);
    } catch {
        // PubPeer is supplementary — fail silently
    }
}

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
function parseSheetsUrl(url: string): {
    spreadsheetId: string;
    gid: string
} | null {
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) return null;
    const gidMatch = url.match(/[#&]gid=(\d+)/);
    return {spreadsheetId: idMatch[1], gid: gidMatch?.[1] ?? "0"};
}

/**
 * Fetch all cell data from the current sheet tab via CSV export,
 * extract DOIs, and trigger a run() so the modal updates.
 */
async function fetchSheetDois(): Promise<void> {
    const parsed = parseSheetsUrl(location.href);
    if (!parsed) return;

    const myGen = sheetFetchGen;
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
    pageRenderChangeHandler();
}

function startDomListener(callback: () => void) {
    let debounceTimer: number;
    const observer = new MutationObserver((mutations) => {
        const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
        if (hasNewNodes) {
            clearTimeout(debounceTimer);
            debounceTimer = window.setTimeout(() => {
                callback()
            }, 300);
        }
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Gate: skip iframes and blocked domains
(async () => {
    if (window !== window.top) {
        if (location.hostname === "pubpeer.com" || location.hostname.endsWith(".pubpeer.com")) {
            const style = document.createElement("style");
            style.textContent = "body.top-navigation{overflow:hidden!important;} nav, .breadcrumb, ol.breadcrumb, div.forum-sub-title, div.sticky.affix, div.sticky.affix-top, div.extension-installer.container, div.footer.fixed, div.page-component-up, a.forum-item-title { display: none !important; } div.vertical-timeline-block {margin:0 15px 0px 10px;} div.selected div {background-color: transparent!important;} div.wrapper {width: 500px!important;} ul.nav.nav-tabs>li>a{color:#fff!important;} ul.nav.nav-tabs>li:nth-child(2).active>a{color:#853953!important;} ul.nav.nav-tabs>li:nth-child(1).active>a{color:#853953!important;} .ibox-title div, .ibox-title strong, .ibox-title span, .ibox-title em, .ibox-content a{color:#853953!important;}  .all-user-footer div:nth-child(1){visibility:hidden;} .el-button{background-color:#853953!important; border-color:#853953!important;} .ibox-bordered:before{background-color:#853953!important;} .btn-link.manual-file-chooser-text{color:#853953!important;}  .el-button.el-button--text{background:transparent!important;border-color:transparent!important;color:#853953!important;}}";
            (document.head ?? document.documentElement).appendChild(style);
            window.parent.postMessage({type: "FLORA_PUBPEER_CSS_READY"}, "*");

            const stripCommentAccepted = (root: Node = document.body): void => {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                const nodes: Text[] = [];
                while (walker.nextNode()) nodes.push(walker.currentNode as Text);
                for (const node of nodes) {
                    if (/comment accepted /i.test(node.nodeValue ?? "")) {
                        node.nodeValue = (node.nodeValue ?? "").replace(/comment accepted /gi, "");
                    }
                }
            };
            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    for (const n of m.addedNodes) stripCommentAccepted(n);
                }
            });
            const startStripping = (): void => {
                stripCommentAccepted();
                observer.observe(document.body, {childList: true, subtree: true});
            };
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", startStripping);
            } else {
                startStripping();
            }

            const sendHeight = (): void => {
                const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
                window.parent.postMessage({type: "FLORA_PUBPEER_HEIGHT", height: h}, "*");
            };
            window.addEventListener("load", sendHeight);
            new ResizeObserver(sendHeight).observe(document.documentElement);
        }
        return;
    }

    if (await isDomainBlocked(location.hostname)) {
        debugLog("Domain is blocked:", location.hostname);
        return;
    }
    // Show setup prompt if email not configured (non-blocking — extension still runs)
    if (!(await isSetupComplete())) {
        renderSetupPrompt().then().catch();
    }
    if (isSheets) {
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
    } else {
        debounce(pageRenderChangeHandler, 1000);
        startDomListener(pageRenderChangeHandler);
    }
})();
