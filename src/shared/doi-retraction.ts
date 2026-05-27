import {RET_MAP_KEY} from "@shared/data-extract"
import {normaliseDOI} from "@shared/doi-normalise";
import {extractDoiFromHref} from "@shared/doi-extractor";
import retractionData from '../retractions.json';
import {DoiString} from "@shared/types";
import { debugLog } from "./debug";

export const FLORA_RET_CHECK_KEY = "flora-ret-checked";

// Alarm-bell artwork for the "Retracted" pill — a red ringing bell with a dark
// base and a white "!" clapper. viewBox is cropped to the bell's bounds.
const RETRACTED_BELL_ICON = `<g>
  <g><g>
    <path fill="#D82E3D" d="M191.422,124.122L191.422,124.122c1.898-0.509,3.849,0.618,4.358,2.516l5.432,20.274c0.509,1.898-0.618,3.849-2.516,4.358h0c-1.898,0.509-3.849-0.618-4.358-2.516l-5.432-20.274C188.397,126.582,189.524,124.631,191.422,124.122z"/>
    <path fill="#D82E3D" d="M150.523,165.021L150.523,165.021c0.509-1.898,2.46-3.025,4.358-2.516l20.274,5.432c1.898,0.509,3.025,2.46,2.516,4.358l0,0c-0.509,1.898-2.46,3.025-4.358,2.516l-20.274-5.432C151.141,168.87,150.014,166.919,150.523,165.021z"/>
  </g>
    <path fill="#D82E3D" d="M183.013,156.536l-0.076,0.076c-1.369,1.369-3.588,1.369-4.956,0l-14.917-14.917c-1.369-1.369-1.369-3.588,0-4.956l0.076-0.076c1.369-1.369,3.588-1.369,4.956,0l14.917,14.917C184.382,152.949,184.382,155.168,183.013,156.536z"/>
  </g>
  <g><g>
    <path fill="#D82E3D" d="M308.58,124.122L308.58,124.122c-1.898-0.509-3.849,0.618-4.358,2.516l-5.432,20.274c-0.509,1.898,0.618,3.849,2.516,4.358l0,0c1.898,0.509,3.849-0.618,4.358-2.516l5.432-20.274C311.604,126.582,310.478,124.631,308.58,124.122z"/>
    <path fill="#D82E3D" d="M349.479,165.021L349.479,165.021c-0.509-1.898-2.46-3.025-4.358-2.516l-20.274,5.432c-1.898,0.509-3.025,2.46-2.516,4.358l0,0c0.509,1.898,2.46,3.025,4.358,2.516l20.274-5.432C348.861,168.87,349.987,166.919,349.479,165.021z"/>
  </g>
    <path fill="#D82E3D" d="M316.988,156.536l0.076,0.076c1.369,1.369,3.588,1.369,4.956,0l14.917-14.917c1.369-1.369,1.369-3.588,0-4.956l-0.076-0.076c-1.369-1.369-3.588-1.369-4.956,0l-14.917,14.917C315.62,152.949,315.62,155.168,316.988,156.536z"/>
  </g>
  <path fill="#454545" d="M344.085,376h-188.16c-4.788,0-8.133-4.74-6.547-9.242l13.982-39.553c0.983-2.774,3.614-4.629,6.547-4.629h160.195c2.933,0,5.549,1.855,6.531,4.629l13.982,39.553C352.217,371.26,348.872,376,344.085,376z"/>
  <path fill="#C32430" d="M318.514,322.575H181.48l12.587-135.798c1.094-11.731,10.939-20.704,22.733-20.704h66.409c11.779,0,21.624,8.973,22.717,20.704L318.514,322.575z"/>
  <g>
    <path fill="#F6F6F6" d="M251.749,263.366h-3.497c-1.994,0-3.668-1.5-3.886-3.482l-5.301-48.234c-0.254-2.314,1.558-4.337,3.886-4.337h14.099c2.328,0,4.141,2.022,3.886,4.337l-5.301,48.234C255.417,261.865,253.743,263.366,251.749,263.366z"/>
    <circle fill="#F6F6F6" cx="250.001" cy="276.613" r="4.714"/>
  </g>
  <path fill="#FFFFFF" opacity="0.05" d="M294.1,247.717c0,27.378-6.531,52.997-17.866,74.858c-11.668,22.511-28.44,41.044-48.463,53.425h-71.846c-4.788,0-8.133-4.74-6.547-9.242l13.982-39.553c0.983-2.774,3.614-4.629,6.547-4.629h11.573l12.587-135.798c1.094-11.731,10.939-20.704,22.733-20.704h55.692C286.126,189.346,294.1,217.453,294.1,247.717z"/>
</g>`;

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
    const rawSource = (Object.keys(retMap).length > 0) ? retMap : retractionData;
    // Extracted DOIs are lowercased by normaliseDOI, but the Retraction Watch
    // data preserves Crossref's mixed case (SICI-style Elsevier IDs, NEJM,
    // etc.) — lowercase the lookup keys so case-mixed entries still match.
    const source: Record<string, string> = {};
    for (const k in rawSource) source[k.toLowerCase()] = rawSource[k];
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

