import { normaliseDOI } from "../shared/doi-normalise";
import { augmentDOIs } from "../shared/doi-augment";
import type { DoiString } from "../shared/types";
import type { LookupRequest, LookupResponse } from "../shared/messages";
import { renderScholarBadge } from "./badge";

const RESULT_CONTAINER = "#gs_res_ccl";
const RESULT_ROW = ".gs_r.gs_or.gs_scl";
const PROCESSED_ATTR = "data-flora-processed";

export function observeScholarResults(): void {
  const container = document.querySelector(RESULT_CONTAINER);
  if (!container) return;

  const observer = new MutationObserver((mutations) => {
    let hasNewRows = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node instanceof HTMLElement &&
          (node.matches(RESULT_ROW) || node.querySelector(RESULT_ROW))
        ) {
          hasNewRows = true;
          break;
        }
      }
      if (hasNewRows) break;
    }

    if (hasNewRows) {
      processScholarResults(document);
    }
  });

  observer.observe(container, { childList: true, subtree: true });
}

export async function processScholarResults(doc: Document): Promise<void> {
  const rows = doc.querySelectorAll<HTMLElement>(
    `${RESULT_ROW}:not([${PROCESSED_ATTR}])`
  );
  if (rows.length === 0) {
    console.log("[FLoRA] No unprocessed Scholar rows found");
    return;
  }

  console.log(`[FLoRA] Processing ${rows.length} Scholar rows`);

  const rowDois: { row: HTMLElement; doi: DoiString }[] = [];
  const rowsWithoutDoi: { row: HTMLElement; title: string }[] = [];

  for (const row of rows) {
    row.setAttribute(PROCESSED_ATTR, "true");
    const doi = extractDoiFromScholarRow(row);
    if (doi) {
      rowDois.push({ row, doi });
      injectDoiLabel(row, doi, "#1565c0");
    } else {
      // No DOI found directly — extract title for augmentation
      const titleEl = row.querySelector(".gs_rt");
      const title = titleEl?.textContent?.trim();
      if (title) {
        rowsWithoutDoi.push({ row, title });
      }
    }
  }

  // Augment missing DOIs via OpenAlex
  if (rowsWithoutDoi.length > 0) {
    try {
      const titles = rowsWithoutDoi.map((r) => r.title);
      const augmented = await augmentDOIs(titles);

      for (const { row, title } of rowsWithoutDoi) {
        const doi = augmented.get(title);
        if (doi) {
          rowDois.push({ row, doi });
          injectDoiLabel(row, doi, "#1565c0");
        }
      }
    } catch {
      // Augmentation failed — continue with what we have
    }
  }

  console.log(`[FLoRA] DOIs found: ${rowDois.length}, titles without DOI: ${rowsWithoutDoi.length}`);

  if (rowDois.length === 0) return;

  const uniqueDois = [...new Set(rowDois.map((rd) => rd.doi))];
  console.log("[FLoRA] Looking up DOIs:", uniqueDois);
  const request: LookupRequest = { type: "FLORA_LOOKUP", dois: uniqueDois };

  try {
    const response: LookupResponse =
      await chrome.runtime.sendMessage(request);

    console.log("[FLoRA] Lookup response:", response);

    for (const { row, doi } of rowDois) {
      if (response.results[doi]) {
        renderScholarBadge(row, {
          status: "matched",
          result: response.results[doi],
        });
      }
    }
  } catch (err) {
    console.error("[FLoRA] Lookup failed:", err);
  }
}

const DOI_LABEL_CLASS = "flora-doi-label";

function injectDoiLabel(row: HTMLElement, doi: string, color: string): void {
  const target = row.querySelector(".gs_ggs") ?? row.querySelector(".gs_ri") ?? row;

  const wrapper = document.createElement("div");
  wrapper.className = DOI_LABEL_CLASS;
  wrapper.style.cssText = `position: relative; display: inline-block; margin-top: 4px;`;

  const pill = document.createElement("span");
  pill.textContent = "DOI";
  pill.style.cssText = `
    display: inline-block;
    font-size: 12px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: white;
    background: ${color};
    padding: 2px 10px;
    border-radius: 20px;
    cursor: pointer;
    user-select: none;
    line-height: 18px;
    letter-spacing: 0.02em;
  `;

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
      copyBtn.style.color = "#1a7f37";
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
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
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
    hideTimeout = setTimeout(() => { popover.style.display = "none"; }, 200);
  };

  pill.addEventListener("mouseenter", show);
  pill.addEventListener("mouseleave", hide);
  popover.addEventListener("mouseenter", show);
  popover.addEventListener("mouseleave", hide);

  wrapper.appendChild(pill);
  wrapper.appendChild(popover);
  target.appendChild(wrapper);
}

function extractDoiFromScholarRow(row: HTMLElement): DoiString | null {
  // 1. Title link href
  const titleLink = row.querySelector<HTMLAnchorElement>(".gs_rt a");
  if (titleLink?.href) {
    const doi = normaliseDOI(titleLink.href);
    if (doi) return doi;
  }

  // 2. Author/source line text
  const authorLine = row.querySelector(".gs_a");
  if (authorLine?.textContent) {
    const match = authorLine.textContent.match(
      /\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/
    );
    if (match) {
      const doi = normaliseDOI(match[1]);
      if (doi) return doi;
    }
  }

  // 3. Any link containing doi.org
  const links = row.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const link of links) {
    if (link.href.includes("doi.org/")) {
      const doi = normaliseDOI(link.href);
      if (doi) return doi;
    }
  }

  return null;
}
