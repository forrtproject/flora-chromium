import {
    beginDomScanPass,
    classifyPageDois,
    extractDOIs,
    extractDOIsFromText,
    extractDoiOccurrences,
    extractPrimaryDOI
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
import {injectRetractionInfo, resetRetractionPills, retractionCheck, RetractionResponse} from "@shared/doi-retraction"
import {createIndicatorPill, updateIndicatorPillBadges, INDICATOR_PILL_CLASS} from "@shared/indicator-pill";
import {fetchOpenAccess} from "@shared/openaccess";
import {resolveReferenceDois, renderResolvedReferences, type ResolvedReference} from "./references";

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
// In-flight reference resolution, shared across one render pass.
let resolvedRefsPromise: Promise<ResolvedReference[]> | null = null;

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
        lastRenderedPageStateVersion = -1;
        resolvedRefsPromise = null;
        pageState.clear();
        augmentAttempted = false;
        resetRetractionPills();
        if (isSheets) {
            removeSheetsModal();
        } else {
            removeSidePanel();
        }
    }
    // Fresh DOM scan pass — resets the per-pass findReferenceContainers memo.
    beginDomScanPass();

    // Resolve reference-list DOIs in parallel with the FORRT lookup below.
    resolvedRefsPromise = resolveReferenceDois();

    // Non-Sheets: one classification scan (allDois). Sheets: canvas extractDOIs + CSV.
    let dois: DoiString[];
    let classified: ClassifiedDois | null = null;
    if (isSheets) {
        dois = extractDOIs(document);
        if (sheetCsvDois.length > 0) {
            dois = [...new Set([...dois, ...sheetCsvDois])];
        }
    } else {
        classified = classifyPageDois(document);
        dois = classified.allDois;
    }

    // DOI occurrences with source + anchor, so badges place without re-scanning.
    const occurrences = extractDoiOccurrences(document);

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
        const resolvedRefs = resolvedRefsPromise ? await resolvedRefsPromise : [];
        const allNoticeDois = Array.from(new Set([
            ...dois,
            ...resolvedRefs.map((r) => r.doi),
        ]));
        redacts = await retractionCheck(allNoticeDois);

        const retractionByDoi = new Map(redacts.map((r) => [r.originDoi, r] as const));
        const articleDois = new Set(
            [...doiContext.entries()].filter(([, ctx]) => ctx === "article").map(([doi]) => doi)
        );
        const titleEl = document.querySelector<HTMLHeadingElement>("h1");

        // Inline pills for remaining (reference/other) occurrences. Article DOIs
        // get the merged indicator pill at the title instead (placeTitleIndicatorPill).
        for (const occ of pageOccurrences) {
            const notice = retractionByDoi.get(occ.doi);
            if (!notice) continue;
            if (titleEl && articleDois.has(occ.doi)) continue;
            injectRetractionInfo(occ.anchor, notice);
        }

        // Pills for augmented refs with no on-page anchor (idempotent).
        renderResolvedReferences(resolvedRefs, retractionByDoi, pageState);
    }

    // Filter out already-processed DOIs
    const newDois = dois.filter((doi) => !processedDois.has(doi));

    // If no valid DOIs found, try augmenting from page title in the background
    if (newDois.length === 0 && dois.length === 0) {
        debugLog("No valid DOIs found on page, attempting title augmentation");
        if (!isSheets) placeTitleIndicatorPill();
        if (!isSheets) updateIndicatorPillBadges(document, pageState, redacts);
        if (!isSheets) augmentFromTitle().then().catch();
        if (!isSheets) void checkPubPeer();
        return;
    }

    if (newDois.length === 0) {
        debugLog("No new DOIs (all already processed)");
        // Merged pills first so renderInlineBadges can see them in the DOM and
        // skip standalone badges for DOIs they already cover.
        if (!isSheets) placeTitleIndicatorPill();
        if (!isSheets) updateIndicatorPillBadges(document, pageState, redacts);
        // Re-place inline badges against the live DOM — hydrating SPAs (e.g.
        // Sage) re-render and wipe a previously placed badge, and this pass
        // (triggered by that mutation) would otherwise return without restoring it.
        if (!isSheets) renderInlineBadges(pageState, pageOccurrences);
        if (!isSheets) void checkPubPeer();
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
        if (!response) {
            // Extension context invalidated (reload/update) — stale script, stop quietly.
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
            }
        }

        // Inline badges (skip on Google Sheets — modal only). Merged pills first
        // so renderInlineBadges can see them in the DOM and skip standalone
        // badges for DOIs they already cover.
        if (!isSheets) {
            placeTitleIndicatorPill();
            updateIndicatorPillBadges(document, pageState, redacts);
            renderInlineBadges(pageState, pageOccurrences);
        }
    } catch {
        renderErrorBanner("Failed to contact FLoRA service");
    } finally {
        endWorkIndicator();
    }
}