// Retracted DOIs that already have a pill on the page — the "Retracted" pill
// is shown only at a DOI's first occurrence, not stamped on every mention.
const pilledRetractionDois = new Set<string>();

/** Clear per-DOI retraction-pill tracking — call on SPA navigation. */
export function resetRetractionPills(): void {
    pilledRetractionDois.clear();
}

export function injectRetractionInfo(target: Element, info: RetractionResponse): void {
    // Idempotent per anchor (re-runs from DOM mutations must not stack pills)
    // and shown once per DOI — the first occurrence wins, later mentions of
    // the same retracted DOI are skipped.
    if (target.getAttribute(FLORA_RET_CHECK_KEY) === '1') return;
    if (pilledRetractionDois.has(info.originDoi)) return;
    pilledRetractionDois.add(info.originDoi);
    target.setAttribute(FLORA_RET_CHECK_KEY, '1');

    const wrapper = document.createElement("div");
    // Class lets other code (and test-fixture tooling) identify FLoRA-injected
    // UI, mirroring `flora-doi-label` on the DOI pill.
    wrapper.className = "flora-retracted-pill";
    wrapper.style.cssText = `position: relative; display: inline-block; vertical-align: middle;`;

    const W = 106, H = 22, iconSize = 16;
    const tmp = document.createElement("div");
    tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="cursor:pointer;margin-left:8px;vertical-align:middle;display:inline-block;">
      <a href="https://doi.org/${info.doi}" target="_blank" rel="noopener" style="text-decoration:none;">
        <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${(H - 1) / 2}" fill="#FFF5F6" stroke="#D82E3D" stroke-width="1"/>
        <text x="12" y="15" fill="#C32430" font-size="12" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" letter-spacing="0.02em">Retracted</text>
        <svg x="${W - 8 - iconSize}" y="${(H - iconSize) / 2}" width="${iconSize}" height="${iconSize}" viewBox="115 112 270 270">
          ${RETRACTED_BELL_ICON}
        </svg>
      </a>
    </svg>`;
    const pill = tmp.firstElementChild as SVGElement;

    wrapper.appendChild(pill);
    placeRetractionPill(target, info.originDoi, wrapper);
}

/**
 * Place the "Retracted" pill inline, mirroring the DOI pill's placement.
 *
 * - Anchor target: insert right after it. The wrapper carries its own
 *   <a href="…retraction notice">, so nesting it inside another <a> would
 *   create invalid nested anchors that browsers split.
 * - Block target (a reference entry): insert right after the link that
 *   carries this DOI so the pill sits inline with the citation; fall back to
 *   the entry's last link, then to appending at the entry end.
 */
function placeRetractionPill(target: Element, doi: DoiString, pill: HTMLElement): void {
    if (target.tagName === "A" && target.parentElement) {
        target.insertAdjacentElement("afterend", pill);
        return;
    }
    const links = target.querySelectorAll<HTMLAnchorElement>("a[href]");
    for (const link of links) {
        if (extractDoiFromHref(link.href) === doi) {
            link.insertAdjacentElement("afterend", pill);
            return;
        }
    }
    const lastLink = links[links.length - 1];
    if (lastLink) {
        lastLink.insertAdjacentElement("afterend", pill);
    } else {
        target.appendChild(pill);
    }
}

