import {normaliseDOI} from "@shared/doi-normalise";
import {augmentDOIs} from "@shared/doi-augment";
import {injectRetractionInfo, retractionCheck} from "@shared/doi-retraction"
import {validateDOI, validateDOIs} from "@shared/doi-validate";
import type {DoiString, DoiSource} from "@shared/types";
import type {LookupRequest, LookupResponse} from "@shared/messages";
import {renderScholarBadge} from "./badge";
import {debugLog} from "@shared/debug";

const RESULT_CONTAINER = "#gs_res_ccl";
const RESULT_ROW = ".gs_r.gs_or.gs_scl";
const PROCESSED_ATTR = "data-flora-processed";

export function observeScholarResults(): void {
    const container = document.querySelector(RESULT_CONTAINER);
    if (!container) return;

    const observer = new MutationObserver((mutations) => {
        let hasNewRows = false;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (
                    node instanceof HTMLElement &&
                    (node.matches(RESULT_ROW) || node.querySelector(RESULT_ROW))
                ) {
                    hasNewRows = true;
                    break;
                }
            }
            if (hasNewRows) break;
        }

        if (hasNewRows) {
            processScholarResults(document);
        }
    });

    observer.observe(container, {childList: true, subtree: true});
}

export async function processScholarResults(doc: Document): Promise<void> {
    const rows = doc.querySelectorAll<HTMLElement>(
        `${RESULT_ROW}:not([${PROCESSED_ATTR}])`
    );
    debugLog(`Scholar: ${rows.length} new result row(s) to process`);
    if (rows.length === 0) return;

    const rowDois: {
        row: HTMLElement;
        doi: DoiString;
        source: DoiSource
    }[] = [];

    // Phase 1: Extract DOIs from URLs and collect all titles for augmentation
    interface RowInfo {
        row: HTMLElement;
        title: string;
        extractedDoi: DoiString | null;
        confident: boolean;
    }

    const rowInfos: RowInfo[] = [];

    for (const row of rows) {
        row.setAttribute(PROCESSED_ATTR, "true");

        // Skip non-article entries like [CITATION] and [BOOK]
        const typeTag = row.querySelector(".gs_rt .gs_ctu, .gs_rt .gs_ctg2, .gs_rt .gs_ct1");
        const typeText = typeTag?.textContent?.trim().toLowerCase() ?? "";
        if (typeText.includes("citation") || typeText.includes("book")) {
            continue;
        }

        const extraction = extractDoiFromScholarRow(row);
        const title = row.querySelector(".gs_rt")?.textContent?.trim() ?? "";

        // Confident extractions (doi.org URLs, explicit text) → green immediately
        if (extraction?.confident) {
            debugLog(`Scholar resolve [confident] "${title}" → ${extraction.doi}`);
            rowDois.push({row, doi: extraction.doi, source: "extracted"});
            preInjectLabels(row, extraction.doi, "#853953", false);
        } else {
            // Non-confident or no extraction — collect for augmentation cross-check
            rowInfos.push({
                row,
                title,
                extractedDoi: extraction?.doi ?? null,
                confident: false,
            });
        }
    }

    // Phase 2: Validate extracted DOIs via doi.org, then augment only what's still unresolved
    if (rowInfos.length > 0) {
        // Step 1: Validate extracted DOIs with doi.org (cheap HEAD-like check)
        const doisToValidate = rowInfos
            .filter((r) => r.extractedDoi !== null)
            .map((r) => r.extractedDoi!);

        let validated = new Map<DoiString, boolean>();
        if (doisToValidate.length > 0) {
            try {
                validated = await validateDOIs(doisToValidate);
            } catch {
                // Validation failed — all remain unvalidated
            }
        }

        // Separate rows into validated (done) vs still-pending (need augmentation)
        const pendingInfos: RowInfo[] = [];
        for (const info of rowInfos) {
            if (info.extractedDoi && validated.get(info.extractedDoi)) {
                // doi.org confirms this DOI exists → treat as confident
                debugLog(`Scholar resolve [doi.org-validated] "${info.title}" → ${info.extractedDoi}`);
                rowDois.push({
                    row: info.row,
                    doi: info.extractedDoi,
                    source: "extracted"
                });
                preInjectLabels(info.row, info.extractedDoi, "#853953", false);
            } else {
                if (info.extractedDoi) {
                    debugLog(`Scholar: "${info.title}" — extracted ${info.extractedDoi} failed doi.org validation, falling back to augmentation`);
                }
                pendingInfos.push(info);
            }
        }

        // Step 2: Augment only the remaining unresolved rows
        if (pendingInfos.length > 0) {
            const titlesToAugment = pendingInfos.filter((r) => r.title).map((r) => r.title);
            let augmented = new Map<string, DoiString | null>();
            try {
                if (titlesToAugment.length > 0) {
                    augmented = await augmentDOIs(titlesToAugment);
                }
            } catch {
                // Augmentation failed — fall through with empty map
            }

            for (const info of pendingInfos) {
                const augmentedDoi = augmented.get(info.title) ?? null;

                if (info.extractedDoi && augmentedDoi === info.extractedDoi) {
                    // Cross-validated: URL extraction matches augmentation → green ✓
                    debugLog(`Scholar resolve [cross-validated] "${info.title}" → ${info.extractedDoi} (extracted = augmented)`);
                    rowDois.push({
                        row: info.row,
                        doi: info.extractedDoi,
                        source: "extracted"
                    });
                    preInjectLabels(info.row, info.extractedDoi, "#853953", false);
                } else if (info.extractedDoi && augmentedDoi && augmentedDoi !== info.extractedDoi) {
                    // Conflict: prefer augmented DOI → gray (augmented)
                    debugLog(`Scholar resolve [conflict] "${info.title}" → using augmented ${augmentedDoi} (extracted was ${info.extractedDoi})`);
                    rowDois.push({
                        row: info.row,
                        doi: augmentedDoi,
                        source: "augmented"
                    });
                    preInjectLabels(info.row, augmentedDoi, "#656d76", true);
                } else if (info.extractedDoi && !augmentedDoi) {
                    // Extracted but augmentation found nothing — last-resort doi.org check
                    let valid = false;
                    try {
                        valid = await validateDOI(info.extractedDoi);
                    } catch { /* validation failed */
                    }

                    if (valid) {
                        debugLog(`Scholar resolve [extracted-revalidated] "${info.title}" → ${info.extractedDoi} (doi.org confirmed on retry)`);
                        rowDois.push({
                            row: info.row,
                            doi: info.extractedDoi,
                            source: "extracted"
                        });
                        preInjectLabels(info.row, info.extractedDoi, "#853953", false);
                    } else {
                        // Invalid DOI — show nothing rather than an incorrect DOI
                        debugLog(`Scholar resolve [extracted-invalid] "${info.title}" → ${info.extractedDoi} rejected (doi.org says invalid)`);
                    }
                } else if (!info.extractedDoi && augmentedDoi) {
                    // No extraction, only augmented → gray with dotted underline
                    debugLog(`Scholar resolve [augmented-only] "${info.title}" → ${augmentedDoi} (no extraction)`);
                    rowDois.push({
                        row: info.row,
                        doi: augmentedDoi,
                        source: "augmented"
                    });
                    preInjectLabels(info.row, augmentedDoi, "#656d76", true);
                } else {
                    debugLog(`Scholar resolve [no-doi] "${info.title}" → no DOI from extraction or augmentation`);
                }
            }
        }
    }

    const extracted = rowDois.filter((r) => r.source === "extracted").length;
    const augmentedCount = rowDois.filter((r) => r.source === "augmented").length;
    debugLog(`${extracted} DOIs from Scholar, ${augmentedCount} augmented via Crossref/OpenAlex`);

    if (rowDois.length === 0) return;

    const uniqueDois = [...new Set(rowDois.map((rd) => rd.doi))];
    debugLog("Scholar: Sending lookup for", uniqueDois.length, "unique DOIs:", uniqueDois);
    const request: LookupRequest = {type: "FLORA_LOOKUP", dois: uniqueDois};

    try {
        const response: LookupResponse =
            await chrome.runtime.sendMessage(request);
        debugLog("Scholar: Lookup response:", Object.keys(response.results).length, "results,", Object.keys(response.errors).length, "errors");

        let badgedCount = 0;
        for (const {row, doi, source} of rowDois) {
            if (response.results[doi]) {
                renderScholarBadge(row, {
                    status: "matched",
                    result: response.results[doi],
                    source,
                });
                badgedCount++;
            }
        }
        debugLog("Scholar: Rendered", badgedCount, "badge(s)");
    } catch (err) {
        debugLog("Scholar: Lookup failed:", err);
    }
}

