import {RetractionLookupResponse} from "@shared/messages";

/**
 * Request retraction status. Due to CORS policies, the request
 * must execute in the background context.
 * @param target - DOM tree anchor used for label rendering
 * @param doi
 */
export async function retractionCheck(target: Element, doi: string) {
    try {
        const resp = await chrome.runtime.sendMessage({
            type: "RET_WATCH_FETCH",
            doi
        });
        if (resp && resp.retracted) {
            injectRetractionInfo(target, resp)
        }
    } catch {
    }
}

function injectRetractionInfo(target: Element, info: RetractionLookupResponse): void {
    // Prefer the right-side PDF area; if absent, create one to match Scholar's layout

    const wrapper = document.createElement("div");
    wrapper.className = "flora-redacted-label";
    wrapper.style.cssText = `position: relative; display: inline-block; margin-top: 4px; margin-left: 2px`;

    const pill = document.createElement("a");
    pill.setAttribute("href", `https://doi.org/${info.doi}`)
    pill.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: white;
    background: #ff073a;
    opacity: 0.75;
    padding: 2px 10px;
    border-radius: 20px;
    cursor: pointer;
    user-select: none;
    line-height: 18px;
    letter-spacing: 0.02em;
  `;
    pill.innerHTML = `Retracted`;
    const contentRow = document.createElement("div");
    contentRow.style.cssText = `display: flex; align-items: center;`;
    const doiText = document.createElement("span");
    doiText.textContent = info.doi;
    doiText.style.cssText = `color: #1f2328; margin-right: 8px; font-size: 12px;`;
    contentRow.appendChild(doiText);
    wrapper.appendChild(pill);
    target.appendChild(wrapper);
}
