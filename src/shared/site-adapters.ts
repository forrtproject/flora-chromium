// Per-site pill placement. Sites not listed here use the generic placement
// heuristics in references.ts and index.ts, and so does any listed site whose
// selectors stop matching.
//
// ── Adding a site ────────────────────────────────────────────────────────────
// Copy a block below, change the selectors, append it to SITE_ADAPTERS:
//
//   const NATURE: SiteAdapter = {
//       id: "nature",
//       hostnames: ["nature.com"],        // subdomains and www. match too
//       referencePill: [
//           {selector: ".c-article-references__text", position: "append"},
//       ],
//       titlePill: [
//           {selector: "h1.c-article-title", position: "append"},
//       ],
//       referenceScope: "#references",         // optional
//       referencePillStyle: {top: "2px"},      // optional
//       titlePillStyle: {top: "0"},            // optional
//   };
//
// - referencePill / titlePill are ordered candidate lists: the first selector
//   matching a live element wins, so list a preferred target then fallbacks for
//   older templates. If none match, the pill still renders via the generic
//   placement — it is never dropped.
// - position: "append" (default) | "prepend" | "before" | "after".
//   The selector ":self" targets the search root itself.
// - referenceScope confines pills to one part of the page, for publishers that
//   mark up footnotes closely enough to citations to be mistaken for them.
// - Give every site its own selectors even when two sites agree today. Sharing
//   a rule object across adapters is a test failure.
// - referencePillStyle / titlePillStyle override the pill wrapper's CSS, per
//   slot. `top` is the vertical nudge: the default suits body text and usually
//   needs lowering inside a large h1. Anything you do not name keeps its
//   default. Values may end in "!important" for publishers with aggressive CSS.
// - autoExpandReferences: selector for a collapsed accordion/tab control that
//   gates the reference list (Wiley renders it in the DOM already but hidden
//   behind `aria-expanded="false"` until clicked). Clicked once per pass, and
//   skipped once `aria-expanded="true"` — real users' click handler is what
//   flips the site's own CSS/ARIA state, so we trigger it rather than guess
//   which attributes to flip ourselves.
//
// Verify selectors against a live page and note the DOM path you checked in a
// comment on the block.
// ─────────────────────────────────────────────────────────────────────────────

import { debugLog } from "@shared/debug";

export type PlacementPosition = "append" | "prepend" | "before" | "after";

export interface PlacementRule {
    selector: string;
    position?: PlacementPosition;
}

/** CSS property/value pairs, e.g. {top: "2px"}. Kebab-case or camelCase. */
export type PillStyle = Record<string, string>;

export interface SiteAdapter {
    id: string;
    hostnames: string[];
    referencePill?: PlacementRule[];
    titlePill?: PlacementRule[];
    referenceScope?: string;
    referencePillStyle?: PillStyle;
    titlePillStyle?: PillStyle;
    /** Selector for a collapsed reference-list accordion/tab control to click
     *  once before scanning. See "Adding a site" note above. */
    autoExpandReferences?: string;
}

const SCIENCE_ORG: SiteAdapter = {
    id: "science.org",
    hostnames: ["science.org"],
    referencePill: [
        { selector: ".citation", position: "append" },
    ],
    titlePill: [
        { selector: "h1[property='name']", position: "append" },
    ],
    referenceScope: "#bibliography",
};

const SAGEPUB: SiteAdapter = {
    id: "sagepub",
    hostnames: ["sagepub.com"],
    referencePill: [
        { selector: ".citation", position: "append" },
    ],
    titlePill: [
        { selector: "h1[property='name']", position: "after" },
    ],
    referenceScope: "#bibliography",
    titlePillStyle: { top: "-10px" },
};

const FRONTIERS: SiteAdapter = {
    id: "frontiers",
    hostnames: ["frontiersin.org"],
    referencePill: [
        { selector: ".References__content", position: "append" },
    ],
    titlePill: [
        { selector: ".ArticleDetailsV4__main__title", position: "after" },
    ],
    referenceScope: ".References",
    titlePillStyle: { top: "-15px" },
};

const ACADEMIC_OUP_COM: SiteAdapter = {
    id: "academic.oup.com",
    hostnames: ["academic.oup.com"],
    referencePill: [
        { selector: ".mixed-citation", position: "append" },
    ],
    titlePill: [
        { selector: ".title-wrap", position: "after" },
    ],
    referenceScope: ".ref-list",
    titlePillStyle: { top: "0px" },
};

const JMIR_PUBLICATIONS: SiteAdapter = {
    id: "jmir-publications",
    hostnames: ["mental.jmir.org"],
    referencePill: [
        { selector: ":self", position: "after" },
    ],
    titlePill: [
        { selector: ".info__hidden-title", position: "before" },
    ],
    referenceScope: ".footnotes",
    titlePillStyle: { top: "0px" },
    referencePillStyle: { top: "-5px" },
};