/**
 * Place the merged FLoRA indicator pill (DOI + Open Access + PubPeer +
 * retraction/replication badge) beside the article title, keyed off the
 * primary DOI rather than the on-page occurrence scan so it still surfaces
 * when the primary DOI is only found via URL/meta tags. Idempotent — checks
 * the live DOM rather than a separate processed flag, so it self-heals if a
 * hydrating SPA wipes the title's children.
 */
function placeTitleIndicatorPill(): void {
    const titleEl = document.querySelector<HTMLHeadingElement>("h1");
    if (!titleEl || titleEl.querySelector(`.${INDICATOR_PILL_CLASS}`)) return;
    const primaryDoi = extractPrimaryDOI(document);
    if (!primaryDoi) return;

    const retraction = redacts.find((r) => r.originDoi === primaryDoi) ?? null;
    const state = pageState.get(primaryDoi);
    const stats = state?.status === "matched" ? state.result.record.stats : null;

    titleEl.appendChild(createIndicatorPill({
        doi: primaryDoi,
        oaStatus: fetchOpenAccess(primaryDoi),
        retraction,
        replicationsCount: stats?.n_replications_total ?? null,
        reproductionsCount: stats?.n_reproductions_total ?? null,
    }));
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
async function augmentFromTitle(): Promise<void> {
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
        const resolvedDoi = augmented.get(pageTitle);
        debugLog("Title augmentation:", resolvedDoi ? `resolved to ${resolvedDoi}` : "no match", `(title: "${pageTitle}")`);
        if (resolvedDoi) {
            processedDois.add(resolvedDoi);
            const request: LookupRequest = {
                type: "FLORA_LOOKUP",
                dois: [resolvedDoi]
            };
            await safeSendMessage(request);

            // Augmented DOI isn't in `dois` — extractPrimaryDOI won't find it either
            // (it was never on the page), so placeTitleIndicatorPill() never fires
            // for this path. Pill it beside the title here instead.
            if (titleEl && !titleEl.querySelector(`.${INDICATOR_PILL_CLASS}`)) {
                try {
                    const notices = await retractionCheck([resolvedDoi]);
                    titleEl.insertAdjacentElement("afterend", createIndicatorPill({
                        doi: resolvedDoi,
                        oaStatus: fetchOpenAccess(resolvedDoi),
                        retraction: notices[0] ?? null,
                    }));
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

async function checkPubPeer(): Promise<void> {
    if (isSheets) return;
    const primaryDoi = extractPrimaryDOI(document);
    if (!primaryDoi) return;
    try {
        const resolvedRefs = resolvedRefsPromise ? await resolvedRefsPromise : [];

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

function startDomListener(callback: () => void) {
    let debounceTimer: number;
    const observer = new MutationObserver((mutations) => {
        // Do no work while this tab is in the background.
        if (document.hidden) return;
        const hasExternalChange = mutations.some(m => {
            if (m.addedNodes.length === 0) return false;
            // Skip mutations inside FLoRA's own injected containers.
            if ((m.target as Element).closest?.('[id^="flora-"]')) return false;
            // Skip if every added node is a FLoRA-owned element (badges, pills, panel, etc.).
            for (const node of m.addedNodes) {
                if (!isFloraOwnedNode(node)) return true;
            }
            return false;
        });
        if (hasExternalChange) {
            clearTimeout(debounceTimer);
            debounceTimer = window.setTimeout(callback, 300);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Re-scan when the tab becomes active again — mutations that happened while
    // it was hidden were ignored above.
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
