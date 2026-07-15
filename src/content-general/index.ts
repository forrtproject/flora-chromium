import {
    beginDomScanPass,
    chooseArticleTitleElement,
    classifyPageDois,
    extractDOIs,
    extractDOIsFromText,
    extractDoiOccurrences,
    extractPrimaryDOI,
    type DoiOccurrence
} from "@shared/doi-extractor";
import {fetchTitleByDoi, type DoiAugmentRequest} from "@shared/doi-augment";
import {validateDOIs} from "@shared/doi-validate";
import type {ClassifiedDois, DoiContext, DoiString, LookupState} from "@shared/types";
import {
    safeSendMessage,
    augmentDOIsViaWorker,
    type LookupRequest,
    type LookupResponse,
    type SheetFetchRequest,
    type SheetFetchResponse
} from "@shared/messages";
import {
    beginWorkIndicator,
    endWorkIndicator,
    hideAllFloraUI,
    removeSidePanel,
    removeSheetsModal,
    renderErrorBanner,
    renderInlineBadges,
    renderSidePanel,
    renderSetupPrompt,
    renderSheetsModal,
    type SheetsModalCallbacks,
    showAllFloraUI
} from "./injector";
import {lookupPubPeer, lookupPubPeerForDois, type PubPeerFeedback} from "@shared/pubpeer-api";
import {debugLog} from "@shared/debug";
import {isSetupComplete} from "@shared/settings";
import {isDomainBlocked} from "@shared/domains";
import {
    FLORA_RET_CHECK_KEY,
    hasConnectedNoticePill,
    injectRetractionInfo,
    resetRetractionPillDoi,
    resetRetractionPills,
    retractionCheck,
    RetractionResponse,
} from "@shared/doi-retraction"
import {resolveReferenceDois, renderResolvedReferences, type ResolvedReference} from "./references";
import {couldNodeIntroduceDoi, scanFingerprint} from "./scan-gate";
import {createPassScheduler, registerStuckRetry, type ScanHint} from "./pass-scheduler";

// PubPeer commenter IDs whose comments are hidden in the embedded iframe.
// Add any bot/org account ID here to suppress its annotations from the panel.
const HIDDEN_PUBPEER_COMMENTER_IDS = new Set([
    "FORRT",
]);

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
// Monotonically increments when FORRT lookup results land in pageState.
let pageStateVersion = 0;
let lastRenderedPageStateVersion = -1;
// Perf gating (see startDomListener / pageRenderChangeHandler):
//  - `everYieldedDoi` latches true the first time this page URL surfaces ANY
//    DOI. Until then, an irrelevant, non-scholarly page is scanned only by a
//    cheap per-mutation probe rather than the full pipeline.
//  - `lastScanFingerprint` memoises the last-scanned page state so a pass whose
//    inputs are unchanged skips the full pipeline entirely.
let everYieldedDoi = false;
let lastScanFingerprint: string | null = null;

// ── Concurrency control (see pageRenderChangeHandler / runRenderPass). ────────
// The scheduler serializes passes (one at a time, at most one coalesced re-run)
// and owns the generation token: incremented the instant an SPA URL change is
// observed, so a pass begun on page A can never commit its results (state
// writes, pill injection, panel render) after navigation to page B. Every pass
// captures `scheduler.capture()` at its start and re-checks `scheduler.isStale`
// after each await.
const scheduler = createPassScheduler(runInstrumentedPass);

// Per-page retry budget for DOIs whose lookup came back empty because the
// service worker was restarting (safeSendMessage → null, common in Opera). Such
// DOIs are rolled out of `processedDois` so a later pass retries them; the cap
// stops a permanently-dead worker from looping forever. Cleared on SPA nav.
const doiRetryCount = new Map<DoiString, number>();
const MAX_DOI_RETRIES = 3;

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

// Tell the service worker whether FLoRA is active on this tab so it can swap the
// toolbar icon (maroon = active, gray = inactive).
function reportActiveState(active: boolean): void {
    try {
        chrome.runtime.sendMessage({type: "FLORA_ACTIVE_STATE", active}).catch(() => {});
    } catch {
        // extension context unavailable — ignore
    }
}

