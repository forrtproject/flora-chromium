// Layout-safe placement of FLoRA's inline nodes (replication badges, DOI pills,
// retraction/concern notice pills) next to the DOI they annotate.
//
// The single invariant every function here upholds:
//
//   Injecting a FLoRA node must NEVER create a new flex/grid item or an invalid
//   table child in the host page.
//
// Why it matters: a publisher "action row" ("View PDF | Article | DOI") is very
// often `display:flex`/`grid`; dropping a badge in as a sibling of one of those
// links makes it a brand-new flex/grid item and shifts the whole row (or eats a
// grid column). Likewise a <span> appended to a <tr>/<tbody>/<table> is invalid
// markup the browser silently hoists out of the table. Both are top bug-report
// sources. So placement first checks whether a plain sibling/append is safe and,
// when it isn't, nests the node into the nearest inline text container instead.

// ── computed-display probe (test seam) ──────────────────────────────────────
// getComputedStyle is wrapped so unit tests, where jsdom cannot compute real
// layout, can inject a display map keyed by element. In real browsers the
// default probe reads the live computed style.
type DisplayProbe = (el: Element) => string;

const defaultProbe: DisplayProbe = (el) => {
  try {
    return el.ownerDocument?.defaultView?.getComputedStyle(el).display ?? "";
  } catch {
    return "";
  }
};

let displayProbe: DisplayProbe = defaultProbe;

/** Test seam: override the computed-display lookup. Pass null to restore. */
export function __setDisplayProbe(fn: DisplayProbe | null): void {
  displayProbe = fn ?? defaultProbe;
}

// ── container classification ────────────────────────────────────────────────

const FLEX_GRID_DISPLAYS = new Set([
  "flex",
  "grid",
  "inline-flex",
  "inline-grid",
]);

/** True when `el`'s own computed display makes its direct children layout items
 *  (so inserting our node as a child would add a stray flex/grid item). */
export function isFlexOrGridContainer(el: Element): boolean {
  return FLEX_GRID_DISPLAYS.has(displayProbe(el).trim());
}

// Structural table elements that cannot legally host a <span>/<div> child — the
// browser hoists such a child out of the table entirely. TD and TH are NOT here:
// they are cell content boxes and host inline content just fine.
const TABLE_STRUCTURAL_TAGS = new Set([
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "COLGROUP",
  "COL",
]);

/** True when `el` is a structural table element (table/row/section), which
 *  cannot host an injected span/div child. */
export function isTableStructural(el: Element): boolean {
  return TABLE_STRUCTURAL_TAGS.has(el.tagName);
}

/** True when appending a child to `el` cannot create a flex/grid item or an
 *  invalid table child — i.e. `el` is an ordinary block/inline flow container. */
export function isAppendSafe(el: Element): boolean {
  return !isFlexOrGridContainer(el) && !isTableStructural(el);
}

// FLoRA's own injected UI. A placement search must never nest a pill inside
// one of these — e.g. the DOI pill's hover popover contains the DOI text, so a
// naive "smallest element containing the DOI" search would drop a notice pill
// inside that (display:none) popover, making it invisible.
const FLORA_OWNED_SELECTOR =
  '.flora-doi-label, .flora-inline-badge, .flora-notice-pill, [id^="flora-"]';

/** True when `el` is part of FLoRA's own injected UI (a badge/pill/panel). */
export function isFloraOwned(el: Element): boolean {
  return typeof el.closest === "function" && el.closest(FLORA_OWNED_SELECTOR) !== null;
}

// ── visibility ──────────────────────────────────────────────────────────────

/**
 * Whether `el` is actually rendered. Unified check used by every placement path
 * (replacing an own-style-only test that let an anchor inside a `display:none`
 * subtree pass).
 *
 * Order:
 *  1. `offsetParent !== null` — true for any laid-out, in-flow visible element;
 *     null when the element or ANY ancestor is `display:none`.
 *  2. `getClientRects().length` — a `position:fixed` element (and `<body>`) has a
 *     null offsetParent yet is visible; it still reports client rects, whereas a
 *     `display:none` subtree reports none.
 *  3. computed-style walk — jsdom / no-layout environments compute neither of the
 *     above, yet unit tests exercise placement there. Treat the element as
 *     visible unless it or an ancestor is `display:none` / `visibility:hidden`.
 *     In a real browser this branch is only reached for elements steps 1–2
 *     already proved hidden, so it correctly returns false.
 */
export function isElementVisible(el: HTMLElement): boolean {
  if (el.offsetParent !== null) return true;
  if (typeof el.getClientRects === "function" && el.getClientRects().length > 0) {
    return true;
  }
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const cs = (cur as HTMLElement).ownerDocument?.defaultView?.getComputedStyle(cur as HTMLElement);
    if (!cs) continue;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
  }
  return true;
}

// ── safe-host resolution ────────────────────────────────────────────────────

/** The <td>/<th> in `scope`'s subtree carrying the most text — where a pill
 *  belongs when the surrounding row/table can't host inline content directly. */
