// Reference-list DOI resolution for article pages.
//
// Surfaces an inline DOI pill on reference-list entries so the reader gets a
// consistent click-to-open/copy action on each citation. The pill colour
// signals provenance: pink = DOI found directly on the page (in text or a
// link href), gray dotted = DOI resolved via Crossref/OpenAlex augmentation
// for entries that exposed no DOI of their own.
//
// Entries with no DOI (augmented) and entries whose DOI is hidden in a link
// href (not rendered as text) always get a pill. Entries that already show
// their DOI as visible text only get one when the user opts into
// `showDoiPillsOnAllReferences`.

import {findReferenceEntries, extractDoiFromHref, isEditableContext, type ReferenceEntry} from "@shared/doi-extractor";
import {augmentDOIsViaWorker} from "@shared/messages";
import {validateDOIs} from "@shared/doi-validate";
import {injectRetractionInfo, type RetractionResponse} from "@shared/doi-retraction";
import {createDoiPill} from "@shared/doi-label";
import {fetchOpenAccess} from "@shared/openaccess";
import {getSettings} from "@shared/settings";
import {debugLog} from "@shared/debug";
import type {DoiString} from "@shared/types";

/**
 * Place a DOI pill inline. For a "hidden" DOI (tucked into a link href) the
 * pill goes right after that link so it reads as part of the citation.
 *
 * An augmented DOI has no element on the page to anchor to. Appending it to
 * the entry root drops it onto its own line below the publisher action row
 * ("View PDF | View article | … | Google Scholar"); instead we insert it
 * right after the entry's last link so it sits inline with that row. Falls
 * back to the entry end only when the entry has no links at all.
 */
// textContent throughout (never innerText): these run per reference entry on
// every mutation pass, and innerText forces a layout reflow for every
// descendant of every entry. textContent yields the same relative lengths for
// selecting the container, without the reflow.
function findSmallestTextContainer(root: HTMLElement, needle: string): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestLen = Infinity;
    for (const el of root.querySelectorAll<HTMLElement>("*")) {
        const t = el.textContent ?? "";
        // Cheap bound: skip descendants that cannot host the needle.
        if (!t.includes(needle)) continue;
        if (t.length < bestLen) {
            best = el;
            bestLen = t.length;
        }
    }
    return best;
}

// Descendant with ≥50% but <100% of the entry's text — the citation body,
// excluding trailing action-link rows ("Article | Google Scholar").
function findCitationBody(entry: HTMLElement): HTMLElement | null {
    const entryText = (entry.textContent ?? "").trim();
    if (entryText.length < 40) return null;
    const floor = Math.floor(entryText.length * 0.5);
    let best: HTMLElement | null = null;
    let bestLen = 0;
    for (const el of entry.querySelectorAll<HTMLElement>("*")) {
        const raw = el.textContent ?? "";
        // Cheap bound: an element shorter than the floor (untrimmed length is an
        // upper bound after trimming) can never qualify — skip before trimming.
        if (raw.length < floor) continue;
        const t = raw.trim();
        if (t.length >= floor && t.length < entryText.length && t.length > bestLen) {
            best = el;
            bestLen = t.length;
        }
    }
    return best;
}

function placeReferencePill(
    entry: HTMLElement,
    doi: DoiString,
    mode: "augment" | "hidden",
    pill: HTMLElement
): void {
    // Defence in depth: reference augmentation can reach placement with an
    // entry inside an editable region (e.g. a citation pasted into a wiki or
    // CMS editor). Never inject there — the pill would be serialized into the
    // user's saved document.
    if (isEditableContext(entry)) {
        debugLog("placeReferencePill: skipped — entry is in an editable context");
        return;
    }
    if (mode === "hidden") {
        for (const link of entry.querySelectorAll<HTMLAnchorElement>("a[href]")) {
            if (extractDoiFromHref(link.href) === doi) {
                link.insertAdjacentElement("afterend", pill);
                return;
            }
        }
        const textHost = findSmallestTextContainer(entry, doi);
        if (textHost) {
            textHost.appendChild(pill);
            return;
        }
    } else {
        const body = findCitationBody(entry);
        if (body) {
            body.appendChild(pill);
            return;
        }
    }
    const links = entry.querySelectorAll<HTMLAnchorElement>("a[href]");
    const lastLink = links[links.length - 1];
    if (lastLink) {
        lastLink.insertAdjacentElement("afterend", pill);
    } else {
        entry.appendChild(pill);
    }
}

const PROCESSED_ATTR = "data-flora-ref-processed";
// Per-entry marker recording the DOI already pilled onto a reference entry, so
// renderResolvedReferences is idempotent even when two passes hand it the same
// resolved entry (e.g. overlapping mutation passes).
const REF_PILLED_ATTR = "data-flora-ref-pilled";
// Gray, dotted-underline "DOI" pill — for DOIs resolved via augmentation.
const AUGMENTED_COLOR = "#656d76";
// Pink "DOI ✓" pill — for DOIs that were found on the page but hidden in a
// button link; matches Scholar's confident colour.
const CONFIDENT_COLOR = "#853953";
// Cap API usage on reference lists with many DOI-less entries.
const MAX_REFERENCE_AUGMENTATIONS = 30;
// Skip entries too short to be a real citation (avoids junk augmentation queries).
const MIN_CITATION_LENGTH = 16;
// Real citations always have a publication year. Without one, the entry is
// almost certainly a navigation stub (pagination, source-tab label, "Show more")
// inside a reference container — sending those to Crossref/OpenAlex would
// hallucinate a DOI and surface a stray pill on the section header.
const YEAR_RE = /\b(?:18|19|20)\d{2}\b/;