// Listen for popup messages (works regardless of gate checks above)
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return;
    const type = (message as { type?: string }).type;

    if (type === "FLORA_HIDE_UI") {
        floraHidden = true;
        hideAllFloraUI();
        reportActiveState(false);
        sendResponse({ok: true});
    } else if (type === "FLORA_SHOW_UI") {
        floraHidden = false;
        showAllFloraUI();
        reportActiveState(true);
        sendResponse({ok: true});
    } else if (type === "FLORA_GET_STATE") {
        sendResponse({hidden: floraHidden});
    }
});

// Benchmark-only instrumentation, inert in normal use. When the page carries
// `data-flora-perf` on <html>, each render pass dispatches a `flora-perf-pass`
// DOM event with its duration and how the pass resolved (a content script and
// the page share the DOM but not JS globals, so a DOM event is how timing
// crosses out). See scripts/bench-scan-gating.ts.
function perfEnabled(): boolean {
    return document.documentElement?.hasAttribute?.("data-flora-perf") ?? false;
}

let _lastPassKind = "";
async function runInstrumentedPass(hint?: ScanHint): Promise<void> {
    if (!perfEnabled()) return runRenderPass(hint);
    const t0 = performance.now();
    _lastPassKind = "full";
    try {
        await runRenderPass(hint);
    } finally {
        document.dispatchEvent(
            new CustomEvent("flora-perf-pass", {
                detail: { ms: performance.now() - t0, kind: _lastPassKind },
            }),
        );
    }
}

/**
 * Entry point for every trigger (initial run, mutation observer, visibility
 * change, Sheets CSV fetch). Bumps the generation token the instant SPA
 * navigation is observed — BEFORE the scheduler's serialization check, so a
 * navigation is never masked by a coalesced re-run — then hands off to the
 * scheduler, which serializes and coalesces the actual pass.
 */
function pageRenderChangeHandler(hint?: ScanHint): Promise<void> {
    if (location.href !== lastUrl) {
        scheduler.bumpGeneration();
    }
    return scheduler.trigger(hint);
}