const PEERJ: SiteAdapter = {
    id: "peerj",
    hostnames: ["peerj.com"],
    referencePill: [
        { selector: ".citation", position: "after" },
    ],
    titlePill: [
        { selector: ".article-title", position: "after" },
    ],
    titlePillStyle: { top: "0px" },
    referenceScope: ".ref-list-container",
};

const SPRINGER: SiteAdapter = {
    id: "springer",
    hostnames: ["link.springer.com"],
    referencePill: [
        { selector: ".c-article-references__text", position: "after" },
    ],
    titlePill: [
        { selector: ".c-article-title", position: "after" },
    ],
    referenceScope: ".c-article-references",
    referencePillStyle: { top: "0px" },
};

const TECHSCIENCE: SiteAdapter = {
    id: "techscience",
    hostnames: ["techscience.com"],
    referencePill: [
        { selector: ":self", position: "after" },
    ],
    titlePill: [
        { selector: ".title", position: "after" },
    ],
    titlePillStyle: { top: "0px" },
    referencePillStyle: { left: "20px", top: "0px" },
    referenceScope: ".bib",
};

const JAMA_NETWORK: SiteAdapter = {
    id: "jama-network",
    hostnames: ["jamanetwork.com"],
    referencePill: [
        { selector: ".reference-content", position: "after" },
    ],
    titlePill: [
        { selector: ".meta-article-title", position: "append" },
    ],
    referenceScope: ".references",
    titlePillStyle: { top: "0px" },
    referencePillStyle: { left: "40px" },
};

const CAMBRIDGE_ORG: SiteAdapter = {
    id: "cambridge.org",
    hostnames: ["cambridge.org"],
    referencePill: [
        { selector: ".circle-list__item__grouped", position: "append" },
    ],
    titlePill: [
        { selector: "#maincontent hgroup", position: "append" },
    ],
    referenceScope: "#references-list",
    titlePillStyle: { top: "-5px" },
};

const WILEY_ONLINE_LIBRARY: SiteAdapter = {
    id: "wiley-online-library",
    hostnames: ["onlinelibrary.wiley.com"],
    referencePill: [
        { selector: ":self", position: "after" },
    ],
    titlePill: [
        { selector: ".citation__title", position: "after" },
    ],
    titlePillStyle: { top: "0px" },
    autoExpandReferences: ".article-section__references .accordion__control",
};


export const SITE_ADAPTERS: SiteAdapter[] = [
    SCIENCE_ORG,
    SAGEPUB,
    FRONTIERS,
    ACADEMIC_OUP_COM,
    JMIR_PUBLICATIONS,
    PEERJ,
    SPRINGER,
    TECHSCIENCE,
    JAMA_NETWORK,
    CAMBRIDGE_ORG,
    WILEY_ONLINE_LIBRARY,
];

function normaliseHost(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, "");
}

function hostMatches(host: string, pattern: string): boolean {
    const p = normaliseHost(pattern);
    return host === p || host.endsWith(`.${p}`);
}

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

/** Returns false when no rule matched — the caller's signal to place generically. */
export function applyPlacement(
    rules: readonly PlacementRule[] | undefined,
    root: ParentNode & Element,
    pill: HTMLElement,
    debugContext = "pill"
): boolean {
    if (!rules?.length) return false;
    for (const rule of rules) {
        const target = rule.selector === ":self" ? root : root.querySelector(rule.selector);
        // Publisher templates keep detached prototype nodes around; placing into
        // one loses the pill with no visible error.
        if (!target || !target.isConnected) continue;
        insertAt(target, pill, rule.position ?? "append");
        debugLog(`Site adapter: placed ${debugContext} via "${rule.selector}" (${rule.position ?? "append"})`);
        return true;
    }
    debugLog(`Site adapter: no rule matched for ${debugContext}; using generic placement`);
    return false;
}

export function isInReferenceScope(entry: Element, adapter: SiteAdapter | null): boolean {
    if (!adapter?.referenceScope) return true;
    return entry.closest(adapter.referenceScope) !== null;
}

export function expandReferencesSection(adapter: SiteAdapter | null): void {
    const selector = adapter?.autoExpandReferences;
    if (!selector) return;
    const trigger = document.querySelector<HTMLElement>(selector);
    if (!trigger || trigger.getAttribute("aria-expanded") === "true") return;
    trigger.click();
}

function toKebab(prop: string): string {
    return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Apply the slot's CSS overrides; anything unnamed keeps the pill's default. */
export function applyPillStyle(
    pill: HTMLElement,
    adapter: SiteAdapter | null,
    slot: "reference" | "title"
): void {
    const style = slot === "reference" ? adapter?.referencePillStyle : adapter?.titlePillStyle;
    if (!style) return;
    for (const [prop, raw] of Object.entries(style)) {
        // setProperty silently ignores camelCase names and an inline "!important",
        // so normalise both rather than letting an override quietly do nothing.
        const important = /!important\s*$/.test(raw);
        const value = important ? raw.replace(/\s*!important\s*$/, "") : raw;
        pill.style.setProperty(toKebab(prop), value, important ? "important" : "");
    }
}
