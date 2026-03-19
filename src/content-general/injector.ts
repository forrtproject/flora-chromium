import type { DoiString, LookupState, ReplicationResult } from "../shared/types";
import { normaliseDOI } from "../shared/doi-normalise";
import styles from "./styles.css";

const BANNER_HOST_ID = "flora-banner-host";
const BADGE_CLASS = "flora-inline-badge";

// ──────────────────────────────────────────────
// Banner – inline styles (no shadow DOM)
// ──────────────────────────────────────────────

const isSheets = location.href.includes("docs.google.com/spreadsheets");

const BANNER_BASE_STYLE =
  "position:fixed;top:0;left:0;width:100%;margin:0;opacity:1;" +
  "z-index:2147483647;display:flex;align-items:center;gap:12px;" +
  "padding:5px 8px;font-size:13px;line-height:1.4;box-sizing:border-box;" +
  "color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

const LOGO_STYLE =
  "font-weight:700;font-size:15px;color:#fff;" +
  "background:rgba(255,255,255,0.15);padding:2px 8px;border-radius:4px;flex-shrink:0;";

const TEXT_STYLE = "flex:1;";

const LINK_STYLE =
  "color:#fff;text-decoration:underline;text-underline-offset:2px;white-space:nowrap;";

const CLOSE_STYLE =
  "all:unset;cursor:pointer;font-size:13px;line-height:1;" +
  "padding-right:10px;user-select:none;align-self:center;color:rgba(255,255,255,0.8);";

const BG = {
  loading: "background:#6b7280;",
  success: "background:#16a34a;",
  warning: "background:#ea580c;",
  error: "background:#dc2626;",
} as const;

export function renderLoadingBanner(): void {
  const host = ensureBannerHost();
  host.innerHTML = `
    <div style="${BANNER_BASE_STYLE}${BG.loading}">
      <span style="${LOGO_STYLE}">FLoRA</span>
      <span style="${TEXT_STYLE}">Checking replication data\u2026</span>
    </div>`;
  requestAnimationFrame(() => adjustPageForBanner());
}

export function renderErrorBanner(message: string): void {
  const host = ensureBannerHost();
  host.innerHTML = `
    <div style="${BANNER_BASE_STYLE}${BG.error}">
      <span style="${LOGO_STYLE}">FLoRA</span>
      <span style="${TEXT_STYLE}">Error: ${escapeHtml(message)}</span>
      <button style="${CLOSE_STYLE}" aria-label="Close">\u00d7</button>
    </div>`;
  host.querySelector("button")?.addEventListener("click", () => removeBanner());
  requestAnimationFrame(() => adjustPageForBanner());
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

  if (totalRepl === 0 && totalRepro === 0) {
    removeBanner();
    return;
  }

  const host = ensureBannerHost();

  const replLabel = totalRepl === 1 ? "replication" : "replications";
  const reproLabel = totalRepro === 1 ? "reproduction" : "reproductions";

  const parts: string[] = [];
  if (totalRepl > 0) parts.push(`${totalRepl} ${replLabel}`);
  if (totalRepro > 0) parts.push(`${totalRepro} ${reproLabel}`);
  const countsText = parts.join(", ");

  const doiCount = matched.length;
  const summary = doiCount === 1
    ? countsText
    : `Replication/reproduction data found for ${doiCount} DOIs (${countsText})`;

  const doisParam = matched.map((m) => m.doi).join(",");

  host.innerHTML = `
    <div style="${BANNER_BASE_STYLE}${BG.success}">
      <span style="${LOGO_STYLE}">FLoRA</span>
      <span style="${TEXT_STYLE}">${summary}</span>
      <a style="${LINK_STYLE}" href="https://forrt.org/fred_repl_landing_page/?doi=${encodeURIComponent(doisParam)}" target="_blank" rel="noopener">View details</a>
      <button style="${CLOSE_STYLE}" aria-label="Close">\u00d7</button>
    </div>`;
  host.querySelector("button")?.addEventListener("click", () => removeBanner());
  requestAnimationFrame(() => adjustPageForBanner());
}

