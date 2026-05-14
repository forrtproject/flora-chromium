import {RET_MAP_KEY} from "@shared/data-extract"
import {normaliseDOI} from "@shared/doi-normalise";
import retractionData from '../retractions.json';
import {DoiString} from "@shared/types";
import { debugLog } from "./debug";

export const FLORA_RET_CHECK_KEY = "flora-ret-checked";

export interface RetractionResponse {
    originDoi: DoiString;
    doi: string;
}

/**
 * Request retraction status. Due to CORS policies, the request
 * must execute in the background context.
 */
// @ts-ignore
export async function retractionCheck(dois: DoiString[]): Promise<RetractionResponse[]> {
    const storageResult = await chrome.storage.local.get([RET_MAP_KEY]) || {};
    const retMap = storageResult[RET_MAP_KEY] || {};
    if (!storageResult[RET_MAP_KEY])
        chrome.runtime.sendMessage({type: "FLORA_RET_SYNC"}).then().catch();
    const source = (Object.keys(retMap).length > 0) ? retMap : retractionData;
    let result = []
    for (const doi of dois) {
        const retractionDOI = source[doi];
        if (retractionDOI) result.push({
            originDoi: doi,
            doi: retractionDOI
        });
    }
    debugLog("Retraction check for DOIs", dois, "result", result);
    return result;
}

export function injectRetractionInfo(target: Element, info: RetractionResponse): void {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `position: relative; display: inline-block; margin-top: 4px;`;

    const W = 103, H = 22, iconSize = 13;
    const tmp = document.createElement("div");
    tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="cursor:pointer;margin-left:8px;vertical-align:middle;display:inline-block;">
      <a href="https://doi.org/${info.doi}" target="_blank" rel="noopener" style="text-decoration:none;">
        <rect width="${W}" height="${H}" rx="11" fill="#FF1744"/>
        <text x="10" y="15" fill="white" font-size="12" font-weight="500" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" letter-spacing="0.02em">Retracted</text>
        <svg x="${W - 10 - iconSize}" y="${(H - iconSize) / 2}" width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="white">
          <rect x="3" y="19" width="18" height="3" rx="1.5"/>
          <path d="M6 19 L9.5 10 Q11 7 12 7 Q13 7 14.5 10 L18 19 Z"/>
          <rect x="11" y="2" width="2" height="4" rx="1"/>
          <rect x="3" y="5" width="2" height="4" rx="1" transform="rotate(-40 4 7)"/>
          <rect x="19" y="5" width="2" height="4" rx="1" transform="rotate(40 20 7)"/>
        </svg>
      </a>
    </svg>`;
    const pill = tmp.firstElementChild as SVGElement;

    wrapper.appendChild(pill);
    target.setAttribute(FLORA_RET_CHECK_KEY, '1');
    target.appendChild(wrapper);
}

