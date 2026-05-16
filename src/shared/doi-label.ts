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
    const wrapper = document.createElement("div");
    wrapper.className = DOI_LABEL_CLASS;
    wrapper.style.cssText = `position: relative; display: inline-block; margin-top: 4px;`;

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
  `;
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
    border: 1px solid #d0d7de;
    border-radius: 6px;
    box-shadow: 0 1px 3px rgba(27,31,36,0.12), 0 8px 24px rgba(66,74,83,0.12);
    padding: 10px 12px;
    z-index: 10000;
    white-space: nowrap;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 12px;
    flex-direction: column;
    gap: 6px;
  `;

    const contentRow = document.createElement("div");
    contentRow.style.cssText = `display: flex; align-items: center;`;

    const doiText = document.createElement("span");
    doiText.textContent = doi;
    doiText.style.cssText = `color: #1f2328; margin-right: 8px; font-size: 12px;`;

    const clipboardSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="display:block;"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>`;
    const checkSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="display:block;"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;

    const copyBtn = document.createElement("button");
    copyBtn.innerHTML = clipboardSvg;
    copyBtn.title = "Copy DOI";
    copyBtn.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    min-width: 14px;
    min-height: 14px;
    padding: 0;
    margin: 0;
    border: none;
    background: none;
    cursor: pointer;
    color: #656d76;
    transition: color 0.15s ease;
    line-height: 0;
    font-size: 0;
  `;
    copyBtn.addEventListener("mouseenter", () => {
        copyBtn.style.color = "#24292f";
    });
    copyBtn.addEventListener("mouseleave", () => {
        copyBtn.style.color = "#656d76";
    });
    copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(doi).then(() => {
            copyBtn.innerHTML = checkSvg;
            copyBtn.style.color = "#853953";
            setTimeout(() => {
                copyBtn.innerHTML = clipboardSvg;
                copyBtn.style.color = "#656d76";
            }, 1500);
        });
    });

    contentRow.appendChild(doiText);
    contentRow.appendChild(copyBtn);
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
