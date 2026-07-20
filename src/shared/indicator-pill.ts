// Merged FLoRA indicator pill — combines the DOI badge, Open Access padlock,
// PubPeer discussion marker, and retraction/replication badge into a single
// pill (mockup: a rounded maroon pill with icon segments split by dividers).
//
// Segments that have no data stay in the pill (dimmed) rather than
// disappearing, so the pill's width/segment order never shifts as async
// lookups resolve. The segments themselves are just status glyphs — hovering
// (or clicking, to pin) the pill opens a popover listing every indicator as
// its own row, and all actual interaction (copy DOI, open on doi.org, open
// the OA full text, open the PubPeer thread, open the retraction notice or
// FLoRA Atlas entry) happens from inside that popover.

import type {DoiString, LookupState, RetractionResponse} from "@shared/types";
import type {OpenAccessStatus} from "@shared/openaccess";
import type {PubPeerFeedback} from "@shared/pubpeer-api";
import {lookupPubPeerForDoi} from "@shared/pubpeer-api";
import {noticePresentation} from "@shared/doi-retraction";
import {OA_UNLOCK_SVG} from "@shared/doi-label";

export const INDICATOR_PILL_CLASS = "flora-indicator-pill";

const PUBPEER_HUB_SVG =
    `<svg width="11" height="15" viewBox="0 0 98.5 146.5" fill="none" stroke="currentColor" ` +
    `stroke-width="9" stroke-linecap="round" style="display:block;">` +
    `<circle cx="13.667" cy="34.833" r="10.167"/>` +
    `<circle cx="86.302" cy="80.344" r="10.167"/>` +
    `<circle cx="86.302" cy="12.741" r="10.167"/>` +
    `<circle cx="13.04" cy="133.811" r="10.166"/>` +
    `<line x1="13.04" y1="45" x2="13.04" y2="123.645"/>` +
    `<line x1="23.44" y1="32.04" x2="76.554" y2="15.626"/>` +
    `<line x1="86.303" y1="22.907" x2="86.303" y2="70.177"/>` +
    `<line x1="18.027" y1="124.955" x2="80.772" y2="21.267"/>` +
    `<line x1="76.136" y1="80.344" x2="45.023" y2="80.344"/></svg>`;

const DIVIDER_STYLE = "width:1px;height:11px;background:rgba(255,255,255,0.4);flex-shrink:0;margin:0 6px;";

// Link/chain glyph for the popover's DOI row — same Octicons family as the
// copy/open/check icons used elsewhere in the popover.
const DOI_LINK_SVG =
    `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="display:block;">` +
    `<path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 ` +
    `.75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 ` +
    `.75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z">` +
    `</path></svg>`;

function makeDivider(): HTMLElement {
    const d = document.createElement("span");
    d.style.cssText = DIVIDER_STYLE;
    return d;
}

// ──────────────────────────────────────────────
// Inline segments — dimmed/lit status glyphs only, no direct interaction.
// ──────────────────────────────────────────────

function buildOaSegment(oa: OpenAccessStatus | null): HTMLElement {
    const available = !!oa?.isOa;
    const el = document.createElement("span");
    el.setAttribute("data-flora-oa-segment", "");
    el.style.cssText = `display:inline-flex;align-items:center;line-height:0;color:#fff;opacity:${available ? "1" : "0.35"};`;
    el.innerHTML = OA_UNLOCK_SVG;
    el.title = available ? "Open Access — free full text available" : "Open Access status unavailable";
    return el;
}

function buildPubPeerSegment(feedback: PubPeerFeedback | null): HTMLElement {
    const available = !!feedback && feedback.total_comments > 0;
    const el = document.createElement("span");
    el.setAttribute("data-flora-pubpeer-segment", "");
    el.style.cssText = `display:inline-flex;align-items:center;line-height:0;color:#fff;opacity:${available ? "1" : "0.35"};`;
    el.innerHTML = PUBPEER_HUB_SVG;
    el.title = available && feedback
        ? `${feedback.total_comments} ${feedback.total_comments === 1 ? "comment" : "comments"} on PubPeer`
        : "No PubPeer discussion found";
    return el;
}

interface BadgeSignal {
    available: boolean;
    href?: string;
    glyph: string;       // inline segment text
    background: string;  // inline segment background colour
    accent: string;      // popover row icon/action colour
    rowTitle: string;    // popover row heading
    rowSubtitle: string; // popover row status line
    actionLabel?: string;
}

