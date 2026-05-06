import {RET_MAP_KEY} from "@shared/data-extract"
import retractionData from '../retractions.json';

export const FLORA_RET_CHECK_KEY = "flora-ret-checked";

export interface RetractionResponse {
    originDoi: string;
    doi: string;
}

/**
 * Request retraction status. Due to CORS policies, the request
 * must execute in the background context.
 * @param dois - DOIs to lookup
 */
export async function retractionCheck(dois: string[]): Promise<RetractionResponse[] | void> {
    console.log('dois', dois)
    chrome.storage.local.get([RET_MAP_KEY], retMap => {
        const source = (retMap && Object.keys(retMap).length > 0) ?
            retMap : retractionData;
        if (!retMap) {
            // TODO: sync storage in background (just call storageSync)
        }
        let result = []
        for (const doi of dois) {
            // @ts-ignore
            const retractionDOI = source[doi];
            if (retractionDOI) result.push({
                originDoi: doi,
                doi: retractionDOI
            });
        }
        return result;
    });
}

export function injectRetractionInfo(target: Element, info: RetractionResponse): void {
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