const DOI_LABEL_CLASS = "flora-doi-label";

async function preInjectLabels(row: HTMLElement, doi: DoiString, color: string, isAugmented = false): Promise<void> {
    injectDoiLabel(row, doi, color, isAugmented);
    let target = row.querySelector(".gs_ggs");
    if (!target) {
        target = document.createElement("div");
        target.className = "gs_ggs gs_fl";
        const gsRi = row.querySelector(".gs_ri");
        row.insertBefore(target, gsRi);
    }
    let result = await retractionCheck([doi]);
    if (result && result[0] != undefined) injectRetractionInfo(target, result[0])
}

function injectDoiLabel(row: HTMLElement, doi: string, color: string, isAugmented = false): void {
    // Prefer the right-side PDF area; if absent, create one to match Scholar's layout
    let target = row.querySelector(".gs_ggs");
    if (!target) {
        target = document.createElement("div");
        target.className = "gs_ggs gs_fl";
        const gsRi = row.querySelector(".gs_ri");
        row.insertBefore(target, gsRi);
    }

    const wrapper = document.createElement("div");
    wrapper.className = DOI_LABEL_CLASS;

    wrapper.style.cssText = `position: relative; display: inline-block; margin-top: 4px;`;

    const pill = document.createElement("span");
    pill.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: white;
    background: ${color};
    opacity: 0.75;
    padding: 2px 10px;
    border-radius: 20px;
    cursor: pointer;
    user-select: none;
    line-height: 18px;
    letter-spacing: 0.02em;
    box-shadow: 0 0 0 0 rgba(0,0,0,0);
    transition: opacity 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  `;
    pill.addEventListener("mouseenter", () => {
        pill.style.opacity = "1";
        pill.style.boxShadow = "0 1px 2px rgba(27,31,36,0.12), 0 2px 6px rgba(66,74,83,0.14)";
        pill.style.transform = "translateY(-1px)";
    });
    pill.addEventListener("mouseleave", () => {
        pill.style.opacity = "0.75";
        pill.style.boxShadow = "0 0 0 0 rgba(0,0,0,0)";
        pill.style.transform = "translateY(0)";
    });
    if (isAugmented) {
        const doiWord = document.createElement("span");
        doiWord.textContent = "DOI";
        doiWord.style.cssText = `text-decoration: underline dotted; text-underline-offset: 2px; text-decoration-thickness: 1px;`;
        pill.appendChild(doiWord);
    } else {
        const checkSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="white" style="display:inline-block;vertical-align:middle;"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;
        pill.innerHTML = `DOI ${checkSvg}`;
    }

    const popover = document.createElement("div");
    popover.style.cssText = `
    display: none;
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    background: #ffffff;
    border: 1px solid ${color}40;
    border-radius: 999px;
    box-shadow: 0 1px 2px rgba(27,31,36,0.08), 0 4px 16px rgba(66,74,83,0.10);
    padding: 3px 12px;
    z-index: 10000;
    white-space: nowrap;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 12px;
    line-height: 18px;
    flex-direction: column;
    gap: 6px;
  `;

    const contentRow = document.createElement("div");
    contentRow.style.cssText = `display: flex; align-items: center; gap: 6px;`;

    const doiText = document.createElement("span");
    doiText.textContent = doi;
    doiText.style.cssText = `
    color: #1f2328;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 11.5px;
    letter-spacing: 0.01em;
  `;

    const divider = document.createElement("span");
    divider.style.cssText = `
    width: 1px;
    height: 14px;
    background: ${color}33;
    margin: 0 6px;
  `;

    const clipboardSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="display:block;"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>`;
    const checkSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="display:block;"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;

    const iconBtnStyle = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: content-box;
    width: 14px !important;
    height: 14px !important;
    min-width: 0 !important;
    max-width: 14px !important;
    padding: 0 !important;
    margin: 0;
    border: none !important;
    background: transparent !important;
    cursor: pointer;
    color: #656d76;
    transition: color 0.15s ease;
    line-height: 0;
    font-size: 0;
    text-decoration: none;
    flex: 0 0 auto;
  `;

    const copyBtn = document.createElement("button");
    copyBtn.innerHTML = clipboardSvg;
    copyBtn.title = "Copy DOI";
    copyBtn.style.cssText = iconBtnStyle;
    let copySuccess = false;
    copyBtn.addEventListener("mouseenter", () => {
        if (!copySuccess) copyBtn.style.color = color;
    });
    copyBtn.addEventListener("mouseleave", () => {
        if (!copySuccess) copyBtn.style.color = "#656d76";
    });
    copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        copySuccess = true;
        copyBtn.innerHTML = checkSvg;
        copyBtn.style.color = color;
        copyBtn.title = "Copied";
        const writePromise = navigator.clipboard?.writeText
            ? navigator.clipboard.writeText(doi)
            : Promise.reject();
        writePromise.catch(() => {
            // Fallback for contexts where the async clipboard API is blocked
            const ta = document.createElement("textarea");
            ta.value = doi;
            ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand("copy");
            } catch {
                /* nothing more we can do */
            }
            ta.remove();
        });
        setTimeout(() => {
            copySuccess = false;
            copyBtn.innerHTML = clipboardSvg;
            copyBtn.style.color = copyBtn.matches(":hover") ? color : "#656d76";
            copyBtn.title = "Copy DOI";
        }, 1500);
    });

    // External-link button — opens the DOI on doi.org in a new tab
    const externalLinkSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="display:block;"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"></path></svg>`;

    const openLink = document.createElement("a");
    openLink.innerHTML = externalLinkSvg;
    openLink.href = `https://doi.org/${doi}`;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    openLink.title = "Open on doi.org";
    openLink.style.cssText = iconBtnStyle;
    openLink.addEventListener("mouseenter", () => {
        openLink.style.color = color;
    });
    openLink.addEventListener("mouseleave", () => {
        openLink.style.color = "#656d76";
    });
    openLink.addEventListener("click", (e) => {
        e.stopPropagation();
    });

    const actions = document.createElement("div");
    actions.style.cssText = `display: inline-flex; align-items: center; gap: 12px;`;
    actions.appendChild(openLink);
    actions.appendChild(copyBtn);

    contentRow.appendChild(doiText);
    contentRow.appendChild(divider);
    contentRow.appendChild(actions);
    popover.appendChild(contentRow);

    let hideTimeout: ReturnType<typeof setTimeout> | null = null;

    const show = () => {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        // Reset position to measure natural size
        popover.style.top = "0";
        popover.style.bottom = "auto";
        popover.style.left = "0";
        popover.style.right = "auto";
        popover.style.display = "flex";

        const gap = 8;
        const pillRect = pill.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const spaceRight = vw - pillRect.right - gap;
        const spaceLeft = pillRect.left - gap;
        const spaceBelow = vh - pillRect.bottom - gap;
        const spaceAbove = pillRect.top - gap;

        // Prefer opening to the right, then left, then below, then above
        if (spaceRight >= popRect.width) {
            popover.style.left = `calc(100% + ${gap}px)`;
            popover.style.right = "auto";
            popover.style.top = "0";
            popover.style.bottom = "auto";
        } else if (spaceLeft >= popRect.width) {
            popover.style.left = "auto";
            popover.style.right = `calc(100% + ${gap}px)`;
            popover.style.top = "0";
            popover.style.bottom = "auto";
        } else if (spaceBelow >= popRect.height) {
            popover.style.top = `calc(100% + ${gap}px)`;
            popover.style.bottom = "auto";
            popover.style.left = "0";
            popover.style.right = "auto";
        } else if (spaceAbove >= popRect.height) {
            popover.style.top = "auto";
            popover.style.bottom = `calc(100% + ${gap}px)`;
            popover.style.left = "0";
            popover.style.right = "auto";
        } else {
            // Nothing fits perfectly — pick the direction with the most space
            const best = Math.max(spaceRight, spaceLeft, spaceBelow, spaceAbove);
            if (best === spaceRight || best === spaceLeft) {
                popover.style.top = "0";
                popover.style.bottom = "auto";
                if (best === spaceRight) {
                    popover.style.left = `calc(100% + ${gap}px)`;
                    popover.style.right = "auto";
                } else {
                    popover.style.left = "auto";
                    popover.style.right = `calc(100% + ${gap}px)`;
                }
            } else {
                popover.style.left = "0";
                popover.style.right = "auto";
                if (best === spaceBelow) {
                    popover.style.top = `calc(100% + ${gap}px)`;
                    popover.style.bottom = "auto";
                } else {
                    popover.style.top = "auto";
                    popover.style.bottom = `calc(100% + ${gap}px)`;
                }
            }
        }
    };
    const hide = () => {
        hideTimeout = setTimeout(() => {
            popover.style.display = "none";
        }, 200);
    };

    pill.addEventListener("mouseenter", show);
    pill.addEventListener("mouseleave", hide);
    popover.addEventListener("mouseenter", show);
    popover.addEventListener("mouseleave", hide);

    wrapper.appendChild(pill);
    wrapper.appendChild(popover);
    target.appendChild(wrapper);
}