function ensureBannerHost(): HTMLElement {
  let host = document.getElementById(BANNER_HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = BANNER_HOST_ID;
    document.body.prepend(host);
  }
  return host;
}

// Track elements we've modified so we can restore them on removal
const modifiedElements = new Set<HTMLElement>();

export function removeBanner(): void {
  const host = document.getElementById(BANNER_HOST_ID);
  if (host) {
    host.remove();
    document.body.style.removeProperty("padding-top");
    for (const el of modifiedElements) {
      el.style.removeProperty("padding-top");
      el.style.removeProperty("top");
    }
    modifiedElements.clear();
  }
}

function adjustPageForBanner(): void {
  const banner = document.getElementById(BANNER_HOST_ID);
  if (!banner) return;
  const inner = banner.firstElementChild as HTMLElement | null;
  const bannerHeight = inner?.offsetHeight || 35;

  // Make space for the banner at the top of the body
  document.body.style.setProperty("padding-top", `${bannerHeight}px`, "important");

  // Gather fixed elements and push them down
  const fixedElements = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
    (el) => el !== banner && el !== inner && window.getComputedStyle(el).position === "fixed"
  );
  for (const el of fixedElements) {
    if (isSheets) {
      // Only shift top-anchored elements; skip bottom-anchored ones (sheet tabs bar)
      const cs = window.getComputedStyle(el);
      const hasBottom = cs.bottom !== "auto" && parseInt(cs.bottom) >= 0;
      if (hasBottom && parseInt(cs.bottom) < 50) continue;
      const currentTop = parseInt(cs.top) || 0;
      el.style.setProperty("top", `${currentTop + bannerHeight}px`, "important");
    } else {
      el.style.setProperty("padding-top", `${bannerHeight}px`, "important");
    }
    modifiedElements.add(el);
  }

  // Gather sticky elements and conditionally push them down
  const stickyElements = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
    (el) => el !== banner && el !== inner && window.getComputedStyle(el).position === "sticky"
  );
  for (const el of stickyElements) {
    const position = el.getBoundingClientRect().top;
    const threshold = parseInt(window.getComputedStyle(el).top);
    if (position < bannerHeight || position <= threshold) {
      el.style.setProperty("padding-top", `${bannerHeight}px`, "important");
    } else {
      el.style.setProperty("padding-top", "0px", "important");
    }
    modifiedElements.add(el);
  }
}

// ──────────────────────────────────────────────
// Inline badges (still use shadow DOM for isolation)
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

    const hasData = stats.n_replications_total > 0 || stats.n_reproductions_total > 0;
    if (!hasData) continue;

    const replLabel = stats.n_replications_total === 1 ? "replication" : "replications";
    const reproLabel = stats.n_reproductions_total === 1 ? "reproduction" : "reproductions";

    const badgeHost = document.createElement("span");
    badgeHost.className = BADGE_CLASS;
    const shadow = badgeHost.attachShadow({ mode: "open" });

    const styleEl = document.createElement("style");
    styleEl.textContent = styles;
    shadow.appendChild(styleEl);

    const badge = document.createElement("a");
    badge.className = "flora-badge badge--success";
    badge.href = `https://forrt.org/fred_repl_landing_page/?doi=${encodeURIComponent(r.doi)}`;
    badge.target = "_blank";
    badge.rel = "noopener";
    badge.innerHTML = `
      <span class="badge-label">FLoRA</span>
      ${stats.n_replications_total > 0 ? `<span class="badge-count">${stats.n_replications_total} ${replLabel}</span>` : ""}
      ${stats.n_reproductions_total > 0 ? `<span class="badge-count">${stats.n_reproductions_total} ${reproLabel}</span>` : ""}
    `;
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

// ──────────────────────────────────────────────
// Google Sheets modal
// ──────────────────────────────────────────────

const SHEETS_MODAL_ID = "flora-sheets-modal";

