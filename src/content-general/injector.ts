import type { DoiString, LookupState, ReplicationResult } from "../shared/types";
import { normaliseDOI } from "../shared/doi-normalise";
import styles from "./styles.css";

const BANNER_HOST_ID = "flora-banner-host";
const BADGE_CLASS = "flora-inline-badge";

// Store shadow root reference since we use open mode
let bannerShadow: ShadowRoot | null = null;

// ──────────────────────────────────────────────
// Banner
// ──────────────────────────────────────────────

export function renderLoadingBanner(): void {
  ensureBannerHost();
  const shadow = bannerShadow!;
  const container = shadow.querySelector(".flora-banner")!;
  container.innerHTML = `
    <div class="flora-banner-inner flora-banner--loading">
      <span class="flora-logo">FLoRA</span>
      <span class="flora-banner-text">Checking replication data\u2026</span>
    </div>`;
}

export function renderErrorBanner(message: string): void {
  ensureBannerHost();
  const shadow = bannerShadow!;
  const container = shadow.querySelector(".flora-banner")!;
  container.innerHTML = `
    <div class="flora-banner-inner flora-banner--error">
      <span class="flora-logo">FLoRA</span>
      <span class="flora-banner-text">Error: ${escapeHtml(message)}</span>
      <button class="flora-banner-close" aria-label="Close">\u00d7</button>
    </div>`;
  shadow
    .querySelector(".flora-banner-close")
    ?.addEventListener("click", () => removeBanner());
}

export function renderMatchedBanner(
  matched: { doi: string; result: ReplicationResult }[]
): void {
  if (matched.length === 0) {
    removeBanner();
    return;
  }

  const totalRepl = matched.reduce(
    (sum, m) => sum + m.result.record.stats.n_replications_total, 0
  );
  const totalRepro = matched.reduce(
    (sum, m) => sum + m.result.record.stats.n_reproductions_total, 0
  );
  const totalOrig = matched.reduce(
    (sum, m) => sum + m.result.record.stats.n_originals_total, 0
  );

  if (totalRepl === 0 && totalRepro === 0 && totalOrig === 0) {
    removeBanner();
    return;
  }

  ensureBannerHost();
  const shadow = bannerShadow!;
  const container = shadow.querySelector(".flora-banner")!;

  const cls = totalRepl > 0 || totalRepro > 0 ? "flora-banner--success" : "flora-banner--info";

  const replLabel = totalRepl === 1 ? "replication" : "replications";
  const reproLabel = totalRepro === 1 ? "reproduction" : "reproductions";
  const origLabel = totalOrig === 1 ? "original" : "originals";

  const parts: string[] = [];
  if (totalRepl > 0) parts.push(`${totalRepl} ${replLabel}`);
  if (totalRepro > 0) parts.push(`${totalRepro} ${reproLabel}`);
  if (totalOrig > 0) parts.push(`${totalOrig} ${origLabel}`);
  const countsText = parts.join(", ");

  const doiCount = matched.length;
  const summary = doiCount === 1
    ? countsText
    : `Replication/reproduction data found for ${doiCount} DOIs (${countsText})`;

  const doisParam = matched.map((m) => m.doi).join(",");
  const viewLink = `<a class="flora-banner-link" href="https://forrt.org/fred_repl_landing_page/?doi=${encodeURIComponent(doisParam)}" target="_blank" rel="noopener">View details</a>`;

  container.innerHTML = `
    <div class="flora-banner-inner ${cls}">
      <span class="flora-logo">FLoRA</span>
      <span class="flora-banner-text">${summary}</span>
      ${viewLink}
      <button class="flora-banner-close" aria-label="Close">\u00d7</button>
    </div>`;
  shadow
    .querySelector(".flora-banner-close")
    ?.addEventListener("click", () => removeBanner());
}

function ensureBannerHost(): void {
  let host = document.getElementById(BANNER_HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = BANNER_HOST_ID;
    bannerShadow = host.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = styles;
    bannerShadow.appendChild(styleEl);

    const container = document.createElement("div");
    container.className = "flora-banner";
    bannerShadow.appendChild(container);

    document.body.prepend(host);
    adjustPageForBanner();
  }
}

export function removeBanner(): void {
  const host = document.getElementById(BANNER_HOST_ID);
  if (host) {
    host.remove();
    bannerShadow = null;
    restorePageAfterBanner();
  }
}

const BANNER_HEIGHT = 40;

function adjustPageForBanner(): void {
  document.body.style.setProperty(
    "margin-top",
    `${BANNER_HEIGHT}px`,
    "important"
  );
}

function restorePageAfterBanner(): void {
  document.body.style.removeProperty("margin-top");
}

// ──────────────────────────────────────────────
// Inline badges
// ──────────────────────────────────────────────

export function renderInlineBadges(
  pageState: Map<DoiString, LookupState>
): void {
  const allLinks = document.querySelectorAll<HTMLAnchorElement>("a[href]");

  for (const link of allLinks) {
    if (link.nextElementSibling?.classList.contains(BADGE_CLASS)) continue;

    // Only badge links whose visible text contains a DOI, or that point to doi.org
    const textMatch = link.textContent?.match(/\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/);
    const isDoiOrgLink = /^https?:\/\/(dx\.)?doi\.org\//i.test(link.href);
    const hrefMatch = isDoiOrgLink
      ? link.href.match(/\b(10\.\d{4,}(?:\.\d+)*\/\S+)\b/)
      : null;
    const rawDoi = textMatch?.[1] ?? hrefMatch?.[1];
    if (!rawDoi) continue;

    const doi = normaliseDOI(rawDoi);
    if (!doi) continue;

    const state = pageState.get(doi);
    if (!state || state.status !== "matched") continue;

    if (!isVisible(link)) continue;

    const r = state.result;
    const stats = r.record.stats;

    const hasData = stats.n_replications_total > 0
      || stats.n_reproductions_total > 0
      || stats.n_originals_total > 0;
    if (!hasData) continue;

    const badgeClass = stats.n_replications_total > 0 || stats.n_reproductions_total > 0
      ? "badge--success"
      : "badge--neutral";

    const replLabel = stats.n_replications_total === 1 ? "replication" : "replications";
    const reproLabel = stats.n_reproductions_total === 1 ? "reproduction" : "reproductions";
    const origLabel = stats.n_originals_total === 1 ? "original" : "originals";
    const titleParts: string[] = [];
    if (stats.n_replications_total > 0) titleParts.push(`${stats.n_replications_total} ${replLabel}`);
    if (stats.n_reproductions_total > 0) titleParts.push(`${stats.n_reproductions_total} ${reproLabel}`);
    if (stats.n_originals_total > 0) titleParts.push(`${stats.n_originals_total} ${origLabel}`);

    const badgeHost = document.createElement("span");
    badgeHost.className = BADGE_CLASS;
    const shadow = badgeHost.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = styles;
    shadow.appendChild(styleEl);

    const badge = document.createElement("a");
    badge.className = `flora-badge ${badgeClass}`;
    badge.href = `https://forrt.org/fred_repl_landing_page/?doi=${encodeURIComponent(r.doi)}`;
    badge.target = "_blank";
    badge.rel = "noopener";
    badge.title = `FLoRA: ${titleParts.join(", ")}`;
    badge.innerHTML = `<span class="badge-icon">F</span> ${stats.n_replications_total}R`;
    shadow.appendChild(badge);

    link.insertAdjacentElement("afterend", badgeHost);
  }
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[c] ?? c;
  });
}