async function runRenderPass(hint?: ScanHint): Promise<void> {
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
        lastRenderedPageStateVersion = -1;
        pageState.clear();
        augmentAttempted = false;
        doiRetryCount.clear();
        // New page — reset the relevance latch and the skip-unchanged memo.
        everYieldedDoi = false;
        lastScanFingerprint = null;
        resetRetractionPills();
        if (isSheets) {
            removeSheetsModal();
        } else {
            removeSidePanel();
        }
    }

    // Capture the generation for this pass. The scheduler bumped it above (in
    // pageRenderChangeHandler) when it observed the URL change; every async
    // continuation below re-checks it and aborts if a newer navigation has
    // superseded this pass.
    const myGen = scheduler.capture();

    // ── Cheap gating before any full-DOM scan (non-Sheets only). ──────────────
    // Sheets uses a canvas-backed grid + CSV export and its own paths, so these
    // DOM-text gates don't apply there.
    if (!isSheets) {
        // (1) Relevance pre-gate. A page that has never yielded a DOI and is not
        // a scholarly article gets only a cheap probe: `hint.couldBeRelevant` is
        // true iff a node added in THIS mutation batch contains the literal
        // "10.<4+ digits>" registrant that begins every serialised DOI (in text,
        // an href, or a meta value — see startDomListener). If nothing DOI-like
        // was added, this pass cannot surface a new DOI, so bail without reading
        // the DOM. Invariant preserved: (a) DOIs present at the initial full scan
        // are caught by it (that pass carries no hint); (b) any DOI introduced
        // later arrives inside an added subtree whose markup contains that
        // registrant substring, flipping couldBeRelevant true; (c) once ANY DOI
        // is found, `everYieldedDoi` latches and this gate is disabled for the
        // rest of the page's life; (d) a tab re-show re-runs with no hint (full
        // scan). So no DOI-bearing content can permanently escape detection.
        if (hint && !hint.couldBeRelevant && !everYieldedDoi && !isScholarlyArticlePage()) {
            debugLog("General: pre-gate skip — no DOI-like content added to an irrelevant page");
            _lastPassKind = "pregate-bail";
            return;
        }

        // (2) Skip-unchanged memo. If the scanned text (and our own placed-UI
        // count) is identical to the last pass, nothing to do. textContent does
        // NOT force layout (unlike innerText), so this fingerprint is cheap
        // relative to the full pipeline it guards.
        const fp = scanFingerprint();
        if (fp === lastScanFingerprint) {
            debugLog("General: fingerprint unchanged — skipping full scan");
            _lastPassKind = "fingerprint-skip";
            return;
        }
        lastScanFingerprint = fp;
    }

    // Fresh DOM scan pass — resets the per-pass findReferenceContainers memo.
    beginDomScanPass();

    // Resolve reference-list DOIs in parallel with the FORRT lookup below.
    // Pass-local (not module-global) so overlapping passes can't observe or
    // render each other's resolved list — the source of duplicate DOI pills.
    const resolvedRefsPromise: Promise<ResolvedReference[]> = resolveReferenceDois();
    // A page whose only DOIs come from reference augmentation (entries with no
    // on-page DOI) still counts as relevant — latch the pre-gate open so later
    // mutations (e.g. more citations streaming in) keep getting full scans.
    resolvedRefsPromise.then((refs) => {
        if (refs.length > 0) everYieldedDoi = true;
    }).catch(() => {});

    // Single position-aware scan for this pass — reused for classification,
    // badge placement, and the post-lookup "still in DOM" recheck.
    const occurrences = extractDoiOccurrences(document);

    // Non-Sheets: one classification scan (allDois), reusing `occurrences` so no
    // extra a[href] sweep or body-text read. Sheets: canvas extractDOIs + CSV.
    let dois: DoiString[];
    let classified: ClassifiedDois | null = null;
    if (isSheets) {
        dois = extractDOIs(document);
        if (sheetCsvDois.length > 0) {
            dois = [...new Set([...dois, ...sheetCsvDois])];
        }
    } else {
        classified = classifyPageDois(document, occurrences);
        dois = classified.allDois;
    }

    // Latch the relevance gate open the moment this page surfaces any DOI.
    if (dois.length > 0) everYieldedDoi = true;

    const hasDoiChange = processedDois.size !== dois.length ||
        !dois.every(doi => processedDois.has(doi));

    // Populate per-DOI context only when the set changed (idempotent map sets).
    if (classified && hasDoiChange) {
        for (const doi of classified.articleDois) doiContext.set(doi, "article");
        for (const doi of classified.referenceDois) doiContext.set(doi, "reference");
        for (const doi of classified.otherDois) doiContext.set(doi, "other");
        debugLog("General: pageType =", classified.pageType);
        debugLog(classified.articleDois, "article DOIs,", classified.referenceDois, "reference DOIs,", classified.otherDois, "other DOIs");
    }
    debugLog(isSheets ? "Sheets:" : "General:", "Extracted DOIs:", dois.length, dois);

    // Validate extracted DOIs via doi.org — remove invalid ones
    if (hasDoiChange && !isSheets && dois.length > 0) {
        beginWorkIndicator();
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
        } finally {
            endWorkIndicator();
        }
    }

    // Drop occurrences inside FLoRA's own UI so we don't pill our own panel rows.
    const FLORA_UI_IDS = ["flora-pubpeer-panel", "flora-retracts-modal", "flora-banner-host", "flora-setup-prompt", "flora-sheets-modal"];
    const pageOccurrences = occurrences.filter(
        (occ) => !FLORA_UI_IDS.some((id) => occ.anchor.closest(`#${id}`) !== null)
    );

    // One retraction check for occurrences + resolved refs; held in `redacts`.
    if (hasDoiChange && dois.length > 0) {
        const resolvedRefs = await resolvedRefsPromise;
        if (scheduler.isStale(myGen)) return; // superseded by a newer navigation
        const allNoticeDois = Array.from(new Set([
            ...dois,
            ...resolvedRefs.map((r) => r.doi),
        ]));
        redacts = await retractionCheck(allNoticeDois);
        if (scheduler.isStale(myGen)) return;

        const retractionByDoi = new Map(redacts.map((r) => [r.originDoi, r] as const));
        const articleDois = new Set(
            [...doiContext.entries()].filter(([, ctx]) => ctx === "article").map(([doi]) => doi)
        );
        const titleEl = chooseArticleTitleElement(document);

        // Article notice → pinned inline at the end of the page title for a
        // consistent spot across sites, instead of at whatever DOI occurrence
        // happens to exist.
        if (titleEl) {
            for (const doi of articleDois) {
                const notice = retractionByDoi.get(doi);
                if (notice) injectRetractionInfo(titleEl, notice, { append: true });
            }
        }

        // Inline pills for remaining (reference/other) occurrences. Article DOIs
        // are handled at the title above when a title element exists.
        for (const occ of pageOccurrences) {
            const notice = retractionByDoi.get(occ.doi);
            if (!notice) continue;
            if (titleEl && articleDois.has(occ.doi)) continue;
            injectRetractionInfo(occ.anchor, notice);
        }

        // Pills for augmented refs with no on-page anchor (idempotent).
        renderResolvedReferences(resolvedRefs, retractionByDoi);
    }

    // Filter out already-processed DOIs
    const newDois = dois.filter((doi) => !processedDois.has(doi));

    // If no valid DOIs found, try augmenting from page title in the background
    if (newDois.length === 0 && dois.length === 0) {
        debugLog("No valid DOIs found on page, attempting title augmentation");
        if (!isSheets) augmentFromTitle(myGen).then().catch();
        if (!isSheets) void checkPubPeer(resolvedRefsPromise, myGen);
        return;
    }

    if (newDois.length === 0) {
        debugLog("No new DOIs (all already processed)");
        if (!isSheets) {
            // Re-place inline badges against the live DOM — hydrating SPAs (e.g.
            // Sage) re-render and wipe a previously placed badge, and this pass
            // (triggered by that mutation) would otherwise return without it.
            renderInlineBadges(pageState, pageOccurrences);
            // A hydration wipe also strips reference DOI pills and notice pills.
            // This !hasDoiChange pass runs precisely because that wipe changed the
            // placed-FLoRA-UI count (see scanFingerprint). resolveReferenceDois
            // re-resolves the fresh (un-marked) entries, so re-render their pills;
            // per-entry / per-DOI idempotence leaves intact pills untouched.
            const resolvedRefs = await resolvedRefsPromise;
            if (scheduler.isStale(myGen)) return;
            const retractionByDoi = new Map(redacts.map((r) => [r.originDoi, r] as const));
            renderResolvedReferences(resolvedRefs, retractionByDoi);
            reinjectMissingNoticePills(pageOccurrences);
            void checkPubPeer(resolvedRefsPromise, myGen);
        }
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

    beginWorkIndicator();
    try {
        const response = await safeSendMessage<LookupResponse>(request);
        if (scheduler.isStale(myGen)) return; // superseded by a newer navigation
        if (!response) {
            // Null response — the service worker was restarting (common in Opera)
            // or the extension context was invalidated. These DOIs are stuck in
            // `processedDois` as "loading" and would never be retried until a
            // navigation. Roll them back so a later pass retries, capped per DOI
            // so a permanently-dead worker can't loop forever.
            rollBackStuckDois(newDois);
            return;
        }
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
        pageStateVersion++; // signal that replication data is now available

        // Collect matched DOIs for display.
        // "Still in DOM" recheck WITHOUT a second full scan: reuse this pass's
        // shared artifact. Authoritative DOIs (URL/meta/JSON-LD) never leave via
        // a DOM mutation; every other DOI is "still present" iff one of its
        // occurrence anchors is still connected to the live document (an anchor
        // wiped by a concurrent SPA re-render reports isConnected === false).
        // On Sheets, skip the recheck — the canvas DOM is unreliable.
        const currentDois = isSheets ? null : (() => {
            const present = new Set<DoiString>(classified!.articleDois);
            for (const occ of occurrences) {
                if (occ.anchor.isConnected) present.add(occ.doi);
            }
            return present;
        })();
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
                void checkPubPeer(resolvedRefsPromise, myGen);
            }
        } else {
            if (isSheets) {
                removeSheetsModal();
            } else {
                void checkPubPeer(resolvedRefsPromise, myGen);
            }
        }

        // Inline badges (skip on Google Sheets — modal only)
        if (!isSheets) {
            renderInlineBadges(pageState, pageOccurrences);
        }
    } catch {
        rollBackStuckDois(newDois);
        renderErrorBanner("Failed to contact FLoRA service");
    } finally {
        endWorkIndicator();
    }
}

