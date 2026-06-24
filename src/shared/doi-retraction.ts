import {extractDoiFromHref} from "@shared/doi-extractor";
import {FLORA_NOTICE_PILL_CLASS} from "@shared/doi-label";
import type {DoiString, NoticeKind, RetractionResponse} from "@shared/types";
import type {RetractionCheckResponse} from "@shared/messages";

export const FLORA_RET_CHECK_KEY = "flora-ret-checked";

// Re-exported so existing content imports (injector, references, index, the
// Scholar observer) keep importing notice types from here.
export type {NoticeKind, RetractionResponse} from "@shared/types";

// Warning-triangle artwork for the "Concern" pill and the EoC banner —
// same path as the existing banner triangle, exported once so the pill
// and banner stay visually identical aside from fill colour.
const WARNING_TRIANGLE_ICON =
    `<path d="M320 64C334.7 64 348.2 72.1 355.2 85L571.2 485C577.9 497.4 577.6 512.4 570.4 524.5C563.2 536.6 550.1 544 536 544L104 544C89.9 544 76.8 536.6 69.6 524.5C62.4 512.4 62.1 497.4 68.8 485L284.8 85C291.8 72.1 305.3 64 320 64zM320 416C302.3 416 288 430.3 288 448C288 465.7 302.3 480 320 480C337.7 480 352 465.7 352 448C352 430.3 337.7 416 320 416zM320 224C301.8 224 287.3 239.5 288.6 257.7L296 361.7C296.9 374.2 307.4 384 319.9 384C332.5 384 342.9 374.3 343.8 361.7L351.2 257.7C352.5 239.5 338.1 224 319.8 224z"/>`;

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

export interface NoticePresentation {
    label: string;                  // pill label
    bannerCopy: string;             // banner sentence
    pillWidth: number;              // SVG pill width in px
    pillBackground: string;
    pillStroke: string;
    pillText: string;
    pillIconViewBox: string;        // viewBox attr for the pill's inner SVG
    pillIconColor: string;          // fill colour for the inner SVG paths
    pillIconBody: string;           // SVG inner markup (no <svg> wrapper)
    bannerBackground: string;
    bannerBorder: string;
    bannerLeftAccent: string;
    bannerText: string;
    bannerIconColor: string;        // fill for the banner triangle
}

export function noticePresentation(kind: NoticeKind): NoticePresentation {
    if (kind === "concern") {
        return {
            label: "Concern",
            bannerCopy: "This article has an expression of concern.",
            pillWidth: 92,
            pillBackground: "#fff7ed",
            pillStroke: "#ea580c",
            pillText: "#9a3412",
            pillIconViewBox: "0 0 640 640",
            pillIconColor: "#ea580c",
            pillIconBody: WARNING_TRIANGLE_ICON,
            bannerBackground: "#fff7ed",
            bannerBorder: "#fdba74",
            bannerLeftAccent: "#ea580c",
            bannerText: "#9a3412",
            bannerIconColor: "#ea580c",
        };
    }
    return {
        label: "Retracted",
        bannerCopy: "This article has been retracted.",
        pillWidth: 106,
        pillBackground: "#FFF5F6",
        pillStroke: "#D82E3D",
        pillText: "#C32430",
        pillIconViewBox: "115 112 270 270",
        pillIconColor: "currentColor",   // bell paths already carry their own fills
        pillIconBody: RETRACTED_BELL_ICON,
        bannerBackground: "#fdecef",
        bannerBorder: "#f5a3b4",
        bannerLeftAccent: "#FF1744",
        bannerText: "#a30d2d",
        bannerIconColor: "#FF1744",
    };
}

/**
 * Request retraction status from the background service worker. The worker
 * owns the retraction data (storage, weekly sync, and the bundled fallback)
 * so the multi-megabyte `retractions.json` never ships inside content bundles.
 */
export async function retractionCheck(dois: DoiString[]): Promise<RetractionResponse[]> {
    const response = await chrome.runtime.sendMessage({
        type: "FLORA_RET_CHECK",
        dois,
    }) as RetractionCheckResponse | undefined;

    return response?.type === "FLORA_RET_CHECK_RESULT" ? response.results : [];
}

