// Per-site pill placement.
//
// The generic placement heuristics in references.ts and index.ts infer a spot
// from the shape of the DOM (longest text container, last link in the entry,
// …). That travels well across the long tail of publishers, but on sites we
// know it lands in the wrong place — most often inside a publisher's own
// "Crossref | Web of Science | Google Scholar" action row, because the DOI the
// pill describes is carried by a link in exactly that row.
//
// A site adapter names the element the pill belongs in for one hostname. Rules
// are tried in order and the first one that matches a live element wins; if
// none match, the caller falls back to the generic heuristics. That fallback is
// the important part — publisher markup changes without notice, and a stale
// selector here should quietly degrade to the generic placement rather than
// drop the pill from the page.
//
// Adding a site means appending one entry to SITE_ADAPTERS. Nothing else needs
// to change.

import {debugLog} from "@shared/debug";

/** Where the pill goes relative to the element a rule matched. */
export type PlacementPosition = "append" | "prepend" | "before" | "after";

export interface PlacementRule {
    /**
     * CSS selector, resolved within the reference entry (reference pills) or
     * against the document (title pills). The sentinel ":self" means the
     * search root itself, for "just append to the entry" rules.
     */
    selector: string;
    /** Defaults to "append". */
    position?: PlacementPosition;
}

export interface SiteAdapter {
    /** Stable identifier, used in debug output. */
    id: string;
    /**
     * Hostnames this adapter serves. Matched case-insensitively against the
     * host and any of its subdomains, ignoring a leading "www.".
     */
    hostnames: string[];
    /** Placement for pills on reference-list entries. */
    referencePill?: PlacementRule[];
    /** Placement for the merged indicator pill beside the article title. */
    titlePill?: PlacementRule[];
    /**
     * When set, only reference entries inside an element matching this
     * selector get a pill. Publishers that mark up footnotes and endnotes with
     * the same shape as citations otherwise pick up stray pills.
     */
    referenceScope?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The registry.
//
// Every site spells out its own selectors, even where two sites currently agree
// — sites are tuned and broken independently, and sharing a rule set means you
// cannot fix one publisher without retesting the other. Duplication is the
// cheaper mistake here.
//
// To add a site, copy a block below, change the selectors, and append it to
// SITE_ADAPTERS. Record the DOM path you verified it against in the comment;
// that is what makes the next person's fix a two-minute job instead of an
// archaeology exercise.
// ─────────────────────────────────────────────────────────────────────────────

// science.org — Atypon Literatum. Verified against a live article page:
//
//   section#bibliography > div[role=list] > div[role=listitem]
//     └ .citations > .citation
//         ├ .citation-content   ← citation text; the pill belongs here
//         └ .external-links     ← Crossref | Web of Science | Google Scholar
//
// The entry's only DOI is the href of the Crossref link, which sits in
// .external-links, so the generic "insert after the link carrying this DOI"
// rule wedges the pill between "Crossref" and "Web of Science". Pinning it to
// .citation-content puts it at the end of the citation sentence instead.
const SCIENCE_ORG: SiteAdapter = {
    id: "science.org",
    hostnames: ["science.org"],
    referencePill: [
        {selector: ".citation-content", position: "append"},
        // Variant templates omit the inner content div.
        {selector: ".citation", position: "append"},
    ],
    titlePill: [
        {selector: "h1[property='name']", position: "append"},
    ],
    referenceScope: "#bibliography",
};

// journals.sagepub.com — also Atypon Literatum, and as of the last check it
// serves the same structure as science.org above. Kept as its own block so the
// two can drift apart without a shared constant forcing them to move together.
//
//   section#bibliography > div[role=list] > div[role=listitem]
//     └ .citations > .citation
//         ├ .citation-content   ← citation text; the pill belongs here
//         └ .external-links     ← Crossref | Web of Science | Google Scholar
const SAGEPUB: SiteAdapter = {
    id: "sagepub",
    // Bare domain — subdomain matching covers journals.sagepub.com.
    hostnames: ["sagepub.com"],
    referencePill: [
        {selector: ".citation-content", position: "append"},
        {selector: ".citation", position: "append"},
    ],
    titlePill: [
        {selector: "h1[property='name']", position: "append"},
    ],
    // Sage renders author endnotes as div[role=doc-footnote] blocks shaped
    // enough like citations to be picked up as reference entries. Confining
    // pills to the bibliography keeps them off those.
    referenceScope: "#bibliography",
};

export const SITE_ADAPTERS: SiteAdapter[] = [
    SCIENCE_ORG,
    SAGEPUB,
];

function normaliseHost(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, "");
}

/** True when `host` is `pattern` or a subdomain of it. */
function hostMatches(host: string, pattern: string): boolean {
    const p = normaliseHost(pattern);
    return host === p || host.endsWith(`.${p}`);
}

/**
 * The adapter for a hostname, or null when the site isn't in the registry —
 * in which case callers use their generic placement.
 */
export function resolveSiteAdapter(
    hostname: string,
    registry: readonly SiteAdapter[] = SITE_ADAPTERS
): SiteAdapter | null {
    const host = normaliseHost(hostname);
    for (const adapter of registry) {
        if (adapter.hostnames.some((h) => hostMatches(host, h))) return adapter;
    }
    return null;
}

/** The adapter for the page this content script is running on. */
export function currentSiteAdapter(): SiteAdapter | null {
    return resolveSiteAdapter(location.hostname);
}

function insertAt(target: Element, pill: HTMLElement, position: PlacementPosition): void {
    switch (position) {
        case "prepend":
            target.insertBefore(pill, target.firstChild);
            break;
        case "before":
            target.insertAdjacentElement("beforebegin", pill);
            break;
        case "after":
            target.insertAdjacentElement("afterend", pill);
            break;
        default:
            target.appendChild(pill);
    }
}

/**
 * Place `pill` using the first rule that matches inside `root`.
 *
 * Returns false when no rule matched, which is the caller's signal to fall
 * back to its generic placement. A rule matching an element that is not
 * attached to the document is treated as no match — publisher templates keep
 * detached prototypes around, and placing into one loses the pill silently.
 */
export function applyPlacement(
    rules: readonly PlacementRule[] | undefined,
    root: ParentNode & Element,
    pill: HTMLElement,
    debugContext = "pill"
): boolean {
    if (!rules?.length) return false;
    for (const rule of rules) {
        const target = rule.selector === ":self" ? root : root.querySelector(rule.selector);
        if (!target || !target.isConnected) continue;
        insertAt(target, pill, rule.position ?? "append");
        debugLog(`Site adapter: placed ${debugContext} via "${rule.selector}" (${rule.position ?? "append"})`);
        return true;
    }
    debugLog(`Site adapter: no rule matched for ${debugContext}; using generic placement`);
    return false;
}

/**
 * Whether a reference entry is inside the adapter's declared bibliography
 * scope. Always true when the adapter declares no scope.
 */
export function isInReferenceScope(entry: Element, adapter: SiteAdapter | null): boolean {
    if (!adapter?.referenceScope) return true;
    return entry.closest(adapter.referenceScope) !== null;
}