/**
 * Roll DOIs whose lookup came back empty out of `processedDois` so a later pass
 * retries them — but only up to MAX_DOI_RETRIES times per page, so a permanently
 * unreachable service worker can't drive an unbounded retry storm. Past the cap
 * the DOI is left as-is (quietly "loading", no badge) and never retried again on
 * this page.
 */
function rollBackStuckDois(dois: DoiString[]): void {
    for (const doi of dois) {
        if (registerStuckRetry(doi, doiRetryCount, MAX_DOI_RETRIES)) {
            processedDois.delete(doi);
            pageState.delete(doi);
        } else {
            debugLog(`General: giving up on ${doi} after ${MAX_DOI_RETRIES} stuck-lookup retries`);
        }
    }
}

/**
 * Restore notice (retraction / concern) pills whose target was detached by a
 * hydration re-render. Runs on same-URL passes where the DOI set is unchanged
 * (the main injection path is skipped there). Only DOIs whose pill is actually
 * missing from the live DOM are re-injected, each dropped from the once-per-DOI
 * latch first so the restore is allowed — this restores, never multiplies: a DOI
 * that still has a connected pill is left untouched. `redacts` (module state)
 * holds the notice data from the pass that first placed the pills.
 */
function reinjectMissingNoticePills(pageOccurrences: DoiOccurrence[]): void {
    if (redacts.length === 0) return;

    const articleDois = new Set(
        [...doiContext.entries()].filter(([, ctx]) => ctx === "article").map(([doi]) => doi)
    );
    const titleEl = chooseArticleTitleElement(document);

    for (const notice of redacts) {
        if (hasConnectedNoticePill(notice.originDoi)) continue; // pill intact — leave it
        // Allow a fresh placement for this DOI (it lost its pill).
        resetRetractionPillDoi(notice.originDoi);

        // Article notice → title pin, mirroring the main injection path.
        if (titleEl && articleDois.has(notice.originDoi)) {
            titleEl.removeAttribute(FLORA_RET_CHECK_KEY);
            injectRetractionInfo(titleEl, notice, { append: true });
            continue;
        }
        // Otherwise re-place at the DOI's first live occurrence.
        for (const occ of pageOccurrences) {
            if (occ.doi !== notice.originDoi) continue;
            if (titleEl && articleDois.has(occ.doi)) continue;
            injectRetractionInfo(occ.anchor, notice);
            if (hasConnectedNoticePill(notice.originDoi)) break;
        }
    }
}

