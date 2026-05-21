// Shared inline "DOI" pill — a small rounded label that reveals the resolved
// DOI (plus a copy button) on hover. Used by Google Scholar result rows and by
// reference-list entries on article pages.

export const DOI_LABEL_CLASS = "flora-doi-label";

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
 */
export function createDoiPill(doi: string, color: string, isAugmented = false): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = DOI_LABEL_CLASS;
    wrapper.style.cssText = `position: relative; display: inline-block; vertical-align: middle; margin: 0 0 0 6px;`;

    const pill = document.createElement("span");
    pill.style.cssText = `
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

    const popover = document.createElement("div");
    popover.style.cssText = `
    display: none;
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    background: #ffffff;
    border: 1px solid ${color}40;
    border-radius: 999px;
    box-shadow: 0 1px 2px rgba(27,31,36,0.08), 0 4px 16px rgba(66,74,83,0.10);
    padding: 3px 12px;
    z-index: 10000;
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

    const show = () => {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        // Reset position to measure natural size
        popover.style.top = "0";
        popover.style.bottom = "auto";
        popover.style.left = "0";
        popover.style.right = "auto";
        popover.style.display = "flex";

        const gap = 8;
        const pillRect = pill.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const spaceRight = vw - pillRect.right - gap;
        const spaceLeft = pillRect.left - gap;
        const spaceBelow = vh - pillRect.bottom - gap;
        const spaceAbove = pillRect.top - gap;

        // Prefer opening to the right, then left, then below, then above
        if (spaceRight >= popRect.width) {
            popover.style.left = `calc(100% + ${gap}px)`;
            popover.style.right = "auto";
            popover.style.top = "0";
            popover.style.bottom = "auto";
        } else if (spaceLeft >= popRect.width) {
            popover.style.left = "auto";
            popover.style.right = `calc(100% + ${gap}px)`;
            popover.style.top = "0";
            popover.style.bottom = "auto";
        } else if (spaceBelow >= popRect.height) {
            popover.style.top = `calc(100% + ${gap}px)`;
            popover.style.bottom = "auto";
            popover.style.left = "0";
            popover.style.right = "auto";
        } else if (spaceAbove >= popRect.height) {
            popover.style.top = "auto";
            popover.style.bottom = `calc(100% + ${gap}px)`;
            popover.style.left = "0";
            popover.style.right = "auto";
        } else {
            // Nothing fits perfectly — pick the direction with the most space
            const best = Math.max(spaceRight, spaceLeft, spaceBelow, spaceAbove);
            if (best === spaceRight || best === spaceLeft) {
                popover.style.top = "0";
                popover.style.bottom = "auto";
                if (best === spaceRight) {
                    popover.style.left = `calc(100% + ${gap}px)`;
                    popover.style.right = "auto";
                } else {
                    popover.style.left = "auto";
                    popover.style.right = `calc(100% + ${gap}px)`;
                }
            } else {
                popover.style.left = "0";
                popover.style.right = "auto";
                if (best === spaceBelow) {
                    popover.style.top = `calc(100% + ${gap}px)`;
                    popover.style.bottom = "auto";
                } else {
                    popover.style.top = "auto";
                    popover.style.bottom = `calc(100% + ${gap}px)`;
                }
            }
        }
    };
    const hide = () => {
        hideTimeout = setTimeout(() => {
            popover.style.display = "none";
        }, 200);
    };

    pill.addEventListener("mouseenter", show);
    pill.addEventListener("mouseleave", hide);
    popover.addEventListener("mouseenter", show);
    popover.addEventListener("mouseleave", hide);

    wrapper.appendChild(pill);
    wrapper.appendChild(popover);
    return wrapper;
}