// Replications take priority over reproductions when a DOI has both — the
// badge shows one count/label, not two, to keep the pill's shape stable.
function resolveBadgeSignal(
    doi: DoiString,
    retraction: RetractionResponse | null | undefined,
    replicationsCount: number | null | undefined,
    reproductionsCount: number | null | undefined
): BadgeSignal {
    if (retraction) {
        const presentation = noticePresentation(retraction.kind);
        return {
            available: true,
            href: `https://doi.org/${retraction.doi}`,
            glyph: "!",
            background: presentation.pillStroke,
            accent: presentation.pillStroke,
            rowTitle: presentation.label,
            rowSubtitle: presentation.bannerCopy,
            actionLabel: "View notice",
        };
    }
    if (replicationsCount && replicationsCount > 0) {
        return {
            available: true,
            href: `https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(doi)}`,
            glyph: `${replicationsCount} Reps`,
            background: "rgba(255,255,255,0.25)",
            accent: "#0369a1",
            rowTitle: "Replications",
            rowSubtitle: `${replicationsCount} replication${replicationsCount === 1 ? "" : "s"} recorded`,
            actionLabel: "View in Atlas",
        };
    }
    if (reproductionsCount && reproductionsCount > 0) {
        return {
            available: true,
            href: `https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(doi)}`,
            glyph: `${reproductionsCount} Reprod`,
            background: "rgba(255,255,255,0.25)",
            accent: "#6d28d9",
            rowTitle: "Reproductions",
            rowSubtitle: `${reproductionsCount} reproduction${reproductionsCount === 1 ? "" : "s"} recorded`,
            actionLabel: "View in Atlas",
        };
    }
    return {
        available: false,
        glyph: "",
        background: "rgba(255,255,255,0.15)",
        accent: "#8b949e",
        rowTitle: "Replication data",
        rowSubtitle: "No replication or reproduction data found",
    };
}

function buildBadgeSegment(signal: BadgeSignal): HTMLElement {
    const el = document.createElement("span");
    el.setAttribute("data-flora-badge-segment", "");
    // Single-glyph states ("!" or empty) render as a small circle; multi-char
    // labels ("3 Reps") widen into a pill so the text isn't clipped.
    const isPill = signal.glyph.length > 1;
    el.style.cssText = `
    display:inline-flex;align-items:center;justify-content:center;
    height:15px;${isPill ? "min-width:15px;padding:0 5px;border-radius:999px;" : "width:15px;border-radius:50%;"}
    margin-left:2px;flex-shrink:0;white-space:nowrap;
    font-size:9px;font-weight:700;line-height:1;color:#fff;
    background:${signal.background};
    opacity:${signal.available ? "1" : "0.35"};
  `;
    el.textContent = signal.glyph;
    el.title = signal.available ? `${signal.rowTitle} — ${signal.rowSubtitle}` : signal.rowSubtitle;
    return el;
}

// ──────────────────────────────────────────────
// Popover rows — the actual interactive surface for every segment.
// ──────────────────────────────────────────────

const ROW_LABEL_WRAP = "display:flex;flex-direction:column;flex:1;min-width:0;gap:1px;";
const ROW_TITLE_STYLE = "font-size:11.5px;font-weight:600;color:#1f2328;line-height:1.3;";

function rowIconWrapStyle(color: string, available: boolean): string {
    return `display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;color:${color};opacity:${available ? "1" : "0.4"};`;
}

function rowSubStyle(available: boolean): string {
    return `font-size:10.5px;color:${available ? "#57606a" : "#8b949e"};line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
}

function rowActionStyle(color: string): string {
    return `font-size:10.5px;font-weight:600;color:${color};flex-shrink:0;white-space:nowrap;`;
}

/** Build one interactive popover row. `href` present → clickable <a>; absent → inert <div>. */
function buildRow(opts: {
    iconHtml: string;
    accent: string;
    available: boolean;
    title: string;
    subtitle: string;
    href?: string;
    actionLabel?: string;
    attr: string;
}): HTMLElement {
    const useLink = opts.available && !!opts.href;
    const row = document.createElement(useLink ? "a" : "div") as HTMLElement;
    row.setAttribute(opts.attr, "");
    row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 4px;border-radius:6px;text-decoration:none;${useLink ? "cursor:pointer;" : "cursor:default;"}`;
    if (useLink && row instanceof HTMLAnchorElement && opts.href) {
        row.href = opts.href;
        row.target = "_blank";
        row.rel = "noopener noreferrer";
        row.addEventListener("click", (e) => e.stopPropagation());
        row.addEventListener("mouseenter", () => { row.style.background = "#f6f8fa"; });
        row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
    }
    row.innerHTML = `
    <span style="${rowIconWrapStyle(opts.accent, opts.available)}">${opts.iconHtml}</span>
    <span style="${ROW_LABEL_WRAP}">
      <span style="${ROW_TITLE_STYLE}">${opts.title}</span>
      <span style="${rowSubStyle(opts.available)}">${opts.subtitle}</span>
    </span>
    ${useLink ? `<span style="${rowActionStyle(opts.accent)}">${opts.actionLabel ?? "View"} ↗</span>` : ""}
  `;
    return row;
}