// Gate augmentFromTitle to real article pages — avoids polluting the cache.
function isScholarlyArticlePage(): boolean {
    return document.querySelector(
        'meta[name="citation_title"],'
        + 'meta[name="citation_doi"],'
        + 'meta[name="citation_author"],'
        + 'meta[name="citation_journal_title"],'
        + 'meta[name="citation_publisher"],'
        + 'meta[name="prism.doi"],'
        + 'meta[name="prism.publicationName"],'
        + 'meta[name="dc.identifier" i],'
        + 'meta[name="dc.title" i],'
        + 'meta[name="DC.Identifier" i]'
    ) !== null;
}

/**
 * Silently try to resolve a DOI from the page title via Crossref/OpenAlex.
 * Runs in the background with no UI.
 */
async function augmentFromTitle(myGen: number): Promise<void> {
    if (augmentAttempted) return;
    augmentAttempted = true;

    if (!isScholarlyArticlePage()) {
        debugLog("Title augmentation: skipped — page is not a scholarly article");
        return;
    }

    const titleEl = document.querySelector<HTMLHeadingElement>("h1");
    const pageTitle = titleEl?.textContent?.trim() || document.title?.trim();

    if (!pageTitle) return;

    try {
        const augmented = await augmentDOIsViaWorker([{
            title: pageTitle,
            sourceUrl: location.href,
            ...extractPageAugmentationMetadata(document),
        }]);
        if (scheduler.isStale(myGen)) return; // superseded by a newer navigation
        const resolvedDoi = augmented.get(pageTitle);
        debugLog("Title augmentation:", resolvedDoi ? `resolved to ${resolvedDoi}` : "no match", `(title: "${pageTitle}")`);
        if (resolvedDoi) {
            everYieldedDoi = true; // page produced a DOI — disable the relevance pre-gate
            processedDois.add(resolvedDoi);
            const request: LookupRequest = {
                type: "FLORA_LOOKUP",
                dois: [resolvedDoi]
            };
            await safeSendMessage(request);
            if (scheduler.isStale(myGen)) return;

            // Augmented DOI isn't in `dois` — check + pill it beside the title here.
            if (titleEl) {
                try {
                    const notices = await retractionCheck([resolvedDoi]);
                    if (notices.length > 0) {
                        injectRetractionInfo(titleEl, notices[0], { afterend: true });
                    }
                } catch { /* supplementary */ }
            }
        }
    } catch {
        // Augmentation failed silently
    }
}

