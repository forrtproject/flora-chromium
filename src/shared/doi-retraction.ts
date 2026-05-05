import {RetractionLookupResponse} from "@shared/messages";

const containerObservers = new WeakMap<HTMLElement, MutationObserver>();
export const FLORA_RET_CHECK_KEY = "flora-ret-checked";
export const badgeQuerySelector = "[" + FLORA_RET_CHECK_KEY + "]";

/**
 * Request retraction status. Due to CORS policies, the request
 * must execute in the background context.
 * @param doi
 */
export async function retractionCheck(doi: string): Promise<RetractionLookupResponse | void> {
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
    const color = "#FF1744";
    const badgeSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="20" viewBox="0 0 80 20">
      <rect width="80" height="20" rx="10" fill="${color}"/>
      <text x="40" y="14" fill="#fff" font-family="Verdana" font-weight="normal" 
       font-size="11" text-anchor="middle">Retracted</text>
    </svg>`.trim();
    const img = document.createElement('img');
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg)}`;
    img.style.verticalAlign = 'middle';
    img.style.display = 'block';
    const link = document.createElement("a");
    link.href = `https://doi.org/${info.doi}`;
    link.target = "_blank";
    link.style.display = 'inline-block';
    link.style.verticalAlign = 'bottom';
    link.style.marginLeft = "4px";
    link.style.marginTop = "4px";
    link.appendChild(img);
    target.setAttribute(FLORA_RET_CHECK_KEY, '1');
    target.appendChild(link);
}