type PendingEntry =
  | { entry: ReferenceEntry; mode: "augment"; doi: null }
  | { entry: ReferenceEntry; mode: "hidden"; doi: DoiString };

export interface ResolvedReference {
    entry: ReferenceEntry;
    doi: DoiString;
    mode: "augment" | "hidden";
}

/**
 * Find reference entries with no on-page DOI (and entries with hidden DOIs,
 * when the user has opted in), resolve a DOI for each via Crossref/OpenAlex
 * augmentation, and validate augmented results. Returns the resolved list
 * without writing anything to the DOM.
 *
 * Idempotent: each entry is marked processed inside this function, so repeated
 * calls (e.g. from the mutation observer) skip entries already handled.
 */
export async function resolveReferenceDois(): Promise<ResolvedReference[]> {
    const entries = findReferenceEntries(document);
    const {showDoiPillsOnAllReferences} = await getSettings();

    const pending: PendingEntry[] = [];
    for (const entry of entries) {
        if (entry.element.hasAttribute(PROCESSED_ATTR)) continue;
        if (entry.text.length < MIN_CITATION_LENGTH) continue;

        if (entry.doi === null) {
            if (!YEAR_RE.test(entry.text)) continue;
            pending.push({entry, mode: "augment", doi: null});
        } else if (!entry.doiInText) {
            // DOI is tucked into a link href and not rendered as text — always
            // surface a pill so the reference isn't silently skipped.
            pending.push({entry, mode: "hidden", doi: entry.doi});
        } else if (showDoiPillsOnAllReferences) {
            // DOI is visible in the citation text — only pill it when opted in.
            pending.push({entry, mode: "hidden", doi: entry.doi});
        }
    }
    if (pending.length === 0) return [];

    const augmentTargets = pending
        .filter((p): p is Extract<PendingEntry, {mode: "augment"}> => p.mode === "augment")
        .slice(0, MAX_REFERENCE_AUGMENTATIONS);
    const augmentSet = new Set(augmentTargets.map((p) => p.entry));
    const queued = pending.filter((p) => p.mode === "hidden" || augmentSet.has(p.entry));

    for (const p of queued) p.entry.element.setAttribute(PROCESSED_ATTR, "true");

    const hiddenCount = queued.length - augmentTargets.length;
    debugLog(`References: surfacing ${hiddenCount} hidden DOI(s), augmenting ${augmentTargets.length}`);

    let augmented = new Map<string, DoiString | null>();
    if (augmentTargets.length > 0) {
        try {
            augmented = await augmentDOIsViaWorker(augmentTargets.map((p) => p.entry.text));
        } catch {
            // continue with what we have — hidden DOIs still render
        }
    }

    const resolved: ResolvedReference[] = [];
    for (const p of queued) {
        if (p.mode === "hidden") {
            resolved.push({entry: p.entry, doi: p.doi, mode: "hidden"});
        } else {
            const doi = augmented.get(p.entry.text) ?? null;
            if (doi) resolved.push({entry: p.entry, doi, mode: "augment"});
        }
    }
    if (resolved.length === 0) {
        debugLog("References: nothing resolved");
        return [];
    }

    // Augmented DOIs are fuzzy title matches — validate them against doi.org.
    // Hidden DOIs were read off the page; trust them and skip validation so
    // doi.org doesn't rate-limit the whole batch.
    const augmentResolved = resolved.filter((r) => r.mode === "augment");
    let validated = new Map<DoiString, boolean>();
    if (augmentResolved.length > 0) {
        try {
            validated = await validateDOIs(augmentResolved.map((r) => r.doi));
        } catch {
            // validation unavailable — trust resolution
        }
    }
    const confirmed = resolved.filter(
        (r) => r.mode === "hidden" || validated.get(r.doi) !== false
    );
    if (confirmed.length === 0) {
        debugLog("References: resolved DOIs all failed doi.org validation");
        return [];
    }
    return confirmed;
}

/**
 * Render an inline DOI pill (and, when present in retractionByDoi, a notice
 * pill) on each resolved reference. Idempotent at the pill level — repeated
 * calls on the same entry skip via existing per-element markers.
 */
export function renderResolvedReferences(
    resolved: ResolvedReference[],
    retractionByDoi: Map<DoiString, RetractionResponse>,
): void {
    for (const {entry, doi, mode} of resolved) {
        // Idempotence at the pill level: skip an entry that already carries a
        // pill for this DOI. Without this, two overlapping passes handed the
        // same resolved list would each call placeReferencePill and stack a
        // duplicate DOI pill on the citation.
        if (entry.element.getAttribute(REF_PILLED_ATTR) === doi) continue;
        entry.element.setAttribute(REF_PILLED_ATTR, doi);

        const isAugmented = mode === "augment";
        const color = isAugmented ? AUGMENTED_COLOR : CONFIDENT_COLOR;
        // Pass the Open Access lookup so the padlock renders inside the pill.
        const pill = createDoiPill(doi, color, isAugmented, fetchOpenAccess(doi));
        placeReferencePill(entry.element, doi, mode, pill);
        const notice = retractionByDoi.get(doi);
        if (notice) injectRetractionInfo(entry.element, notice);
        debugLog(`References: surfaced "${entry.text.slice(0, 60)}" → ${doi} (${mode})`);
    }
    debugLog(`References: rendered ${resolved.length} inline DOI pill(s)`);
}