function metaContent(doc: Document, selectors: string[]): string | null {
    for (const selector of selectors) {
        const value = doc.querySelector<HTMLMetaElement>(selector)?.content?.trim();
        if (value) return value;
    }
    return null;
}

function parseYear(value: string | null): number | null {
    const match = value?.match(/\b((?:19|20)\d{2})\b/);
    return match ? Number(match[1]) : null;
}

function readJsonLdObjects(doc: Document): unknown[] {
    const values: unknown[] = [];
    for (const script of doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
        try {
            const parsed = JSON.parse(script.textContent ?? "");
            if (Array.isArray(parsed)) values.push(...parsed);
            else values.push(parsed);
        } catch {
            // Invalid publisher JSON-LD should not block title augmentation.
        }
    }
    return values;
}

function firstJsonLdAuthorName(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const author = (value as {author?: unknown}).author;
    const firstAuthor = Array.isArray(author) ? author[0] : author;
    if (typeof firstAuthor === "string") return firstAuthor;
    if (firstAuthor && typeof firstAuthor === "object") {
        const {familyName, name} = firstAuthor as {familyName?: unknown; name?: unknown};
        if (typeof familyName === "string") return familyName;
        if (typeof name === "string") return name;
    }
    return null;
}

function jsonLdDate(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;
    const item = value as {datePublished?: unknown; dateCreated?: unknown; dateModified?: unknown};
    for (const date of [item.datePublished, item.dateCreated, item.dateModified]) {
        if (typeof date === "string") return date;
    }
    return null;
}

/**
 * Pull the article's first author and publication year from page metadata
 * (citation_/dc. meta tags, then JSON-LD) so augmentDOIs can disambiguate
 * between similarly-titled works.
 */
