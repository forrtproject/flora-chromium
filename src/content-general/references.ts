// Reference-list DOI resolution for article pages.
//
// Surfaces a DOI pill on a reference whenever the DOI is *not visible to the
// reader* — either because the page exposes no DOI for it at all (resolved via
// Crossref/OpenAlex) or because the DOI is tucked into a non-doi.org button
// link URL (e.g. tiny "Crossref"/"PubMed" buttons) where the reader can't see
// it. References whose DOI is plainly written or on a doi.org link are left
// alone.

import {findReferenceEntries, type ReferenceEntry} from "@shared/doi-extractor";
import {augmentDOIs} from "@shared/doi-augment";
import {validateDOIs} from "@shared/doi-validate";
import {injectRetractionInfo, retractionCheck} from "@shared/doi-retraction";
import {createDoiPill} from "@shared/doi-label";
import {debugLog} from "@shared/debug";
import type {DoiString} from "@shared/types";

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

    const pending: PendingEntry[] = [];
    for (const entry of entries) {
        if (entry.element.hasAttribute(PROCESSED_ATTR)) continue;
        if (entry.text.length < MIN_CITATION_LENGTH) continue;

        if (entry.doi === null) {
            pending.push({entry, mode: "augment", doi: null});
        } else if (!isDoiVisibleToReader(entry, entry.doi)) {
            pending.push({entry, mode: "hidden", doi: entry.doi});
        }
        // else: DOI is plainly visible — no pill needed
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

    // Confirm the DOIs actually resolve before rendering.
    let validated = new Map<DoiString, boolean>();
    try {
        validated = await validateDOIs(resolved.map((r) => r.doi));
    } catch {
        // validation unavailable — trust resolution
    }
    const confirmed = resolved.filter((r) => validated.get(r.doi) !== false);
    if (confirmed.length === 0) {
        debugLog("References: resolved DOIs all failed doi.org validation");
        return;
    }

    // Batch retraction check.
    let retractions: Awaited<ReturnType<typeof retractionCheck>> = [];
    try {
        retractions = await retractionCheck(confirmed.map((r) => r.doi));
    } catch {
        // supplementary
    }
    const retractionByDoi = new Map(retractions.map((r) => [r.originDoi, r]));

    for (const {entry, doi, mode} of confirmed) {
        const isAugmented = mode === "augment";
        const color = isAugmented ? AUGMENTED_COLOR : CONFIDENT_COLOR;
        entry.element.appendChild(createDoiPill(doi, color, isAugmented));
        const retraction = retractionByDoi.get(doi);
        if (retraction) injectRetractionInfo(entry.element, retraction);
        debugLog(`References: surfaced "${entry.text.slice(0, 60)}" → ${doi} (${mode})`);
    }
    debugLog(`References: rendered ${confirmed.length} inline DOI pill(s)`);
}

/**
 * Decide whether a reference's DOI is already visible to the reader.
 *
 * "Visible" means the DOI string appears as a substring of the rendered
 * citation text (which includes every link's inner text). A doi.org URL with
 * a label like "Crossref" or "PubMed" does NOT count as visible — the reader
 * sees the label, not the DOI — and is exactly the case the pill surfaces.
 */
function isDoiVisibleToReader(entry: ReferenceEntry, doi: DoiString): boolean {
    return entry.text.toLowerCase().includes(doi);
}