export function renderSheetsModal(
  matched: { doi: string; result: ReplicationResult }[]
): void {
  if (matched.length === 0) {
    removeSheetsModal();
    return;
  }

  const totalRepl = matched.reduce(
    (sum, m) => sum + m.result.record.stats.n_replications_total, 0
  );
  const totalRepro = matched.reduce(
    (sum, m) => sum + m.result.record.stats.n_reproductions_total, 0
  );

  if (totalRepl === 0 && totalRepro === 0) {
    removeSheetsModal();
    return;
  }

  // Remove existing modal before re-rendering
  removeSheetsModal();

  const doiCount = matched.length;
  const doisParam = matched.map((m) => m.doi).join(",");

  const host = document.createElement("div");
  host.id = SHEETS_MODAL_ID;
  host.innerHTML = `
    <div role="dialog" aria-labelledby="flora-modal-title" style="
      position:fixed;top:60px;right:24px;z-index:2147483647;
      width:360px;background:#fff;border-radius:12px;
      box-shadow:0 8px 28px rgba(0,0,0,0.18),0 2px 8px rgba(0,0,0,0.08);
      font-family:'Google Sans',Roboto,-apple-system,sans-serif;
      overflow:hidden;animation:floraSlideIn 0.25s ease-out;
    ">
      <!-- Green accent header -->
      <div style="background:linear-gradient(135deg,#16a34a,#15803d);padding:14px 16px;display:flex;align-items:center;gap:10px;">
        <span style="
          background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:13px;
          padding:4px 10px;border-radius:6px;letter-spacing:0.3px;
        ">FLoRA</span>
        <span id="flora-modal-title" style="color:#fff;font-size:13px;font-weight:500;flex:1;">
          Replication Data Found
        </span>
        <span class="flora-modal-close" role="button" tabindex="0" aria-label="Close" style="
          cursor:pointer;color:rgba(255,255,255,0.7);font-size:20px;line-height:1;
          width:28px;height:28px;display:flex;align-items:center;justify-content:center;
          border-radius:50%;transition:background 0.15s;
        ">\u00d7</span>
      </div>

      <!-- Body -->
      <div style="padding:16px;">
        <div style="font-size:13px;color:#3c4043;margin-bottom:14px;line-height:1.5;">
          Found replication &amp; reproduction data for <strong style="color:#202124;">${doiCount} DOI${doiCount !== 1 ? "s" : ""}</strong> in this spreadsheet.
        </div>

        <!-- Stat cards -->
        <div style="display:flex;gap:10px;margin-bottom:4px;">
          <div style="
            flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
            padding:12px;text-align:center;
          ">
            <div style="font-size:22px;font-weight:600;color:#16a34a;line-height:1;">${totalRepl}</div>
            <div style="font-size:11px;color:#15803d;margin-top:4px;font-weight:500;">Replication${totalRepl !== 1 ? "s" : ""}</div>
          </div>
          <div style="
            flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
            padding:12px;text-align:center;
          ">
            <div style="font-size:22px;font-weight:600;color:#16a34a;line-height:1;">${totalRepro}</div>
            <div style="font-size:11px;color:#15803d;margin-top:4px;font-weight:500;">Reproduction${totalRepro !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:10px 16px 14px;display:flex;justify-content:flex-end;gap:8px;">
        <button class="flora-modal-dismiss" style="
          all:unset;cursor:pointer;padding:7px 18px;font-size:13px;font-weight:500;
          color:#5f6368;border-radius:6px;transition:background 0.15s;
        ">Dismiss</button>
        <a href="https://forrt.org/fred_repl_landing_page/?doi=${encodeURIComponent(doisParam)}" target="_blank" rel="noopener" style="
          all:unset;cursor:pointer;padding:7px 18px;font-size:13px;font-weight:500;
          color:#fff;background:linear-gradient(135deg,#16a34a,#15803d);border-radius:6px;text-align:center;
        ">View details</a>
      </div>
    </div>

    <style>
      @keyframes floraSlideIn {
        from { opacity:0; transform:translateY(-8px); }
        to { opacity:1; transform:translateY(0); }
      }
    </style>`;

  document.body.appendChild(host);

  // Wire up close / dismiss buttons
  for (const el of host.querySelectorAll(".flora-modal-close, .flora-modal-dismiss")) {
    el.addEventListener("click", () => removeSheetsModal());
  }
}

export function removeSheetsModal(): void {
  document.getElementById(SHEETS_MODAL_ID)?.remove();
}