function extractPageAugmentationMetadata(doc: Document): Omit<DoiAugmentRequest, "title"> {
    const firstAuthor =
        metaContent(doc, [
            'meta[name="citation_author"]',
            'meta[name="dc.creator"]',
            'meta[name="DC.creator"]',
            'meta[name="author"]',
        ]) ??
        readJsonLdObjects(doc).map(firstJsonLdAuthorName).find((author): author is string => !!author) ??
        null;

    const date =
        metaContent(doc, [
            'meta[name="citation_publication_date"]',
            'meta[name="citation_online_date"]',
            'meta[name="dc.date"]',
            'meta[name="DC.date"]',
            'meta[property="article:published_time"]',
        ]) ??
        readJsonLdObjects(doc).map(jsonLdDate).find((value): value is string => !!value) ??
        null;

    return {
        firstAuthor,
        year: parseYear(date),
    };
}

async function checkPubPeer(
    passResolvedRefs: Promise<ResolvedReference[]> | null,
    myGen: number,
): Promise<void> {
    if (isSheets) return;
    const primaryDoi = extractPrimaryDOI(document);
    if (!primaryDoi) return;
    try {
        const resolvedRefs = passResolvedRefs ? await passResolvedRefs : [];
        if (scheduler.isStale(myGen)) return; // superseded by a newer navigation

        // Union resolved refs with on-page reference DOIs for full PubPeer coverage.
        const seen = new Set<DoiString>();
        const referenceDois: DoiString[] = [];
        for (const r of resolvedRefs) {
            if (seen.has(r.doi)) continue;
            seen.add(r.doi);
            referenceDois.push(r.doi);
        }
        for (const [doi, ctx] of doiContext) {
            if (ctx !== "reference") continue;
            if (seen.has(doi)) continue;
            seen.add(doi);
            referenceDois.push(doi);
        }

        // Skip re-run when article is fetched, ref DOI set is unchanged, and no new FORRT data.
        const refKey = [...referenceDois].sort().join("|");
        if (articleFeedbacksFetched && refKey === lastReferenceDoiKey && lastRenderedPageStateVersion === pageStateVersion) return;

        // Article: URL lookup once/page. References: one batched, cached lookup.
        const articlePromise = articleFeedbacksFetched
            ? Promise.resolve(lastArticleFeedbacks)
            : lookupPubPeer([primaryDoi], [location.href]);
        const [articleFeedbacks, refFeedbackByDoi] = await Promise.all([
            articlePromise,
            lookupPubPeerForDois(referenceDois),
        ]);
        if (scheduler.isStale(myGen)) return; // superseded by a newer navigation
        articleFeedbacksFetched = true;
        lastArticleFeedbacks = articleFeedbacks;
        lastRefFeedbackByDoi = refFeedbackByDoi;
        lastReferenceDoiKey = refKey;

        // Panel lists only refs with PubPeer comments, a notice, or FORRT data.
        const noticeDois = new Set(redacts.map((r) => r.originDoi));
        const hasReplication = (doi: DoiString): boolean => {
            const s = pageState.get(doi);
            if (s?.status !== "matched") return false;
            const {n_replications_total, n_reproductions_total, n_originals_total} =
                s.result.record.stats;
            return n_replications_total > 0 || n_reproductions_total > 0 || n_originals_total > 0;
        };
        const flagged = referenceDois.filter((doi) => {
            const fb = refFeedbackByDoi.get(doi);
            return (fb !== undefined && fb.total_comments > 0)
                || noticeDois.has(doi)
                || hasReplication(doi);
        });
        const panelRefs = await Promise.all(flagged.map(async (doi) => {
            const title = refFeedbackByDoi.get(doi)?.title
                ?? (await fetchTitleByDoi(doi))
                ?? doi;
            return {doi, title};
        }));
        if (scheduler.isStale(myGen)) return; // superseded by a newer navigation

        lastRenderedPageStateVersion = pageStateVersion;
        renderSidePanel(articleFeedbacks, panelRefs, pageState, doiContext, refFeedbackByDoi, redacts);
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
        const response = await safeSendMessage<SheetFetchResponse>(request);
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

    // Always run — re-evaluates modal state even if the CSV fetch failed.
    pageRenderChangeHandler();
}

function isFloraOwnedNode(node: Node): boolean {
    if (node.nodeType !== Node.ELEMENT_NODE) return true; // text/comment nodes — not meaningful for DOI scanning
    const el = node as Element;
    if (el.id.startsWith("flora-")) return true;
    for (const c of el.classList) {
        if (c.startsWith("flora-")) return true;
    }
    return false;
}

function startDomListener(callback: (hint?: ScanHint) => void) {
    let debounceTimer: number;
    // Whether any external node added since the last fired callback could carry
    // a DOI. Accumulated across debounced mutation batches, reset when fired.
    let pendingCouldBeRelevant = false;
    const observer = new MutationObserver((mutations) => {
        // Do no work while this tab is in the background.
        if (document.hidden) return;
        let hasExternalChange = false;
        for (const m of mutations) {
            if (m.addedNodes.length === 0) continue;
            // Skip mutations inside FLoRA's own injected containers.
            if ((m.target as Element).closest?.('[id^="flora-"]')) continue;
            for (const node of m.addedNodes) {
                // Skip FLoRA-owned elements (badges, pills, panel, etc.).
                if (isFloraOwnedNode(node)) continue;
                hasExternalChange = true;
                if (!pendingCouldBeRelevant && couldNodeIntroduceDoi(node)) {
                    pendingCouldBeRelevant = true;
                }
            }
        }
        if (hasExternalChange) {
            clearTimeout(debounceTimer);
            debounceTimer = window.setTimeout(() => {
                const couldBeRelevant = pendingCouldBeRelevant;
                pendingCouldBeRelevant = false;
                callback({ couldBeRelevant });
            }, 300);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Re-scan when the tab becomes active again — mutations that happened while
    // it was hidden were ignored above. No hint → full scan (can't localise what
    // changed while hidden).
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) callback();
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

            const hideTaggedComments = (root: Node = document.body): void => {
                const el = root instanceof Element ? root : root.parentElement;
                if (!el) return;
                for (const strong of el.querySelectorAll<HTMLElement>("strong.inner-id[id]")) {
                    if (!HIDDEN_PUBPEER_COMMENTER_IDS.has(strong.id)) continue;
                    // .vertical-timeline-content is the full comment block (header + body + footer).
                    const commentBlock = strong.closest(".vertical-timeline-content");
                    if (commentBlock) (commentBlock as HTMLElement).style.display = "none";
                }
            };

            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    for (const n of m.addedNodes) {
                        stripCommentAccepted(n);
                        hideTaggedComments(n);
                    }
                }
            });
            const startStripping = (): void => {
                stripCommentAccepted();
                hideTaggedComments();
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
        reportActiveState(false); // gray toolbar icon — disabled on this domain
        return;
    }
    // Applicable page — mark the toolbar icon active for this tab.
    reportActiveState(true);
    // Show setup prompt if email not configured (non-blocking — extension still runs)
    if (!(await isSetupComplete())) {
        renderSetupPrompt().then().catch();
    }
    const startFlora = (): void => {
        if (isSheets) {
            // Fetch full sheet data via CSV export to get all DOIs regardless of scroll
            fetchSheetDois();
            // Poll for sheet tab switches — Sheets uses replaceState (no popstate).
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
            // Initial run — static pages may never trigger the MutationObserver.
            void pageRenderChangeHandler();
            // Defer the observer until full load so load-time mutations don't spam it.
            if (document.readyState === "complete") {
                startDomListener(pageRenderChangeHandler);
            } else {
                window.addEventListener("load", () => startDomListener(pageRenderChangeHandler), { once: true });
            }
        }
    };

    // Only run on the active/visible tab. Content scripts auto-inject into every
    // matching tab (including background ones); defer all work until this tab is
    // shown so background tabs don't scan, look up, or render.
    if (document.visibilityState === "visible") {
        startFlora();
    } else {
        document.addEventListener("visibilitychange", function onVisible() {
            if (document.visibilityState === "visible") {
                document.removeEventListener("visibilitychange", onVisible);
                startFlora();
            }
        });
    }
})();