const DOT_ICON = (color: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span>`;

function buildOaRow(oa: OpenAccessStatus | null): HTMLElement {
    const available = !!oa?.isOa;
    return buildRow({
        iconHtml: OA_UNLOCK_SVG,
        accent: "#853953",
        available: available && !!oa?.url,
        title: "Open Access",
        subtitle: available ? "Free full text available" : "Not confirmed open access",
        href: oa?.url ?? undefined,
        actionLabel: "View PDF",
        attr: "data-flora-oa-row",
    });
}

function buildPubPeerRow(feedback: PubPeerFeedback | null): HTMLElement {
    const available = !!feedback && feedback.total_comments > 0;
    return buildRow({
        iconHtml: PUBPEER_HUB_SVG,
        accent: "#446058",
        available,
        title: "PubPeer",
        subtitle: available && feedback
            ? `${feedback.total_comments} ${feedback.total_comments === 1 ? "comment" : "comments"}`
            : "No discussion found",
        href: feedback?.url,
        actionLabel: "View thread",
        attr: "data-flora-pubpeer-row",
    });
}

function buildBadgeRow(signal: BadgeSignal): HTMLElement {
    return buildRow({
        iconHtml: DOT_ICON(signal.accent),
        accent: signal.accent,
        available: signal.available,
        title: signal.rowTitle,
        subtitle: signal.rowSubtitle,
        href: signal.href,
        actionLabel: signal.actionLabel,
        attr: "data-flora-badge-row",
    });
}

export interface IndicatorPillOptions {
    doi: DoiString;
    /** Pill background colour — default matches confident/direct DOI extraction. */
    color?: string;
    /** True when the DOI came from Crossref/OpenAlex augmentation rather than direct extraction. */
    isAugmented?: boolean;
    /** Open Access lookup — resolves the padlock segment/row when it lands. */
    oaStatus?: Promise<OpenAccessStatus | null>;
    /** Already-resolved retraction/concern notice for this DOI, if any. */
    retraction?: RetractionResponse | null;
    /** Already-known replication count for this DOI, if any (pass only when > 0). Takes priority over reproductionsCount. */
    replicationsCount?: number | null;
    /** Already-known reproduction count for this DOI, if any (pass only when > 0). Shown only when replicationsCount is absent. */
    reproductionsCount?: number | null;
}

/**
 * Build the merged FLoRA indicator pill: DOI content + Open Access padlock +
 * PubPeer marker + retraction/replication badge, each segment split by a
 * divider. Unavailable segments render dimmed rather than being removed, so
 * the pill's shape stays stable as async data lands. Hovering (or clicking,
 * to pin) the pill opens a popover with one interactive row per segment.
 */
export function createIndicatorPill(options: IndicatorPillOptions): HTMLElement {
    const {doi, color = "#853953", isAugmented = false, oaStatus, retraction = null, replicationsCount = null, reproductionsCount = null} = options;

    const wrapper = document.createElement("span");
    wrapper.className = INDICATOR_PILL_CLASS;
    wrapper.setAttribute("data-flora-doi", doi);
    // Marks the whole subtree as FLoRA's own UI so the DOI extractor skips it —
    // the popover renders the DOI as plain text and links it to doi.org, which
    // would otherwise be rescanned as a page occurrence and pilled again.
    wrapper.setAttribute("data-flora-ui", "");
    // Nudge up 1px with relative `top`, NOT `transform` — a transform would make
    // this wrapper the containing block for the position:fixed popover below,
    // throwing its viewport-based coordinates far off from the pill.
    wrapper.style.cssText = "position: relative; display: inline-block; vertical-align: baseline; top: -1px; margin-left: 6px;";

    const pill = document.createElement("span");
    pill.style.cssText = `
    display: inline-flex;
    align-items: center;
    font-size: 12px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: white;
    background: ${color};
    opacity: 0.75;
    padding: 2px 8px 2px 10px;
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

    // Segment 1 — DOI content.
    const doiSegment = document.createElement("span");
    if (isAugmented) {
        doiSegment.textContent = "DOI";
        doiSegment.style.cssText = "text-decoration: underline dotted; text-underline-offset: 2px; text-decoration-thickness: 1px;";
    } else {
        const checkSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="white" style="display:inline-block;vertical-align:middle;"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;
        doiSegment.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
        doiSegment.innerHTML = `DOI ${checkSvg}`;
    }
    pill.appendChild(doiSegment);

    // Segment 2 — Open Access padlock (async).
    pill.appendChild(makeDivider());
    let oaSegment = buildOaSegment(null);
    pill.appendChild(oaSegment);

    // Segment 3 — PubPeer marker (async, fetched internally so callers don't
    // each need to import pubpeer-api.ts; per-pill lookups are coalesced into
    // one batch request and cached).
    pill.appendChild(makeDivider());
    let pubpeerSegment = buildPubPeerSegment(null);
    pill.appendChild(pubpeerSegment);

    // Segment 4 — retraction/replication badge (already-resolved inputs).
    pill.appendChild(makeDivider());
    const badgeSegment = buildBadgeSegment(resolveBadgeSignal(doi, retraction, replicationsCount, reproductionsCount));
    pill.appendChild(badgeSegment);

    // ── Popover — one interactive row per segment, plus DOI copy/open ──
    const popover = document.createElement("div");
    // position:fixed (not absolute) so the popover is positioned against the
    // viewport — an ancestor with overflow:hidden (common on article content
    // columns) would otherwise clip it. Coordinates are set in show().
    popover.style.cssText = `
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    min-width: 230px;
    background: #ffffff;
    border: 1px solid ${color}40;
    border-radius: 12px;
    box-shadow: 0 1px 2px rgba(27,31,36,0.08), 0 4px 16px rgba(66,74,83,0.10);
    padding: 8px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 12px;
    line-height: 18px;
    flex-direction: column;
    gap: 2px;
  `;

    const contentRow = document.createElement("div");
    contentRow.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 5px 4px;";

    const doiIcon = document.createElement("span");
    doiIcon.style.cssText = rowIconWrapStyle(color, true);
    doiIcon.innerHTML = DOI_LINK_SVG;

    const doiText = document.createElement("span");
    doiText.textContent = doi;
    doiText.style.cssText = `
    flex: 1;
    min-width: 0;
    color: #1f2328;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 11.5px;
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    actions.style.cssText = "display: inline-flex; align-items: center; gap: 10px; flex-shrink: 0;";
    actions.appendChild(openLink);
    actions.appendChild(copyBtn);

    contentRow.appendChild(doiIcon);
    contentRow.appendChild(doiText);
    contentRow.appendChild(actions);
    popover.appendChild(contentRow);

    const sectionDivider = document.createElement("div");
    sectionDivider.style.cssText = "height:1px;background:#eaeef2;margin:0 0 2px;";
    popover.appendChild(sectionDivider);

    let oaRow = buildOaRow(null);
    popover.appendChild(oaRow);
    if (oaStatus) {
        void oaStatus.then((oa) => {
            const resolvedSeg = buildOaSegment(oa);
            oaSegment.replaceWith(resolvedSeg);
            oaSegment = resolvedSeg;
            const resolvedRow = buildOaRow(oa);
            oaRow.replaceWith(resolvedRow);
            oaRow = resolvedRow;
        }).catch(() => {});
    }

    let pubpeerRow = buildPubPeerRow(null);
    popover.appendChild(pubpeerRow);
    void lookupPubPeerForDoi(doi).then((feedback) => {
        const resolvedSeg = buildPubPeerSegment(feedback);
        pubpeerSegment.replaceWith(resolvedSeg);
        pubpeerSegment = resolvedSeg;
        const resolvedRow = buildPubPeerRow(feedback);
        pubpeerRow.replaceWith(resolvedRow);
        pubpeerRow = resolvedRow;
    }).catch(() => {});

    const badgeRow = buildBadgeRow(resolveBadgeSignal(doi, retraction, replicationsCount, reproductionsCount));
    popover.appendChild(badgeRow);

    let hideTimeout: ReturnType<typeof setTimeout> | null = null;
    let pinned = false;
    let docClickHandler: ((e: MouseEvent) => void) | null = null;

    const show = () => {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        // Reveal first so the popover has measurable dimensions.
        popover.style.display = "flex";

        const gap = 8;
        const margin = 4;
        const pillRect = pill.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const spaceRight = vw - pillRect.right - gap;
        const spaceLeft = pillRect.left - gap;
        const spaceBelow = vh - pillRect.bottom - gap;
        const spaceAbove = pillRect.top - gap;

        // Prefer opening to the right, then left, then below, then above —
        // falling back to whichever side has the most room.
        let left = 0;
        let top = 0;
        const placeRight = () => { left = pillRect.right + gap; top = pillRect.top; };
        const placeLeft = () => { left = pillRect.left - gap - popRect.width; top = pillRect.top; };
        const placeBelow = () => { left = pillRect.left; top = pillRect.bottom + gap; };
        const placeAbove = () => { left = pillRect.left; top = pillRect.top - gap - popRect.height; };

        if (spaceRight >= popRect.width) placeRight();
        else if (spaceLeft >= popRect.width) placeLeft();
        else if (spaceBelow >= popRect.height) placeBelow();
        else if (spaceAbove >= popRect.height) placeAbove();
        else {
            const best = Math.max(spaceRight, spaceLeft, spaceBelow, spaceAbove);
            if (best === spaceRight) placeRight();
            else if (best === spaceLeft) placeLeft();
            else if (best === spaceBelow) placeBelow();
            else placeAbove();
        }

        // Clamp into the viewport so the popover is never cut off.
        left = Math.max(margin, Math.min(left, vw - popRect.width - margin));
        top = Math.max(margin, Math.min(top, vh - popRect.height - margin));
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        popover.style.right = "auto";
        popover.style.bottom = "auto";
    };
    const hide = () => {
        if (pinned) return;
        hideTimeout = setTimeout(() => {
            popover.style.display = "none";
        }, 200);
    };

    const unpin = () => {
        if (!pinned) return;
        pinned = false;
        pill.style.outline = "";
        pill.style.outlineOffset = "";
        if (docClickHandler) {
            document.removeEventListener("click", docClickHandler, {capture: true});
            docClickHandler = null;
        }
        hide();
    };

    pill.addEventListener("click", (e) => {
        e.stopPropagation();
        if (pinned) {
            unpin();
            return;
        }
        pinned = true;
        pill.style.outline = `2px solid ${color}60`;
        pill.style.outlineOffset = "1px";
        show();
        // Defer so this same click doesn't immediately trigger the doc handler.
        setTimeout(() => {
            docClickHandler = (ev: MouseEvent) => {
                // A hydrating SPA can wipe this pill while it is pinned, which
                // would otherwise strand this listener on `document` — holding
                // the detached pill alive — with nothing left to unpin it.
                if (!wrapper.isConnected || !wrapper.contains(ev.target as Node)) unpin();
            };
            document.addEventListener("click", docClickHandler, {capture: true});
        }, 0);
    });

    pill.addEventListener("mouseenter", show);
    pill.addEventListener("mouseleave", hide);
    popover.addEventListener("mouseenter", show);
    popover.addEventListener("mouseleave", hide);

    wrapper.appendChild(pill);
    wrapper.appendChild(popover);
    return wrapper;
}

/**
 * Refresh the retraction/replication badge segment and popover row on every
 * merged pill under `root` once fresher `pageState`/`redacts` data lands.
 * Idempotent — safe to call repeatedly (e.g. alongside renderInlineBadges'
 * re-placement passes).
 */
export function updateIndicatorPillBadges(
    root: ParentNode,
    pageState: ReadonlyMap<DoiString, LookupState>,
    redacts: readonly RetractionResponse[]
): void {
    const retractionByDoi = new Map(redacts.map((r) => [r.originDoi, r] as const));
    for (const wrapper of root.querySelectorAll<HTMLElement>(`.${INDICATOR_PILL_CLASS}`)) {
        const doi = wrapper.getAttribute("data-flora-doi") as DoiString | null;
        if (!doi) continue;
        const badgeSegment = wrapper.querySelector<HTMLElement>("[data-flora-badge-segment]");
        const badgeRow = wrapper.querySelector<HTMLElement>("[data-flora-badge-row]");
        if (!badgeSegment && !badgeRow) continue;

        const retraction = retractionByDoi.get(doi) ?? null;
        const state = pageState.get(doi);
        const replicationsCount = state?.status === "matched" ? state.result.record.stats.n_replications_total : null;
        const reproductionsCount = state?.status === "matched" ? state.result.record.stats.n_reproductions_total : null;
        const signal = resolveBadgeSignal(doi, retraction, replicationsCount, reproductionsCount);

        if (badgeSegment) badgeSegment.replaceWith(buildBadgeSegment(signal));
        if (badgeRow) badgeRow.replaceWith(buildBadgeRow(signal));
    }
}