export function mostTextBearingCell(scope: Element): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLen = -1;
  for (const cell of scope.querySelectorAll<HTMLElement>("td, th")) {
    const len = (cell.textContent ?? "").length;
    if (len > bestLen) {
      best = cell;
      bestLen = len;
    }
  }
  return best;
}

/** The smallest append-safe element within `root` (or `root` itself) whose text
 *  contains `needle` — the tightest inline host around a DOI that reads as text,
 *  so a pill nested there sits right beside the DOI. */
export function smallestTextContainer(root: HTMLElement, needle: string): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLen = Infinity;
  const consider = (el: HTMLElement): void => {
    if (!isAppendSafe(el) || isFloraOwned(el)) return;
    const t = el.textContent ?? "";
    if (!t.includes(needle)) return;
    if (t.length < bestLen) {
      best = el;
      bestLen = t.length;
    }
  };
  for (const el of root.querySelectorAll<HTMLElement>("*")) consider(el);
  consider(root);
  return best;
}

/** Nearest ancestor of `el` that is an ordinary flow block (append-safe). Used
 *  to climb out of a flex/grid/table context when nesting a node. */
function nearestFlowAncestor(el: Element): HTMLElement | null {
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    if (isAppendSafe(cur)) return cur;
  }
  return null;
}

/** The append-safe descendant of `root` carrying most (but not all) of its text
 *  — the citation/prose body, excluding trailing action rows. Only append-safe
 *  hosts qualify, so nesting there can never create a layout item. */
export function bestInnerTextHost(root: HTMLElement): HTMLElement | null {
  const rootText = (root.textContent ?? "").trim();
  if (rootText.length < 20) return null;
  let best: HTMLElement | null = null;
  let bestLen = 0;
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (el === root || !isAppendSafe(el) || isFloraOwned(el)) continue;
    const t = (el.textContent ?? "").trim();
    if (t.length <= bestLen || t.length >= rootText.length) continue;
    best = el;
    bestLen = t.length;
  }
  return best;
}

/**
 * Insert `node` immediately after `anchor` in the host's inline flow.
 *
 * Decision tree (upholding the no-new-layout-item invariant):
 *   1. `anchor`'s parent is an ordinary flow container AND `anchor` is not a
 *      structural table element → `insertAdjacentElement("afterend")`. This is
 *      the historical, non-destructive path taken on the vast majority of pages
 *      (prose links, <li> citations, ordinary <div>/<p> entries).
 *   2. Otherwise a sibling would become a flex/grid item or an invalid table
 *      child. Nest `node` into a safe host instead, in priority order:
 *        a. table context (`anchor` is a <tr>/<tbody>/…) → most text-bearing cell;
 *        b. `preferredHost` when supplied and append-safe (e.g. the citation
 *           body, or the smallest element holding the DOI text);
 *        c. the nearest ancestor that is itself an ordinary flow block;
 *        d. last resort — sibling insert anyway (a slight nudge beats no badge).
 */
export function insertNodeAfter(
  anchor: HTMLElement,
  node: HTMLElement,
  preferredHost?: HTMLElement | null,
): void {
  const parent = anchor.parentElement;
  const siblingSafe =
    parent !== null && isAppendSafe(parent) && !isTableStructural(anchor);
  if (siblingSafe) {
    anchor.insertAdjacentElement("afterend", node);
    return;
  }

  // (a) table row/section anchor → drop into the citation cell.
  if (isTableStructural(anchor)) {
    const cell = mostTextBearingCell(anchor);
    if (cell) {
      cell.appendChild(node);
      return;
    }
  }
  // (b) caller-supplied inline host (citation body / DOI span).
  if (preferredHost && isAppendSafe(preferredHost)) {
    preferredHost.appendChild(node);
    return;
  }
  // (c) climb out of the flex/grid/table context to a plain block ancestor.
  const flowAncestor = nearestFlowAncestor(anchor);
  if (flowAncestor) {
    flowAncestor.appendChild(node);
    return;
  }
  // (d) give up on safety rather than drop the badge entirely.
  anchor.insertAdjacentElement("afterend", node);
}

/**
 * Append `node` into `container`.
 *
 *   1. `container` is an ordinary flow container → `appendChild` (historical).
 *   2. `container` is flex/grid/table-structural → nest into a safe DESCENDANT
 *      (never an ancestor — that would move the node out of the entry):
 *        a. table container → most text-bearing cell;
 *        b. `preferredHost` when supplied, append-safe, and inside `container`;
 *        c. the best inner text host (citation/prose body);
 *        d. last resort — append into `container` anyway.
 */
export function appendNodeInto(
  container: HTMLElement,
  node: HTMLElement,
  preferredHost?: HTMLElement | null,
): void {
  if (isAppendSafe(container)) {
    container.appendChild(node);
    return;
  }
  if (isTableStructural(container)) {
    const cell = mostTextBearingCell(container);
    if (cell) {
      cell.appendChild(node);
      return;
    }
  }
  if (preferredHost && isAppendSafe(preferredHost) && container.contains(preferredHost)) {
    preferredHost.appendChild(node);
    return;
  }
  const inner = bestInnerTextHost(container);
  (inner ?? container).appendChild(node);
}