interface ExtractionResult {
    doi: DoiString;
    /** true when the DOI comes from a doi.org URL (inherently trustworthy) */
    confident: boolean;
}

function extractDoiFromScholarRow(row: HTMLElement): ExtractionResult | null {
    const title = row.querySelector(".gs_rt")?.textContent?.trim() ?? "(untitled)";

    // 1. Title link href — doi.org URL is inherently trustworthy
    const titleLink = row.querySelector<HTMLAnchorElement>(".gs_rt a");
    if (titleLink?.href) {
        const doi = normaliseDOI(titleLink.href);
        if (doi) {
            debugLog(`Scholar DOI [title-link doi.org] "${title}" → ${doi} (confident) from ${titleLink.href}`);
            return {doi, confident: true};
        }
        // DOI explicitly named in query params (e.g. ?doi=10.xxx/yyy, ?identifierName=doi&identifierValue=10.xxx)
        const doiFromParams = extractDoiFromQueryParams(titleLink.href);
        if (doiFromParams) {
            debugLog(`Scholar DOI [title-link query-param] "${title}" → ${doiFromParams} (confident) from ${titleLink.href}`);
            return {doi: doiFromParams, confident: true};
        }
        // DOI may be embedded in path (e.g. /edit/10.xxx/yyy/slug)
        try {
            const decoded = decodeURIComponent(titleLink.href);
            const m = decoded.match(/\b(10\.\d{4,}(?:\.\d+)*\/[^\s&"'#?/]+)/);
            if (m) {
                const embeddedDoi = normaliseDOI(m[1]);
                if (embeddedDoi) {
                    debugLog(`Scholar DOI [title-link embedded-path] "${title}" → ${embeddedDoi} (not confident) from ${titleLink.href}`);
                    return {doi: embeddedDoi, confident: false};
                }
            }
        } catch { /* invalid encoding — skip */
        }
    }

    // 2. Author/source line text
    const authorLine = row.querySelector(".gs_a");
    if (authorLine?.textContent) {
        const match = authorLine.textContent.match(
            /\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/
        );
        if (match) {
            const doi = normaliseDOI(match[1]);
            if (doi) {
                debugLog(`Scholar DOI [author-line text] "${title}" → ${doi} (confident) from "${authorLine.textContent.trim()}"`);
                return {doi, confident: true};
            }
        }
    }

    // 3. Any link containing doi.org — inherently trustworthy
    const links = row.querySelectorAll<HTMLAnchorElement>("a[href]");
    for (const link of links) {
        if (link.href.includes("doi.org/")) {
            const doi = normaliseDOI(link.href);
            if (doi) {
                debugLog(`Scholar DOI [doi.org link] "${title}" → ${doi} (confident) from ${link.href}`);
                return {doi, confident: true};
            }
        }
    }

    // 4. DOI in query params of any link (explicitly labelled → confident)
    for (const link of links) {
        const paramDoi = extractDoiFromQueryParams(link.href);
        if (paramDoi) {
            debugLog(`Scholar DOI [link query-param] "${title}" → ${paramDoi} (confident) from ${link.href}`);
            return {doi: paramDoi, confident: true};
        }
    }

    // 5. DOI embedded in any link URL path (e.g. /edit/10.xxx/yyy/slug)
    const doiInUrlRe = /\b(10\.\d{4,}(?:\.\d+)*\/[^\s&"'#?/]+)/;
    for (const link of links) {
        try {
            const decoded = decodeURIComponent(link.href);
            const m = decoded.match(doiInUrlRe);
            if (m) {
                const doi = normaliseDOI(m[1]);
                if (doi) {
                    debugLog(`Scholar DOI [link embedded-path] "${title}" → ${doi} (not confident) from ${link.href}`);
                    return {doi, confident: false};
                }
            }
        } catch { /* invalid encoding */
        }
    }

    debugLog(`Scholar DOI [none] "${title}" → no DOI extracted`);
    return null;
}

/** Extract a DOI from URL query params where the param name explicitly indicates a DOI. */
function extractDoiFromQueryParams(href: string): DoiString | null {
    try {
        const url = new URL(href);
        const params = url.searchParams;

        // Direct param: ?doi=10.xxx/yyy
        for (const key of params.keys()) {
            if (key.toLowerCase() === "doi") {
                const doi = normaliseDOI(params.get(key) ?? "");
                if (doi) return doi;
            }
        }

        // Indirect pattern: ?identifierName=doi&identifierValue=10.xxx/yyy
        const idName = params.get("identifierName") ?? params.get("identifier_name") ?? "";
        if (idName.toLowerCase() === "doi") {
            const val = params.get("identifierValue") ?? params.get("identifier_value") ?? "";
            const doi = normaliseDOI(val);
            if (doi) return doi;
        }
    } catch { /* invalid URL */
    }
    return null;
}
