// Recognising FLoRA's own injected UI.
//
// Two passes need this: DOI extraction (don't rescan the DOI our own pill
// prints) and the page's DOM listener (don't treat our own rendering as a page
// change and rescan in a loop).

export const FLORA_UI_SELECTOR = "[data-flora-ui]";

const FLORA_OWNED_SELECTOR = `${FLORA_UI_SELECTOR}, [id^="flora-"]`;

/** True for nodes FLoRA injected itself. */
export function isFloraOwnedNode(node: Node): boolean {
    if (node.nodeType !== Node.ELEMENT_NODE) return true; // text/comment — not meaningful for DOI scanning
    const el = node as Element;
    if (el.id.startsWith("flora-")) return true;
    for (const c of el.classList) {
        if (c.startsWith("flora-")) return true;
    }
    // Nodes swapped into a pill when its async lookups land carry no flora-
    // class of their own — they are only identifiable by an ancestor's marker.
    return el.closest(FLORA_OWNED_SELECTOR) !== null;
}

/** True when a mutation is a real page change rather than FLoRA's own rendering. */
export function isExternalMutation(m: MutationRecord): boolean {
    if (m.addedNodes.length === 0) return false;
    if ((m.target as Element).closest?.(FLORA_OWNED_SELECTOR)) return false;
    for (const node of m.addedNodes) {
        if (!isFloraOwnedNode(node)) return true;
    }
    return false;
}
