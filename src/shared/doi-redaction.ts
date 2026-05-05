import {RetractionLookupResponse} from "@shared/messages";

/**
 * Request retraction status. Due to CORS policies, the request
 * must execute in the background context.
 * @param doi
 * @param callback - result handler
 */
export async function retractionCheck(doi: string): Promise<RetractionLookupResponse|void> {
    try {
        const resp = await chrome.runtime.sendMessage({
            type: "RET_WATCH_FETCH",
            doi
        });
        if (resp && resp.retracted) {
            return resp
        }
    } catch {
    }
}

export function injectRetractionInfo(target: Element, info: RetractionLookupResponse): void {
    // Prefer the right-side PDF area; if absent, create one to match Scholar's layout

    const wrapper = document.createElement("div");
    wrapper.className = "flora-redacted-label";
    wrapper.style.cssText = `position: relative; display: inline-block; margin-top: 4px 2px`;

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
    target.append(wrapper);
}

export function injectRetractedBadge(target: Element, info: RetractionLookupResponse): void {
    const badgeSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="20" viewBox="0 0 80 20">
      <rect width="80" height="20" rx="2" fill="#e05d44"/>
      <text x="40" y="14" fill="#fff" font-family="Verdana" font-weight="bold" 
       font-size="11" text-anchor="middle">Retracted</text>
    </svg>`.trim();
    const img = document.createElement('img');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg)}`;
    img.style.verticalAlign = 'middle';
    img.style.display = 'block';
    const link = document.createElement("a");
    link.href = `https://doi.org/${info.doi}`;
    link.target = "_blank";
    link.style.display = 'block';
    link.style.width = "100%";
    link.style.backgroundColor = "#e05d44";
    link.appendChild(img);
    target.prepend(link);
}