// Shared inline "DOI" pill — a small rounded label that reveals the resolved
// DOI (plus a copy button) on hover. Used by Google Scholar result rows and by
// reference-list entries on article pages.

import type { OpenAccessStatus } from "./openaccess";

export const DOI_LABEL_CLASS = "flora-doi-label";

let inlinePillStyleInjected = false;
function ensureInlinePillStyle(): void {
    if (inlinePillStyleInjected) return;
    inlinePillStyleInjected = true;
    const style = document.createElement("style");
    // Logical margins (margin-inline-*) so the gaps sit on the correct side in
    // both LTR and RTL documents.
    style.textContent = `
        .${DOI_LABEL_CLASS}:not(:first-child),
        .${FLORA_NOTICE_PILL_CLASS}:not(:first-child) {
            margin-inline-start: 6px;
        }
        .${DOI_LABEL_CLASS} {
            margin-inline-end: 2px;
        }
    `;
    document.head.appendChild(style);
}

// Shared class for the inline notice pill (retraction or expression of concern).
// Exported so doi-retraction.ts can tag its wrapper and pick up the shared
// :not(:first-child) margin rule above.
export const FLORA_NOTICE_PILL_CLASS = "flora-notice-pill";

// Open padlock — shown inside the pill only when a free full text exists.
const OA_UNLOCK_SVG =
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">` +
    `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;

/**
 * Build a DOI pill element (pill + hover popover with copy button).
 *
 * The returned wrapper is `display: inline-block` and can be appended to any
 * container. Callers are responsible for placing it in the DOM.
 *
 * @param doi          the resolved DOI string
 * @param color        background colour of the pill
 * @param isAugmented  true when the DOI came from Crossref/OpenAlex augmentation
 *                     rather than direct extraction — renders a dotted "DOI"
 *                     label instead of the "DOI ✓" check.
 * @param oaStatus     optional Open Access lookup; when it resolves to an open
 *                     access result, an open-padlock link to the free full text
 *                     is added inside the pill. Paywalled/unknown adds nothing.
 */
export function createDoiPill(
    doi: string,
    color: string,
    isAugmented = false,
    oaStatus?: Promise<OpenAccessStatus | null>
): HTMLElement {
    ensureInlinePillStyle();
    const wrapper = document.createElement("span");
    wrapper.className = DOI_LABEL_CLASS;
    // Nudge up 1px with relative `top`, NOT `transform` — a transform would make
    // this wrapper the containing block for the position:fixed popover below,
    // throwing its viewport-based coordinates far off from the pill.
    wrapper.style.cssText = `position: relative; display: inline-block; vertical-align: baseline; top: -1px;`;

    const pill = document.createElement("span");
    // direction:ltr keeps the pill's Latin content ("DOI ✓", "Free") in order
    // on RTL host pages (an inline-flex row otherwise reverses to "✓ DOI").
    pill.style.cssText = `
    direction: ltr;
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

    // Open Access affordance inside the pill — only surfaced when a free full
    // text exists (a positive, tappable signal). Paywalled/unknown adds nothing.
    if (oaStatus) {
        const oaSlot = document.createElement("span");
        oaSlot.style.cssText = "display:inline-flex;align-items:center;gap:5px;line-height:0;";
        pill.appendChild(oaSlot);
        void oaStatus.then((oa) => {
            if (!oa || !oa.isOa) { oaSlot.remove(); return; }

            // Thin divider so the lock reads as a separate action, not part of "DOI ✓".
            const divider = document.createElement("span");
            divider.style.cssText = "width:1px;height:11px;background:rgba(255,255,255,0.4);";

            const el = oa.url ? document.createElement("a") : document.createElement("span");
            el.title = "Open Access — view free full text";
            el.style.cssText =
                "display:inline-flex;align-items:center;gap:3px;line-height:1;color:#fff;" +
                "font-size:11px;font-weight:600;letter-spacing:0.02em;text-decoration:none;" +
                "opacity:0.9;transition:opacity 0.15s ease;";
            if (oa.url && el instanceof HTMLAnchorElement) {
                el.href = oa.url;
                el.target = "_blank";
                el.rel = "noopener noreferrer";
                el.addEventListener("click", (e) => e.stopPropagation());
                el.addEventListener("mouseenter", () => { el.style.opacity = "1"; });
                el.addEventListener("mouseleave", () => { el.style.opacity = "0.9"; });
            }
            el.innerHTML = `${OA_UNLOCK_SVG}<span>Free</span>`;

            oaSlot.appendChild(divider);
            oaSlot.appendChild(el);
        });
    }

    const popover = document.createElement("div");
    // position:fixed (not absolute) so the popover is positioned against the
    // viewport — an ancestor with overflow:hidden (common on article content
    // columns) would otherwise clip it. Coordinates are set in show().
    popover.style.cssText = `
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    background: #ffffff;
    border: 1px solid ${color}40;
    border-radius: 999px;
    box-shadow: 0 1px 2px rgba(27,31,36,0.08), 0 4px 16px rgba(66,74,83,0.10);
    padding: 3px 12px;
    z-index: 2147483647;
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
            document.removeEventListener("click", docClickHandler, { capture: true });
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
                if (!wrapper.contains(ev.target as Node)) unpin();
            };
            document.addEventListener("click", docClickHandler, { capture: true });
        }, 0);
    });

    pill.addEventListener("mouseenter", () => {
        pill.style.opacity = "1";
        pill.style.boxShadow = "0 1px 2px rgba(27,31,36,0.12), 0 2px 6px rgba(66,74,83,0.14)";
        pill.style.transform = "translateY(-1px)";
        show();
    });
    pill.addEventListener("mouseleave", () => {
        if (!pinned) {
            pill.style.opacity = "0.75";
            pill.style.boxShadow = "0 0 0 0 rgba(0,0,0,0)";
            pill.style.transform = "translateY(0)";
        }
        hide();
    });
    popover.addEventListener("mouseenter", show);
    popover.addEventListener("mouseleave", hide);

    wrapper.appendChild(pill);
    wrapper.appendChild(popover);
    return wrapper;
}
