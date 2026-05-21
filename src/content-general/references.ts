// Reference-list DOI resolution for article pages.
//
// Surfaces an inline DOI pill on reference-list entries so the reader gets a
// consistent click-to-open/copy action on each citation. The pill colour
// signals provenance: pink = DOI found directly on the page (in text or a
// link href), gray dotted = DOI resolved via Crossref/OpenAlex augmentation
// for entries that exposed no DOI of their own.
//
// By default only augmented (DOI-less) entries get a pill — entries that
// already carry a DOI in a link get one too when the user opts into
// `showDoiPillsOnAllReferences`.

import {findReferenceEntries, extractDoiFromHref, type ReferenceEntry} from "@shared/doi-extractor";
import {augmentDOIs} from "@shared/doi-augment";
import {validateDOIs} from "@shared/doi-validate";
import {injectRetractionInfo, retractionCheck} from "@shared/doi-retraction";
import {createDoiPill} from "@shared/doi-label";
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
function placeReferencePill(
    entry: HTMLElement,
    doi: DoiString,
    mode: "augment" | "hidden",
    pill: HTMLElement
): void {
    if (mode === "hidden") {
        for (const link of entry.querySelectorAll<HTMLAnchorElement>("a[href]")) {
            if (extractDoiFromHref(link.href) === doi) {
                link.insertAdjacentElement("afterend", pill);
                return;
            }
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

/**
 * Find reference entries whose DOI isn't visible to the reader, resolve a DOI
 * for each (via Crossref/OpenAlex for entries with no DOI at all, or via the
 * existing hidden DOI for entries that have one tucked into a button link),
 * and render an inline DOI pill + retraction info on each.
 *
 * Idempotent: each entry is marked processed, so repeated calls (e.g. from
 * the DOM mutation observer) won't reprocess the same references.
 */
export async function processReferenceDois(): Promise<void> {
    const entries = findReferenceEntries(document);
    const {showDoiPillsOnAllReferences} = await getSettings();

    const pending: PendingEntry[] = [];
    for (const entry of entries) {
        if (entry.element.hasAttribute(PROCESSED_ATTR)) continue;
        if (entry.text.length < MIN_CITATION_LENGTH) continue;

        if (entry.doi === null) {
            // Gate augmentation on year presence — avoids spending Crossref
            // queries on navigation stubs that pass the length check.
            if (!YEAR_RE.test(entry.text)) continue;
            pending.push({entry, mode: "augment", doi: null});
        } else if (showDoiPillsOnAllReferences) {
            // Entry already carries a DOI in a link — only pill it when the
            // user opted into pills on every reference. Otherwise the reader
            // can already reach the DOI, so we leave it untouched.
            pending.push({entry, mode: "hidden", doi: entry.doi});
        }
    }
    if (pending.length === 0) return;

    // Cap augmentation API load only — surfacing already-known hidden DOIs is
    // free, so don't include them in the cap.
    const augmentTargets = pending.filter((p): p is Extract<PendingEntry, {mode: "augment"}> => p.mode === "augment")
        .slice(0, MAX_REFERENCE_AUGMENTATIONS);
    const augmentSet = new Set(augmentTargets.map((p) => p.entry));
    const queued = pending.filter((p) => p.mode === "hidden" || augmentSet.has(p.entry));

    for (const p of queued) p.entry.element.setAttribute(PROCESSED_ATTR, "true");

    const hiddenCount = queued.length - augmentTargets.length;
    debugLog(`References: surfacing ${hiddenCount} hidden DOI(s), augmenting ${augmentTargets.length}`);

    // Resolve augmented DOIs via Crossref/OpenAlex.
    let augmented = new Map<string, DoiString | null>();
    if (augmentTargets.length > 0) {
        try {
            augmented = await augmentDOIs(augmentTargets.map((p) => p.entry.text));
        } catch {
            // continue with what we have — hidden DOIs still render
        }
    }

    interface Resolved {
        entry: ReferenceEntry;
        doi: DoiString;
        mode: "augment" | "hidden";
    }
    const resolved: Resolved[] = [];
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
        return;
    }

    // Augmented DOIs come from a Crossref/OpenAlex *fuzzy title match*, so
    // confirm they actually resolve before rendering. Hidden DOIs were read
    // straight off the page's own doi.org links / citation text — they're
    // inherently trustworthy, and validating 80+ of them in parallel just
    // gets the whole batch rate-limited by doi.org. So only augmented DOIs go
    // through validation; hidden DOIs are kept as-is.
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
        return;
    }

    // Augmented-only DOIs are absent from the page, so the main occurrences-
    // driven retraction pass in pageRenderChangeHandler can't anchor a pill
    // to them. Cover that gap here. Hidden/link-embedded DOIs are already in
    // occurrences and rendered there — injectRetractionInfo is idempotent
    // (FLORA_RET_CHECK_KEY) so calling it again here on the same entry would
    // no-op anyway, but we skip them explicitly to avoid the extra lookup.
    const augmentedDois = confirmed
        .filter((r) => r.mode === "augment")
        .map((r) => r.doi);
    const retractionByDoi = new Map<DoiString, Awaited<ReturnType<typeof retractionCheck>>[number]>();
    if (augmentedDois.length > 0) {
        try {
            const retractions = await retractionCheck(augmentedDois);
            for (const r of retractions) retractionByDoi.set(r.originDoi, r);
        } catch {
            // supplementary
        }
    }

    for (const {entry, doi, mode} of confirmed) {
        const isAugmented = mode === "augment";
        const color = isAugmented ? AUGMENTED_COLOR : CONFIDENT_COLOR;
        placeReferencePill(entry.element, doi, mode, createDoiPill(doi, color, isAugmented));
        const retraction = retractionByDoi.get(doi);
        if (retraction) injectRetractionInfo(entry.element, retraction);
        debugLog(`References: surfaced "${entry.text.slice(0, 60)}" → ${doi} (${mode})`);
    }
    debugLog(`References: rendered ${confirmed.length} inline DOI pill(s)`);
}