// Retracted DOIs that already have a pill on the page — the "Retracted" pill
// is shown only at a DOI's first occurrence, not stamped on every mention.
const pilledRetractionDois = new Set<string>();

/** Clear per-DOI retraction-pill tracking — call on SPA navigation. */
export function resetRetractionPills(): void {
    pilledRetractionDois.clear();
}

export interface InjectRetractionOptions {
    /**
     * Skip the link-search smart placement and append the pill directly to
     * `target`. Use when `target` is a dedicated FLoRA pill container (e.g.
     * Scholar's `.gs_ggs` div), so the pill isn't nested inside a sibling
     * sub-list like Scholar's `.gs_or_ggsm` "All versions" menu.
     */
    append?: boolean;
    /**
     * Insert the pill as the next sibling of `target` rather than appending
     * inside it. Use when `target` is a title-like element (Scholar's
     * `.gs_rt`, an article page's `<h1>`) so the pill sits beside the title
     * rather than nested inside its text styles.
     */
    afterend?: boolean;
}

export function injectRetractionInfo(
    target: Element,
    info: RetractionResponse,
    options: InjectRetractionOptions = {},
): void {
    // Idempotent per anchor (re-runs from DOM mutations must not stack pills)
    // and shown once per DOI — the first occurrence wins, later mentions of
    // the same retracted DOI are skipped.
    if (target.getAttribute(FLORA_RET_CHECK_KEY) === '1') return;
    if (pilledRetractionDois.has(info.originDoi)) return;
    pilledRetractionDois.add(info.originDoi);
    target.setAttribute(FLORA_RET_CHECK_KEY, '1');

    const wrapper = document.createElement("span");
    wrapper.className = FLORA_NOTICE_PILL_CLASS;
    wrapper.style.cssText = `position: relative; display: inline-block; vertical-align: middle; margin-left: 6px;`;

    const presentation = noticePresentation(info.kind);
    const W = presentation.pillWidth;
    const H = 22;
    const iconSize = 16;
    const tmp = document.createElement("div");
    tmp.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="cursor:pointer;vertical-align:middle;display:inline-block;">
      <a href="https://doi.org/${info.doi}" target="_blank" rel="noopener" style="text-decoration:none;">
        <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${(H - 1) / 2}" fill="${presentation.pillBackground}" stroke="${presentation.pillStroke}" stroke-width="1"/>
        <text x="12" y="15" fill="${presentation.pillText}" font-size="12" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" letter-spacing="0.02em">${presentation.label}</text>
        <svg x="${W - 8 - iconSize}" y="${(H - iconSize) / 2}" width="${iconSize}" height="${iconSize}" viewBox="${presentation.pillIconViewBox}" fill="${presentation.pillIconColor}">
          ${presentation.pillIconBody}
        </svg>
      </a>
    </svg>`;
    const pill = tmp.firstElementChild as SVGElement;

    wrapper.appendChild(pill);
    if (options.append) {
        target.appendChild(wrapper);
    } else if (options.afterend) {
        target.insertAdjacentElement("afterend", wrapper);
    } else {
        placeRetractionPill(target, info.originDoi, wrapper);
    }
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
    // Only consider visible links. The DOI-pill widget (Scholar rows, etc.)
    // hides its hover popover with display:none, but its <a href=doi.org/...>
    // would otherwise win the match and the notice pill would land inside
    // the popover. offsetParent === null also catches detached/hidden
    // ancestors generally.
    const visibleLinks: HTMLAnchorElement[] = [];
    for (const link of target.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        if (link.offsetParent === null) continue;
        visibleLinks.push(link);
    }
    for (const link of visibleLinks) {
        if (extractDoiFromHref(link.href) === doi) {
            link.insertAdjacentElement("afterend", pill);
            return;
        }
    }
    const lastLink = visibleLinks[visibleLinks.length - 1];
    if (lastLink) {
        lastLink.insertAdjacentElement("afterend", pill);
    } else {
        target.appendChild(pill);
    }
}

