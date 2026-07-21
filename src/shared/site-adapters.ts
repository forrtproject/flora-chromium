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


export const SITE_ADAPTERS: SiteAdapter[] = [
    SCIENCE_ORG,
    SAGEPUB,
    FRONTIERS,
    ACADEMIC_OUP_COM,
    JMIR_PUBLICATIONS,
    PEERJ
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
