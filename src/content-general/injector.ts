import type { DoiString, LookupState, ReplicationResult, ReplicationEntry, OriginalEntry, DoiContext } from "../shared/types";
import type { PubPeerFeedback } from "../shared/pubpeer-api";
import { extractDoiOccurrences, type DoiOccurrence } from "../shared/doi-extractor";
import { debugLog } from "../shared/debug";
import { getSettings } from "../shared/settings";
import { safeSendMessage } from "../shared/messages";
import styles from "./styles.css";
import {RetractionResponse, noticePresentation} from "@shared/doi-retraction";
import {INDICATOR_PILL_CLASS} from "@shared/indicator-pill";

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
    success: "background:#853953;",
    warning: "background:#ea580c;",
    error: "background:#dc2626;",
} as const;

const REMIND_PILL_STYLE =
    "all:unset;cursor:pointer;font-size:11px;font-family:inherit;font-weight:500;" +
    "color:#5f6368;background:#f0f0f0;padding:3px 10px;border-radius:12px;" +
    "transition:background 0.12s,color 0.12s;";

const SETUP_HOST_ID = "flora-setup-prompt";

const SETUP_REMIND_KEY = "flora_setup_remind_after";

async function isSetupPromptSuppressed(): Promise<boolean> {
    // Dismissed this browser session? (relayed via background service worker)
    try {
        const resp = await chrome.runtime.sendMessage({type: "FLORA_IS_SETUP_DISMISSED"});
        if (resp?.dismissed) return true;
    } catch { /* background unavailable */
    }

    // Snoozed until a future time?
    try {
        const synced = await chrome.storage.sync.get(SETUP_REMIND_KEY);
        const remindAfter = synced[SETUP_REMIND_KEY] as number | undefined;
        if (remindAfter && Date.now() < remindAfter) return true;
    } catch { /* storage unavailable */
    }

    return false;
}

async function dismissSetupForSession(): Promise<void> {
    try {
        await chrome.runtime.sendMessage({type: "FLORA_DISMISS_SETUP"});
    } catch { /* ignore */
    }
}

async function snoozeSetup(ms: number): Promise<void> {
    try {
        await chrome.storage.sync.set({[SETUP_REMIND_KEY]: Date.now() + ms});
    } catch { /* ignore */
    }
}

export async function renderSetupPrompt(): Promise<void> {
    if (document.getElementById(SETUP_HOST_ID)) return;
    if (await isSetupPromptSuppressed()) return;

    const host = document.createElement("div");
    host.id = SETUP_HOST_ID;
    host.innerHTML = `
    <div style="
      position:fixed;bottom:20px;right:20px;z-index:2147483647;
      max-width:320px;background:#fff;border-radius:10px;
      box-shadow:0 4px 20px rgba(0,0,0,0.15),0 1px 4px rgba(0,0,0,0.08);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      overflow:hidden;animation:floraFadeIn 0.3s ease-out;
    ">
      <div style="background:linear-gradient(135deg,#853953,#612D53);padding:10px 14px;display:flex;align-items:center;gap:8px;">
        <span style="color:#fff;font-weight:700;font-size:13px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:5px;">FLoRA</span>
        <span style="color:#fff;font-size:12px;font-weight:500;flex:1;">Setup Required</span>
        <span class="flora-setup-close" role="button" tabindex="0" aria-label="Close" style="
          cursor:pointer;color:rgba(255,255,255,0.7);font-size:18px;line-height:1;
          width:24px;height:24px;display:flex;align-items:center;justify-content:center;
          border-radius:50%;
        ">\u00d7</span>
      </div>
      <div style="padding:12px 14px;">
        <p style="margin:0 0 6px;font-size:13px;color:#3c4043;line-height:1.45;">
          Add your email for faster API access to Crossref &amp; OpenAlex DOI resolution.
        </p>
        <button class="flora-setup-open" style="
          all:unset;cursor:pointer;display:block;width:100%;text-align:center;
          padding:8px 0;font-size:13px;font-weight:600;color:#fff;
          background:linear-gradient(135deg,#853953,#612D53);border-radius:6px;
        ">Open settings</button>
        <div style="margin-top:10px;border-top:1px solid #e8e8e8;padding-top:8px;">
          <div style="font-size:11px;color:#9a9a9a;margin-bottom:5px;">Remind me later</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;" class="flora-remind-options">
            <button data-ms="600000" style="${REMIND_PILL_STYLE}">10 min</button>
            <button data-ms="3600000" style="${REMIND_PILL_STYLE}">1 hour</button>
            <button data-ms="18000000" style="${REMIND_PILL_STYLE}">5 hours</button>
            <button data-ms="86400000" style="${REMIND_PILL_STYLE}">1 day</button>
            <button data-ms="604800000" style="${REMIND_PILL_STYLE}">1 week</button>
          </div>
        </div>
      </div>
    </div>
    <style>
      @keyframes floraFadeIn {
        from { opacity:0; transform:translateY(8px); }
        to { opacity:1; transform:translateY(0); }
      }
    </style>`;

    document.body.appendChild(host);

    host.querySelector(".flora-setup-close")?.addEventListener("click", async () => {
        await dismissSetupForSession();
        host.remove();
    });

    host.querySelector(".flora-setup-open")?.addEventListener("click", () => {
        void safeSendMessage({type: "FLORA_OPEN_OPTIONS"});
        host.remove();
    });

    for (const btn of host.querySelectorAll<HTMLButtonElement>(".flora-remind-options button")) {
        btn.addEventListener("click", async () => {
            const ms = Number(btn.dataset.ms);
            if (!ms) return;
            await snoozeSetup(ms);
            host.remove();
        });
    }
}

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
      <a style="${LINK_STYLE}" href="https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(doisParam)}" target="_blank" rel="noopener">View details</a>
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

    // Gather fixed elements and push them down (skip our own UI elements)
    const setupPrompt = document.getElementById(SETUP_HOST_ID);
    const fixedElements = Array.from(document.querySelectorAll<HTMLElement>("*")).filter(
        (el) =>
            el !== banner &&
            el !== inner &&
            !setupPrompt?.contains(el) &&
            window.getComputedStyle(el).position === "fixed"
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

// Among occurrences of the same DOI, prefer the one with the most accurate
// position for badge placement. Lower number = better.
const OCCURRENCE_RANK: Record<DoiOccurrence["kind"], number> = {
    "link-text": 0,
    "link-doi-org": 1,
    "text": 2,
    "link-embedded": 3,
};

export function renderInlineBadges(
    pageState: Map<DoiString, LookupState>,
    occurrences?: DoiOccurrence[]
): void {
    // Use occurrences captured at extraction time when the caller passes them
    // in (no regex re-scan); otherwise compute them now from the live DOM.
    const occs = occurrences ?? extractDoiOccurrences(document);

    // Pick the best occurrence per DOI for placement. Skip anchors detached
    // from the live DOM (captured before a SPA re-render) so a stale node can't
    // win the ranking and leave the DOI silently un-badged.
    const bestByDoi = new Map<DoiString, DoiOccurrence>();
    for (const occ of occs) {
        if (!occ.anchor.isConnected) continue;
        const cur = bestByDoi.get(occ.doi);
        if (!cur || OCCURRENCE_RANK[occ.kind] < OCCURRENCE_RANK[cur.kind]) {
            bestByDoi.set(occ.doi, occ);
        }
    }

    debugLog("renderInlineBadges:", bestByDoi.size, "DOI(s) located;",
        "pageState has", pageState.size, "DOI(s):",
        [...pageState.entries()].map(([d, s]) => `${d}(${s.status})`));

    // DOIs that already carry a merged indicator pill (title/reference) show
    // their replication count in that pill's badge segment — skip the
    // standalone FLoRA badge for those so the same count isn't shown twice.
    const mergedPilledDois = new Set<DoiString>();
    for (const el of document.querySelectorAll<HTMLElement>(`.${INDICATOR_PILL_CLASS}`)) {
        const d = el.getAttribute("data-flora-doi");
        if (d) mergedPilledDois.add(d as DoiString);
    }

    for (const occ of bestByDoi.values()) {
        if (mergedPilledDois.has(occ.doi)) continue;
        const state = pageState.get(occ.doi);
        if (!state || state.status !== "matched") {
            const status = state?.status ?? "not found";
            // "no-match" is expected — it means FORRT simply has no replication
            // record for this DOI, not that extraction or lookup failed.
            debugLog(
                `renderInlineBadges: no badge for ${occ.doi} —`,
                status === "no-match"
                    ? "FORRT has no replication record for this DOI (expected)"
                    : `status: ${status}`
            );
            continue;
        }

        const r = state.result;
        const stats = r.record.stats;
        const hasData = stats.n_replications_total > 0 || stats.n_reproductions_total > 0;
        if (!hasData) continue;

        if (!isVisible(occ.anchor)) continue;
        if (anchorAlreadyBadged(occ.anchor, occ.doi)) continue;

        const replLabel = stats.n_replications_total === 1 ? "replication" : "replications";
        const reproLabel = stats.n_reproductions_total === 1 ? "reproduction" : "reproductions";

        const badgeHost = document.createElement("span");
        badgeHost.className = BADGE_CLASS;
        badgeHost.setAttribute("data-flora-doi", occ.doi);
        const shadow = badgeHost.attachShadow({mode: "open"});

        const styleEl = document.createElement("style");
        styleEl.textContent = styles;
        shadow.appendChild(styleEl);

        const badge = document.createElement("a");
        badge.className = "flora-badge badge--success";
        badge.href = `https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(r.doi)}`;
        badge.target = "_blank";
        badge.rel = "noopener";
        badge.innerHTML = `
      <span class="badge-label">FLoRA</span>
      ${stats.n_replications_total > 0 ? `<span class="badge-count">${stats.n_replications_total} ${replLabel}</span>` : ""}
      ${stats.n_reproductions_total > 0 ? `<span class="badge-count">${stats.n_reproductions_total} ${reproLabel}</span>` : ""}
    `;
        shadow.appendChild(badge);

        placeBadge(occ.anchor, badgeHost);
        debugLog("renderInlineBadges: badged", occ.doi, "as", occ.kind);
    }
}

function placeBadge(anchor: HTMLElement, badge: HTMLElement): void {
    if (anchor.tagName === "A") {
        let last: Element = anchor;
        while (last.nextElementSibling?.classList.contains(BADGE_CLASS)) {
            last = last.nextElementSibling;
        }
        last.insertAdjacentElement("afterend", badge);
    } else {
        anchor.appendChild(badge);
    }
}

function anchorAlreadyBadged(anchor: HTMLElement, doi: DoiString): boolean {
    if (anchor.tagName === "A") {
        let sib = anchor.nextElementSibling;
        while (sib?.classList.contains(BADGE_CLASS)) {
            if (sib.getAttribute("data-flora-doi") === doi) return true;
            sib = sib.nextElementSibling;
        }
        return false;
    }
    for (const child of anchor.children) {
        if (
            child.classList.contains(BADGE_CLASS) &&
            child.getAttribute("data-flora-doi") === doi
        ) {
            return true;
        }
    }
    return false;
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
// "Working" toast — small bottom-right indicator shown while FLoRA queries.
// ──────────────────────────────────────────────

const WORKING_TOAST_ID = "flora-working-toast";
let workingRefCount = 0;
let workingHideTimer: ReturnType<typeof setTimeout> | null = null;
// Suppressed while the user has hidden FLoRA UI on this page.
let floraUiHidden = false;

function ensureWorkingToast(): HTMLElement {
    const existing = document.getElementById(WORKING_TOAST_ID);
    if (existing) return existing;
    const host = document.createElement("div");
    host.id = WORKING_TOAST_ID;
    host.style.cssText =
        "position:fixed;bottom:18px;right:18px;z-index:2147483647;" +
        "display:flex;align-items:center;gap:8px;pointer-events:none;" +
        "background:linear-gradient(135deg,#853953,#612D53);color:#fff;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
        "font-size:12px;font-weight:500;padding:8px 12px;border-radius:8px;" +
        "box-shadow:0 4px 16px rgba(0,0,0,0.18);" +
        "opacity:0;transform:translateY(6px);transition:opacity 0.18s ease,transform 0.18s ease;";
    const style = document.createElement("style");
    style.textContent = "@keyframes flora-working-spin{to{transform:rotate(360deg)}}";
    const spinner = document.createElement("span");
    spinner.style.cssText =
        "width:12px;height:12px;border-radius:50%;flex-shrink:0;box-sizing:border-box;" +
        "border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;" +
        "animation:flora-working-spin 0.7s linear infinite;";
    const label = document.createElement("span");
    label.textContent = "FLoRA is scanning this page…";
    host.appendChild(style);
    host.appendChild(spinner);
    host.appendChild(label);
    document.body.appendChild(host);
    return host;
}

/** Show the working toast (ref-counted — nested calls keep it visible). */
export function beginWorkIndicator(): void {
    workingRefCount++;
    if (floraUiHidden) return; // user hid FLoRA UI — don't surface the toast
    if (workingHideTimer) { clearTimeout(workingHideTimer); workingHideTimer = null; }
    const host = ensureWorkingToast();
    requestAnimationFrame(() => {
        host.style.opacity = "1";
        host.style.transform = "translateY(0)";
    });
}

/** Hide the working toast once all outstanding work has finished. */
export function endWorkIndicator(): void {
    workingRefCount = Math.max(0, workingRefCount - 1);
    if (workingRefCount > 0) return;
    const host = document.getElementById(WORKING_TOAST_ID);
    if (!host) return;
    // Brief delay so quick back-to-back passes don't flicker the toast.
    workingHideTimer = setTimeout(() => {
        host.style.opacity = "0";
        host.style.transform = "translateY(6px)";
        setTimeout(() => host.remove(), 200);
    }, 500);
}

// ──────────────────────────────────────────────
// Google Sheets modal
// ──────────────────────────────────────────────

const SHEETS_MODAL_ID = "flora-sheets-modal";

export interface SheetsModalCallbacks {
    onDismiss: () => void;
    onSnooze: () => void;
}

export function renderSheetsModal(
    matched: { doi: string; result: ReplicationResult }[],
    callbacks?: SheetsModalCallbacks
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

    const doiCount = matched.length;
    const doisParam = matched.map((m) => m.doi).join(",");

    const existing = document.getElementById(SHEETS_MODAL_ID);

    if (existing) {
        // Update in-place — just refresh the dynamic parts
        const doiCountEl = existing.querySelector<HTMLElement>("[data-flora-doi-count]");
        const replCountEl = existing.querySelector<HTMLElement>("[data-flora-repl-count]");
        const replLabelEl = existing.querySelector<HTMLElement>("[data-flora-repl-label]");
        const reproCountEl = existing.querySelector<HTMLElement>("[data-flora-repro-count]");
        const reproLabelEl = existing.querySelector<HTMLElement>("[data-flora-repro-label]");
        const detailsLink = existing.querySelector<HTMLAnchorElement>("[data-flora-details-link]");

        if (doiCountEl) doiCountEl.textContent = `${doiCount} DOI${doiCount !== 1 ? "s" : ""}`;
        if (replCountEl) replCountEl.textContent = String(totalRepl);
        if (replLabelEl) replLabelEl.textContent = `Replication${totalRepl !== 1 ? "s" : ""}`;
        if (reproCountEl) reproCountEl.textContent = String(totalRepro);
        if (reproLabelEl) reproLabelEl.textContent = `Reproduction${totalRepro !== 1 ? "s" : ""}`;
        if (detailsLink) detailsLink.href = `https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(doisParam)}`;
        return;
    }

    // First render — create the modal
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
      <div style="background:linear-gradient(135deg,#853953,#612D53);padding:14px 16px;display:flex;align-items:center;gap:10px;">
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
          Found replication &amp; reproduction data for <strong data-flora-doi-count style="color:#202124;">${doiCount} DOI${doiCount !== 1 ? "s" : ""}</strong> in this spreadsheet.
        </div>

        <!-- Stat cards -->
        <div style="display:flex;gap:10px;margin-bottom:4px;">
          <div style="
            flex:1;background:#f9f0f4;border:1px solid #d4a5b8;border-radius:8px;
            padding:12px;text-align:center;
          ">
            <div data-flora-repl-count style="font-size:22px;font-weight:600;color:#853953;line-height:1;">${totalRepl}</div>
            <div data-flora-repl-label style="font-size:11px;color:#612D53;margin-top:4px;font-weight:500;">Replication${totalRepl !== 1 ? "s" : ""}</div>
          </div>
          <div style="
            flex:1;background:#f9f0f4;border:1px solid #d4a5b8;border-radius:8px;
            padding:12px;text-align:center;
          ">
            <div data-flora-repro-count style="font-size:22px;font-weight:600;color:#853953;line-height:1;">${totalRepro}</div>
            <div data-flora-repro-label style="font-size:11px;color:#612D53;margin-top:4px;font-weight:500;">Reproduction${totalRepro !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:10px 16px 14px;display:flex;align-items:center;gap:8px;">
        <button class="flora-modal-snooze" title="Snooze for 10 minutes" style="
          all:unset;cursor:pointer;padding:7px 8px;font-size:0;line-height:0;
          color:#5f6368;border-radius:6px;transition:color 0.15s;
          display:flex;align-items:center;justify-content:center;margin-right:auto;
        "><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>
        <button class="flora-modal-dismiss" style="
          all:unset;cursor:pointer;padding:7px 18px;font-size:13px;font-weight:500;
          color:#5f6368;border-radius:6px;transition:background 0.15s;
        ">Dismiss</button>
        <a data-flora-details-link href="https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(doisParam)}" target="_blank" rel="noopener" style="
          all:unset;cursor:pointer;padding:7px 18px;font-size:13px;font-weight:500;
          color:#fff;background:linear-gradient(135deg,#853953,#612D53);border-radius:6px;text-align:center;
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

    // Wire up close / dismiss
    for (const el of host.querySelectorAll(".flora-modal-close, .flora-modal-dismiss")) {
        el.addEventListener("click", () => {
            removeSheetsModal();
            callbacks?.onDismiss();
        });
    }

    // Wire up snooze
    host.querySelector(".flora-modal-snooze")?.addEventListener("click", () => {
        removeSheetsModal();
        callbacks?.onSnooze();
    });
}

export function removeSheetsModal(): void {
    document.getElementById(SHEETS_MODAL_ID)?.remove();
}

// ──────────────────────────────────────────────
// Hide / show ALL FLoRA UI (popup toggle)
// ──────────────────────────────────────────────

export function hideAllFloraUI(): void {
    floraUiHidden = true;
    const toast = document.getElementById(WORKING_TOAST_ID);
    if (toast) toast.remove();
    const banner = document.getElementById(BANNER_HOST_ID);
    if (banner) banner.style.display = "none";

    const modal = document.getElementById(SHEETS_MODAL_ID);
    if (modal) modal.style.display = "none";

    for (const el of document.querySelectorAll<HTMLElement>(`.${BADGE_CLASS}`)) {
        el.style.display = "none";
    }

    for (const el of document.querySelectorAll<HTMLElement>(".flora-doi-label")) {
        el.style.display = "none";
    }

  const setup = document.getElementById(SETUP_HOST_ID);
  if (setup) setup.style.display = "none";

  const pubpeer = document.getElementById(PUBPEER_PANEL_ID);
  if (pubpeer) pubpeer.style.display = "none";
}

export function showAllFloraUI(): void {
    floraUiHidden = false;
    const banner = document.getElementById(BANNER_HOST_ID);
    if (banner) banner.style.display = "";

    const modal = document.getElementById(SHEETS_MODAL_ID);
    if (modal) modal.style.display = "";

    for (const el of document.querySelectorAll<HTMLElement>(`.${BADGE_CLASS}`)) {
        el.style.display = "";
    }

    for (const el of document.querySelectorAll<HTMLElement>(".flora-doi-label")) {
        el.style.display = "";
    }

  const setup = document.getElementById(SETUP_HOST_ID);
  if (setup) setup.style.display = "";

  const pubpeer = document.getElementById(PUBPEER_PANEL_ID);
  if (pubpeer) pubpeer.style.display = "";
}

// ──────────────────────────────────────────────
// PubPeer panel
// ──────────────────────────────────────────────

/**
 * Best on-page article title. Scholarly meta tags first, then headings, with
 * document.title last — some publishers (e.g. APA PsycNet) set document.title to
 * the site name ("APA PsycNet") rather than the paper title.
 */
function getPageArticleTitle(): string | null {
    for (const sel of [
        'meta[name="citation_title"]',
        'meta[name="dc.Title" i]',
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
    ]) {
        const content = document.querySelector<HTMLMetaElement>(sel)?.content?.trim();
        if (content) return content;
    }
    const h1 = document.querySelector<HTMLHeadingElement>("h1")?.textContent?.trim();
    if (h1) return h1;
    return document.title?.trim() || null;
}

const PUBPEER_PANEL_ID = "flora-pubpeer-panel";

const PANEL_WIDTH = 500;

// ── Smart tab positioning + drag ──────────────────────────────────────────

const TAB_STORAGE_KEY = "flora_tab_top_v1";

let _tabPositionObserver: MutationObserver | null = null;
let _tabResizeHandler: (() => void) | null = null;
let _tabDragCleanup: (() => void) | null = null;
// null = never set by user; number = user-dragged position in px from top
let _customTabTop: number | null = (() => {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY);
    return v !== null ? Number(v) : null;
  } catch { return null; }
})();

function cleanupTabPositioning(): void {
  _tabPositionObserver?.disconnect();
  _tabPositionObserver = null;
  if (_tabResizeHandler) {
    window.removeEventListener("resize", _tabResizeHandler);
    _tabResizeHandler = null;
  }
  _tabDragCleanup?.();
  _tabDragCleanup = null;
}

function positionTabOnRightEdge(tab: HTMLElement): void {
  // Respect user-dragged position
  if (_customTabTop !== null) {
    const clamped = Math.max(0, Math.min(window.innerHeight - (tab.offsetHeight || 80), _customTabTop));
    tab.style.top = `${Math.round(clamped)}px`;
    return;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const TAB_H = tab.offsetHeight || 80;
  const MARGIN = 16;

  // Collect occupied vertical ranges from ALL elements near the right edge.
  // Use getBoundingClientRect so we catch fixed/sticky/absolute inside fixed containers.
  const occupied: Array<[number, number]> = [];
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    if (el === tab || tab.contains(el) || el.contains(tab)) continue;
    const rect = el.getBoundingClientRect();
    // Element must touch the right edge (right side within 8px of viewport right)
    if (rect.right < vw - 8) continue;
    // Must have real size and be visible in the viewport
    if (rect.width < 4 || rect.height < 4) continue;
    if (rect.bottom < 0 || rect.top > vh) continue;
    // Only count elements that are actually rendered (not hidden)
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    occupied.push([rect.top, rect.bottom]);
  }

  occupied.sort((a, b) => a[0] - b[0]);

  // Merge overlapping/adjacent intervals
  const merged: Array<[number, number]> = [];
  for (const [t, b] of occupied) {
    if (merged.length && t <= merged[merged.length - 1][1] + MARGIN) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
    } else {
      merged.push([t, b]);
    }
  }

  // Find free vertical gaps
  const gaps: Array<[number, number]> = [];
  let prev = 0;
  for (const [t, b] of merged) {
    if (t - prev >= TAB_H + 2 * MARGIN) gaps.push([prev, t]);
    prev = b;
  }
  if (vh - prev >= TAB_H + 2 * MARGIN) gaps.push([prev, vh]);

  const center = vh / 2;
  let bestTop = center - TAB_H / 2;

  if (gaps.length > 0) {
    gaps.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - center) - Math.abs((b[0] + b[1]) / 2 - center));
    const [gs, ge] = gaps[0];
    bestTop = Math.max(gs + MARGIN, Math.min(center - TAB_H / 2, ge - TAB_H - MARGIN));
  }

  tab.style.top = `${Math.round(bestTop)}px`;
}

function attachTabDrag(tab: HTMLElement): void {
  let isDragging = false;
  let didDrag = false;
  let startY = 0;
  let startTop = 0;

  const onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    isDragging = true;
    didDrag = false;
    startY = e.clientY;
    startTop = parseInt(tab.style.top) || 0;
    // Stop animation so it no longer controls 'right' or interferes
    tab.style.animation = "none";
    tab.style.transition = "filter 0.15s";
    tab.style.cursor = "grabbing";
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!isDragging) return;
    const delta = e.clientY - startY;
    if (Math.abs(delta) > 5) didDrag = true;
    if (!didDrag) return;
    const tabH = tab.offsetHeight || 80;
    const newTop = Math.max(0, Math.min(window.innerHeight - tabH, startTop + delta));
    tab.style.top = `${Math.round(newTop)}px`;
  };

  const onMouseUp = (): void => {
    if (!isDragging) return;
    isDragging = false;
    tab.style.cursor = "grab";
    tab.style.transition = "right 0.3s cubic-bezier(0.4,0,0.2,1),filter 0.15s";
    if (didDrag) {
      tab.dataset.dragged = "1"; // click handler reads this to ignore the synthetic click after mouseup
      _customTabTop = parseInt(tab.style.top);
      try { localStorage.setItem(TAB_STORAGE_KEY, String(_customTabTop)); } catch { /* ignore */ }
    }
  };

  tab.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  _tabDragCleanup = (): void => {
    tab.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
}

function setupTabPositioning(tab: HTMLElement): void {
  cleanupTabPositioning();
  positionTabOnRightEdge(tab);
  attachTabDrag(tab);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const reposition = (): void => {
    if (_customTabTop !== null) return; // user has a preferred spot
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => positionTabOnRightEdge(tab), 200);
  };

  // subtree:true catches plugins that inject into nested containers
  _tabPositionObserver = new MutationObserver(reposition);
  _tabPositionObserver.observe(document.body, { childList: true, subtree: true });

  _tabResizeHandler = reposition;
  window.addEventListener("resize", reposition, { passive: true });
}

/** Stable string describing everything the side panel renders. */
function panelSignature(
  primary: PubPeerFeedback | null,
  references: { doi: DoiString; title: string }[],
  articleDois: DoiString[],
  pageState: Map<DoiString, LookupState>,
  refFeedbackByDoi: Map<DoiString, PubPeerFeedback>,
  retractionByDoi: Map<DoiString, RetractionResponse>
): string {
  const statsOf = (doi: DoiString): string => {
    const s = pageState.get(doi);
    if (s?.status !== "matched") return s?.status ?? "none";
    const {n_replications_total, n_reproductions_total, n_originals_total} = s.result.record.stats;
    return `${n_replications_total}/${n_reproductions_total}/${n_originals_total}`;
  };
  const noticeOf = (doi: DoiString): string => retractionByDoi.get(doi)?.kind ?? "";

  const parts = [
    `primary:${primary ? `${primary.url}#${primary.total_comments}` : "none"}`,
    `article:${articleDois.map((d) => `${d}=${statsOf(d)}:${noticeOf(d)}`).sort().join(",")}`,
    `refs:${references
      .map((r) => `${r.doi}|${r.title}|${statsOf(r.doi)}|${noticeOf(r.doi)}|${refFeedbackByDoi.get(r.doi)?.total_comments ?? 0}`)
      .sort()
      .join(",")}`,
  ];
  return parts.join(";;");
}

export function renderSidePanel(
  articleFeedbacks: PubPeerFeedback[],
  references: { doi: DoiString; title: string }[],
  pageState: Map<DoiString, LookupState>,
  doiContext: Map<DoiString, DoiContext>,
  refFeedbackByDoi: Map<DoiString, PubPeerFeedback> = new Map(),
  retractions: RetractionResponse[] = []
): void {
  const existingHost = document.getElementById(PUBPEER_PANEL_ID);
  // Track open state via a stateful marker on the host — comparing inline
  // `transform` strings is fragile because browsers may normalise the value
  // (e.g. `translateX(0)` → `translateX(0px)`). The marker is set in
  // openPanel/closePanel below so reading it here is always reliable.
  const wasOpen = existingHost?.dataset.floraPanelOpen === "1";

  const withComments = articleFeedbacks.filter((f) => f.total_comments > 0);

  // Article FORRT stats — computed before guard so they can trigger panel display
  const articleDois = [...doiContext.entries()]
    .filter(([, ctx]) => ctx === "article")
    .map(([doi]) => doi);
  let articleReplications = 0;
  let articleReproductions = 0;
  let articleOriginals = 0;
  const allReplicationEntries: ReplicationEntry[] = [];
  const allReproductionEntries: ReplicationEntry[] = [];
  const allOriginalEntries: OriginalEntry[] = [];
  for (const doi of articleDois) {
    const state = pageState.get(doi);
    if (state?.status === "matched") {
      articleReplications += state.result.record.stats.n_replications_total;
      articleReproductions += state.result.record.stats.n_reproductions_total;
      articleOriginals += state.result.record.stats.n_originals_total;
      allReplicationEntries.push(...state.result.record.replications);
      if (state.result.record.reproductions) {
        allReproductionEntries.push(...state.result.record.reproductions);
      }
      allOriginalEntries.push(...state.result.record.originals);
    }
  }

  // When the viewed paper is itself a replication (it has original studies), the
  // panel should focus on the original(s) it replicated — not list it as a
  // replication. Suppress the replication/reproduction sections in that case.
  const articleIsReplication = articleOriginals > 0;

  const hasReplicationData = articleReplications > 0 || articleReproductions > 0 || articleOriginals > 0;

  // Notice status — keyed by the DOI as it appears on the page (originDoi).
  // A "notice" is either a retraction or an expression of concern; the kind
  // discriminator drives the banner palette and copy via noticePresentation().
  const retractionByDoi = new Map<DoiString, RetractionResponse>();
  for (const r of retractions) retractionByDoi.set(r.originDoi, r);
  const articleNotice = articleDois
    .map((doi) => retractionByDoi.get(doi))
    .find((r): r is RetractionResponse => r !== undefined);

  // The panel always renders on a recognised article page (checkPubPeer only
  // calls this when a primary DOI exists). When nothing is flagged it still
  // shows the article title and the "No PubPeer comments" empty state, so the
  // reader can see FLoRA ran and found nothing rather than seeing no UI at all.
  debugLog(
    "renderSidePanel:",
    `articleComments=${withComments.length}`,
    `replicationData=${hasReplicationData}`,
    `articleNotice=${articleNotice?.kind ?? "none"}`,
    `flaggedRefs=${references.length}`
  );

  const primary = withComments.length > 0
    ? withComments.reduce((best, f) => f.total_comments > best.total_comments ? f : best)
    : null;

  if (primary && !isSafePubPeerUrl(primary.url)) return;

  // Rebuilding recreates the <iframe>, reloading the embedded PubPeer thread.
  const signature = panelSignature(
    primary, references, articleDois, pageState, refFeedbackByDoi, retractionByDoi
  );
  if (existingHost && existingHost.dataset.floraPanelSig === signature) {
    debugLog("renderSidePanel: unchanged — kept existing panel");
    return;
  }

  cleanupTabPositioning();
  existingHost?.remove();

  const host = document.createElement("div");
  host.id = PUBPEER_PANEL_ID;
  host.dataset.floraPanelSig = signature;

  const hostStyle = document.createElement("style");
  hostStyle.textContent = `
    @keyframes flora-tab-enter {
      0%   { opacity: 0; right: -28px; }
      60%  { opacity: 1; right: 4px; }
      100% { opacity: 1; right: 0; }
    }
    @keyframes flora-tab-pulse {
      0%, 100% { box-shadow: -2px 0 10px rgba(0,0,0,0.2), 0 0 0 0 rgba(133,57,83,0.5); }
      50%       { box-shadow: -2px 0 10px rgba(0,0,0,0.2), 0 0 0 10px rgba(133,57,83,0); }
    }
  `;
  host.appendChild(hostStyle);

  // Tab trigger — always visible on right edge
  const tab = document.createElement("button");
  tab.setAttribute("aria-label", "Open FLoRA panel");
  // all:unset resets animation, so animation is declared explicitly after it.
  // 'right' is animated by flora-tab-enter; openPanel/closePanel clear the animation
  // before touching 'right' so the JS value isn't suppressed by the fill mode.
  tab.style.cssText =
    "all:unset;cursor:grab;pointer-events:all;" +
    "position:fixed;right:0;top:0;" +
    "width:28px;padding:14px 0;z-index:2147483647;" +
    "background:linear-gradient(180deg,#853953,#612D53);" +
    "border-radius:6px 0 0 6px;" +
    "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;" +
    "box-shadow:-2px 0 10px rgba(0,0,0,0.2);" +
    "transition:right 0.3s cubic-bezier(0.4,0,0.2,1),filter 0.15s;" +
    "animation:flora-tab-enter 0.5s cubic-bezier(0.34,1.4,0.64,1) forwards," +
    "flora-tab-pulse 1.8s ease-in-out 0.6s 3;";
  tab.addEventListener("mouseenter", () => { tab.style.filter = "brightness(1.15)"; });
  tab.addEventListener("mouseleave", () => { tab.style.filter = ""; });

  // Grip dots — visual hint that the tab is draggable
  const grip = document.createElement("span");
  grip.style.cssText =
    "display:grid;grid-template-columns:repeat(2,3px);gap:2px;opacity:0.5;pointer-events:none;";
  for (let i = 0; i < 6; i++) {
    const dot = document.createElement("span");
    dot.style.cssText = "width:3px;height:3px;border-radius:50%;background:#fff;";
    grip.appendChild(dot);
  }

  const tabLabel = document.createElement("span");
  tabLabel.style.cssText =
    "color:#fff;font-size:10px;font-weight:700;letter-spacing:1.2px;" +
    "writing-mode:vertical-rl;text-orientation:mixed;transform:rotate(180deg);" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "pointer-events:none;";
  tabLabel.textContent = "FLoRA";

  const arrow = document.createElement("span");
  arrow.style.cssText =
    "color:rgba(255,255,255,0.9);font-size:16px;line-height:1;" +
    "transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);pointer-events:none;";
  arrow.textContent = "‹";

  tab.appendChild(grip);
  tab.appendChild(tabLabel);
  tab.appendChild(arrow);

  // Sliding panel
  const panel = document.createElement("div");
  panel.className = "flora-sliding-panel";
  panel.style.cssText =
    `position:fixed;top:0;right:0;height:100vh;width:${PANEL_WIDTH}px;` +
    "background:#fff;display:flex;flex-direction:column;" +
    "box-shadow:-4px 0 24px rgba(0,0,0,0.15);" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
    "transform:translateX(100%);transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);" +
    "z-index:2147483647;overflow:hidden;";

  // Header
  const header = document.createElement("div");
  header.style.cssText =
    "background:linear-gradient(135deg,#853953,#612D53);padding:14px 16px;" +
    "display:flex;align-items:center;gap:10px;flex-shrink:0;";
  header.innerHTML = `
    <span style="color:#fff;font-weight:700;font-size:13px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:5px;">FLoRA</span>
    <span style="color:#fff;font-size:14px;font-weight:500;flex:1;">Meta Report</span>`;

  const closeBtn = document.createElement("button");
  closeBtn.setAttribute("aria-label", "Close panel");
  closeBtn.style.cssText =
    "all:unset;cursor:pointer;color:rgba(255,255,255,0.8);font-size:20px;line-height:1;" +
    "width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%;";
  closeBtn.textContent = "×";
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Summary section
  const summary = document.createElement("div");
  summary.style.cssText =
    "border-bottom:1px solid #e8e8e8;background:#f5f8fa;" +
    "font-size:12px;color:#3c4043;line-height:1.6;flex-shrink:0;";

  // Article title — use PubPeer title if available, else h1/document.title
  const articleTitleText =
    primary?.title ||
    getPageArticleTitle() ||
    "Article";
  const articleFloraUrl = articleDois.length > 0
    ? `https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(articleDois[0])}`
    : null;

  const articleTitleEl = document.createElement("div");
  articleTitleEl.style.cssText = "display:flex;flex-direction:column;padding:12px 16px 8px;gap:6px;";
  const titleRow = document.createElement("div");
  titleRow.style.cssText = "display:flex;align-items:flex-start;gap:8px;";
  // OA placeholder for the main article — filled in by the Unpaywall lookup below.
  // Kept as a sibling of the title (not a child of titleLink) to avoid nested <a>.
  let articleOaPlaceholder: HTMLElement | undefined;
  if (articleFloraUrl) {
    const titleLink = document.createElement("a");
    titleLink.href = articleFloraUrl;
    titleLink.target = "_blank";
    titleLink.rel = "noopener";
    titleLink.title = "Open in FLoRA";
    titleLink.style.cssText =
      "display:inline-flex;align-items:flex-start;gap:4px;color:#853953;font-weight:600;" +
      "font-size:18px;text-decoration:none;line-height:1.4;word-break:break-word;flex:1;min-width:0;";
    const titleSpan = document.createElement("span");
    titleSpan.style.cssText = "text-transform:capitalize;";
    titleSpan.textContent = articleTitleText;
    titleLink.appendChild(titleSpan);
    titleRow.appendChild(titleLink);
  } else {
    const titleSpan = document.createElement("span");
    titleSpan.style.cssText =
      "color:#853953;font-weight:600;font-size:18px;line-height:1.4;word-break:break-word;flex:1;min-width:0;";
    titleSpan.textContent = articleTitleText;
    titleRow.appendChild(titleSpan);
  }
  if (articleDois.length > 0) {
    articleOaPlaceholder = document.createElement("span");
    articleOaPlaceholder.style.cssText = "flex-shrink:0;";
    titleRow.appendChild(articleOaPlaceholder);
  }
  articleTitleEl.appendChild(titleRow);

  // Authors and year subtitle — FORRT API data first, then page metadata fallback
  let subtitleAuthors: string | null = null;
  let subtitleYear: number | null = null;
  for (const doi of articleDois) {
    const state = pageState.get(doi);
    if (state?.status === "matched") {
      const { authors, year } = state.result;
      if (authors?.length) {
        const first = authors[0];
        const name = first.family ?? first.given ?? null;
        if (name) subtitleAuthors = authors.length > 1 ? `${name} et al.` : name;
      }
      if (year) subtitleYear = year;
      break;
    }
  }
  if (!subtitleAuthors) {
    const metaAuthor = document.querySelector<HTMLMetaElement>(
      'meta[name="citation_author"], meta[name="dc.creator"]'
    )?.content?.trim() ?? null;
    if (metaAuthor) subtitleAuthors = metaAuthor;
  }
  if (!subtitleYear) {
    const metaDate = document.querySelector<HTMLMetaElement>(
      'meta[name="citation_publication_date"], meta[name="citation_online_date"], meta[name="dc.date"]'
    )?.content?.trim() ?? null;
    if (metaDate) {
      const yearMatch = metaDate.match(/\b((?:19|20)\d{2})\b/);
      if (yearMatch) subtitleYear = Number(yearMatch[1]);
    }
  }
  if (subtitleAuthors !== null || subtitleYear !== null) {
    const subtitleParts: string[] = [];
    if (subtitleAuthors) subtitleParts.push(subtitleAuthors);
    if (subtitleYear) subtitleParts.push(String(subtitleYear));
    const subtitleEl = document.createElement("div");
    subtitleEl.style.cssText = "font-size:13px;color:#5f6368;line-height:1.4;";
    subtitleEl.textContent = subtitleParts.join(" · ");
    articleTitleEl.appendChild(subtitleEl);
  }

  summary.appendChild(articleTitleEl);

  // Notice alert — shown when the article's DOI carries a retraction or an
  // expression of concern. Styling and copy come from noticePresentation.
  if (articleNotice) {
    const np = noticePresentation(articleNotice.kind);
    const titleText = articleNotice.kind === "concern"
      ? "View the expression-of-concern notice"
      : "View the retraction notice";
    const noticeBanner = document.createElement("a");
    noticeBanner.href = `https://doi.org/${articleNotice.doi}`;
    noticeBanner.target = "_blank";
    noticeBanner.rel = "noopener noreferrer";
    noticeBanner.title = titleText;
    noticeBanner.style.cssText =
      "display:flex;align-items:center;gap:8px;margin:0 16px 12px;padding:10px 12px;" +
      `background:${np.bannerBackground};border:1px solid ${np.bannerBorder};border-left:4px solid ${np.bannerLeftAccent};` +
      "border-radius:8px;text-decoration:none;";
    noticeBanner.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="18" height="18" fill="${np.bannerIconColor}" style="flex-shrink:0;">` +
      `<path d="M320 64C334.7 64 348.2 72.1 355.2 85L571.2 485C577.9 497.4 577.6 512.4 570.4 524.5C563.2 536.6 550.1 544 536 544L104 544C89.9 544 76.8 536.6 69.6 524.5C62.4 512.4 62.1 497.4 68.8 485L284.8 85C291.8 72.1 305.3 64 320 64zM320 416C302.3 416 288 430.3 288 448C288 465.7 302.3 480 320 480C337.7 480 352 465.7 352 448C352 430.3 337.7 416 320 416zM320 224C301.8 224 287.3 239.5 288.6 257.7L296 361.7C296.9 374.2 307.4 384 319.9 384C332.5 384 342.9 374.3 343.8 361.7L351.2 257.7C352.5 239.5 338.1 224 319.8 224z"/></svg>` +
      `<span style="font-size:12px;font-weight:600;color:${np.bannerText};line-height:1.4;">` +
      `${np.bannerCopy} `;
    summary.appendChild(noticeBanner);
  }

  // Replication/reproduction/original entry lists from FORRT API
  const renderEntrySection = (
    entries: Array<{
      doi?: string | null; title?: string | null;
      authors?: Array<{ given?: string | null; family?: string | null }> | null;
      journal?: string | null; year?: number | null; url?: string | null;
      outcome?: string | null;
    }>,
    sectionTitle: string,
    showOaPlaceholder = false
  ): Map<string, HTMLElement> => {
    const oaPlaceholders = new Map<string, HTMLElement>();
    if (entries.length === 0) return oaPlaceholders;
    const section = document.createElement("div");
    section.style.cssText = "border-top:1px solid #e8e8e8;";
    const sectionLabel = document.createElement("div");
    sectionLabel.style.cssText =
      "font-size:14px;font-weight:600;color:#5f6368;text-transform:uppercase;padding:0px 16px 10px 12px;" +
      "letter-spacing:0.5px;margin-bottom:6px;border-bottom:1px solid #e8e8e8;padding:10px 16px;";
    sectionLabel.textContent = `${sectionTitle} (${entries.length})`;
    section.appendChild(sectionLabel);

    const COLLAPSED_COUNT = 5;
    const items: HTMLDivElement[] = [];
    for (const entry of entries) {
      const item = document.createElement("div");
      item.style.cssText = "padding:6px 0;border-bottom:1px solid #f0f0f0;padding:10px 16px;";
      const entryUrl = entry.url ?? (entry.doi ? `https://doi.org/${entry.doi}` : null);
      const titleText = entry.title ?? entry.doi ?? "Unknown";
      const titleRow = document.createElement("div");
      titleRow.style.cssText = "display:flex;align-items:flex-start;gap:8px;";
      if (entryUrl && /^https?:\/\//i.test(entryUrl)) {
        const a = document.createElement("a");
        a.href = entryUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.cssText =
          "font-size:12px;font-weight:500;color:#853953;text-decoration:none;line-height:1.4;flex:1;min-width:0;";
        a.textContent = titleText;
        titleRow.appendChild(a);
      } else {
        const titleEl = document.createElement("div");
        titleEl.style.cssText = "font-size:12px;font-weight:500;color:#202124;line-height:1.4;flex:1;min-width:0;";
        titleEl.textContent = titleText;
        titleRow.appendChild(titleEl);
      }
      if (showOaPlaceholder && entry.doi) {
        const placeholder = document.createElement("span");
        titleRow.appendChild(placeholder);
        oaPlaceholders.set(entry.doi, placeholder);
      }
      if (entry.outcome) {
        const outcome = entry.outcome.toLowerCase();
        const isSuccess = outcome.includes("success") || outcome.includes("replicated") || outcome === "yes";
        const isFailure = outcome.includes("fail") || outcome === "no";
        const badge = document.createElement("span");
        badge.style.cssText =
          "flex-shrink:0;font-size:10px;font-weight:600;" +
          "padding:1px 7px;border-radius:10px;line-height:1.6;" +
          (isSuccess
            ? "background:#d1fae5;color:#065f46;"
            : isFailure
            ? "background:#fee2e2;color:#991b1b;"
            : "background:#fef8e8;color:#b8860b;");
        badge.textContent = entry.outcome;
        titleRow.appendChild(badge);
      }
      item.appendChild(titleRow);
      const meta: string[] = [];
      if (entry.authors?.length) {
        const first = entry.authors[0];
        const authorStr = first.family ?? first.given ?? "";
        if (authorStr) meta.push(entry.authors.length > 1 ? `${authorStr} et al.` : authorStr);
      }
      if (entry.year) meta.push(String(entry.year));
      if (entry.journal) meta.push(entry.journal);
      if (meta.length > 0) {
        const metaEl = document.createElement("div");
        metaEl.style.cssText = "font-size:11px;color:#5f6368;margin-top:2px;";
        metaEl.textContent = meta.join(" · ");
        item.appendChild(metaEl);
      }
      items.push(item);
      section.appendChild(item);
    }

    if (items.length > COLLAPSED_COUNT) {
      const hidden = items.slice(COLLAPSED_COUNT);
      for (const item of hidden) item.style.display = "none";

      const toggleWrap = document.createElement("div");
      toggleWrap.style.cssText = "padding:8px 16px;text-align:center;border-bottom:1px solid #f0f0f0;";

      const toggle = document.createElement("button");
      toggle.style.cssText =
        "all:unset;cursor:pointer;font-size:12px;font-weight:600;color:#853953;" +
        "padding:4px 10px;border-radius:6px;transition:background 0.15s;";
      toggle.addEventListener("mouseenter", () => { toggle.style.background = "#f9f0f4"; });
      toggle.addEventListener("mouseleave", () => { toggle.style.background = ""; });

      const noun = sectionTitle.replace(/s$/i, "").toLowerCase();
      let expanded = false;
      const setLabel = (): void => {
        toggle.textContent = expanded
          ? `Show fewer ${noun}s`
          : `Show ${hidden.length} more ${noun}${hidden.length === 1 ? "" : "s"}`;
      };
      setLabel();
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        for (const item of hidden) item.style.display = expanded ? "" : "none";
        setLabel();
      });

      toggleWrap.appendChild(toggle);
      section.appendChild(toggleWrap);
    }

    summary.appendChild(section);
    return oaPlaceholders;
  };

  // A replication paper shows only the original study it replicated; otherwise
  // show what replicated/reproduced this paper.
  const oaPlaceholders = articleIsReplication
    ? new Map<string, HTMLElement>()
    : renderEntrySection(allReplicationEntries, `Replication${allReplicationEntries.length !== 1 ? "s" : ""}`, true);
  if (!articleIsReplication) {
    renderEntrySection(allReproductionEntries, `Reproduction${allReproductionEntries.length !== 1 ? "s" : ""}`);
  }
  renderEntrySection(allOriginalEntries, `Original Paper${allOriginalEntries.length !== 1 ? "s" : ""}`);

  // Include the main article in the Unpaywall lookup. Skip if its DOI already
  // belongs to a replication entry so that entry's placeholder isn't clobbered.
  if (articleOaPlaceholder && articleDois.length > 0 && !oaPlaceholders.has(articleDois[0])) {
    oaPlaceholders.set(articleDois[0], articleOaPlaceholder);
  }

  void (async () => {
    if (oaPlaceholders.size === 0) return;
    const { email } = await getSettings();
    if (!email) return;
    for (const [doi, placeholder] of oaPlaceholders) {
      try {
        const resp = await fetch(
          `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`
        );
        if (!resp.ok) continue;
        const data = await resp.json() as {
          is_oa?: boolean;
          best_oa_location?: { url_for_pdf?: string | null; url?: string | null } | null;
        };
        if (!data.is_oa) continue;
        const oaUrl = data.best_oa_location?.url_for_pdf ?? data.best_oa_location?.url;
        if (!oaUrl) continue;
        const icon = document.createElement("a");
        icon.href = oaUrl;
        icon.target = "_blank";
        icon.rel = "noopener noreferrer";
        icon.title = "Free PDF available via Unpaywall";
        // Both the article title and the reference/replication entries get a
        // circular OA badge so the status reads as a deliberate element; the
        // title's is larger to match its prominence.
        const isArticleBadge = placeholder === articleOaPlaceholder;
        const circleSize = isArticleBadge ? 30 : 20;
        const svgSize = isArticleBadge ? 16 : 11;
        icon.style.cssText =
          `flex-shrink:0;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;` +
          `width:${circleSize}px;height:${circleSize}px;border-radius:50%;background:#f9f0f4;` +
          `border:1px solid #d4a5b8;color:#853953;line-height:1;transition:background 0.15s;`;
        icon.addEventListener("mouseenter", () => { icon.style.background = "#f1dde5"; });
        icon.addEventListener("mouseleave", () => { icon.style.background = "#f9f0f4"; });
        icon.innerHTML =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="none" ` +
          `stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
          `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>` +
          `<path d="M7 11V7a5 5 0 0 1 9.9-1"/>` +
          `</svg>`;
        placeholder.replaceWith(icon);
      } catch {
        // ignore network errors per entry
      }
    }
  })();

  // Build one reference row (title + FORRT/retraction/PubPeer tags).
  const buildRefRow = (ref: { doi: DoiString; title: string }): HTMLLIElement => {
    const doi = ref.doi;
    const feedback = refFeedbackByDoi.get(doi);
    const li = document.createElement("li");
    li.style.cssText = "padding:10px 16px;border-bottom:1px solid #f0f0f0;";

    // Canonical title resolved by the caller (PubPeer / Crossref / OpenAlex).
    const title = ref.title || feedback?.title || doi;
    const titleLink = document.createElement("a");
    titleLink.href = feedback?.url || `https://doi.org/${doi}`;
    titleLink.target = "_blank";
    titleLink.rel = "noopener";
    // Clamp to 3 lines so a long/unparsed citation can't blow up the row.
    titleLink.style.cssText =
      "display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;" +
      "overflow:hidden;text-overflow:ellipsis;word-break:break-word;" +
      "font-size:12px;font-weight:500;color:#853953;" +
      "text-decoration:none;line-height:1.4;margin-bottom:6px;";
    titleLink.textContent = title;

    const tagsRow = document.createElement("div");
    tagsRow.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:4px;";

    const s = pageState.get(doi);
    if (s?.status === "matched") {
      const { n_replications_total, n_reproductions_total, n_originals_total } = s.result.record.stats;
      const floraUrl = `https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(doi)}`;
      const makeTag = (label: string, bg: string, fg: string, border: string): HTMLAnchorElement => {
        const tag = document.createElement("a");
        tag.href = floraUrl;
        tag.target = "_blank";
        tag.rel = "noopener noreferrer";
        tag.style.cssText =
          `flex-shrink:0;font-size:10px;font-weight:600;color:${fg};` +
          `background:${bg};border:1px solid ${border};padding:1px 7px;border-radius:10px;` +
          "white-space:nowrap;text-decoration:none;cursor:pointer;";
        tag.textContent = label;
        return tag;
      };
      if (n_replications_total > 0) {
        tagsRow.appendChild(makeTag(
          `${n_replications_total} Replication${n_replications_total === 1 ? "" : "s"}`,
          "#e0f2fe", "#0369a1", "#7dd3fc"
        ));
      }
      if (n_reproductions_total > 0) {
        tagsRow.appendChild(makeTag(
          `${n_reproductions_total} Reproduction${n_reproductions_total === 1 ? "" : "s"}`,
          "#ede9fe", "#6d28d9", "#c4b5fd"
        ));
      }
      if (n_originals_total > 0) {
        tagsRow.appendChild(makeTag("View in Atlas", "#fef9c3", "#854d0e", "#fde047"));
      }
    }

    const refRetraction = retractionByDoi.get(doi);
    if (refRetraction) {
      const retractTag = document.createElement("a");
      retractTag.href = `https://doi.org/${refRetraction.doi}`;
      retractTag.target = "_blank";
      retractTag.rel = "noopener noreferrer";
      retractTag.title = "View the retraction notice";
      retractTag.style.cssText =
        "flex-shrink:0;font-size:10px;font-weight:600;color:#fff;" +
        "background:#FF1744;border:1px solid #FF1744;padding:1px 7px;border-radius:10px;" +
        "white-space:nowrap;text-decoration:none;cursor:pointer;";
      retractTag.textContent = "Retracted";
      tagsRow.appendChild(retractTag);
    }

    if (feedback && feedback.total_comments > 0) {
      const commentText = `${feedback.total_comments} ${feedback.total_comments === 1 ? "comment" : "comments"}`;
      // PubPeer-branded pill: speech-bubble mark + count in PubPeer's colours
      // (#446058 teal on a light-teal background).
      const commentTag = document.createElement("a");
      commentTag.href = feedback.url;
      commentTag.target = "_blank";
      commentTag.rel = "noopener noreferrer";
      commentTag.title = "View on PubPeer";
      commentTag.style.cssText =
        "flex-shrink:0;display:inline-flex;align-items:center;gap:4px;" +
        "font-size:10px;font-weight:600;color:#446058;" +
        "background:#e9f3f1;border:1px solid #7accc8;padding:1px 7px;border-radius:10px;" +
        "white-space:nowrap;text-decoration:none;cursor:pointer;";
      commentTag.innerHTML =
        `<svg width="9" height="13" viewBox="0 0 98.5 146.5" fill="none" stroke="#446058" ` +
        `stroke-width="7" stroke-linecap="round" style="display:block;flex-shrink:0;">` +
        `<circle cx="13.667" cy="34.833" r="10.167"/>` +
        `<circle cx="86.302" cy="80.344" r="10.167"/>` +
        `<circle cx="86.302" cy="12.741" r="10.167"/>` +
        `<circle cx="13.04" cy="133.811" r="10.166"/>` +
        `<line x1="13.04" y1="45" x2="13.04" y2="123.645"/>` +
        `<line x1="23.44" y1="32.04" x2="76.554" y2="15.626"/>` +
        `<line x1="86.303" y1="22.907" x2="86.303" y2="70.177"/>` +
        `<line x1="18.027" y1="124.955" x2="80.772" y2="21.267"/>` +
        `<line x1="76.136" y1="80.344" x2="45.023" y2="80.344"/></svg>` +
        `<span>${commentText}</span>`;
      tagsRow.appendChild(commentTag);
    }

    li.appendChild(titleLink);
    li.appendChild(tagsRow);
    return li;
  };

  // Render a collapsible reference-row section (first 5 visible, toggle reveals rest).
  const renderRefSection = (
    headingText: string,
    refs: { doi: DoiString; title: string }[],
    noun: string
  ): void => {
    if (refs.length === 0) return;
    const section = document.createElement("div");
    section.style.cssText = "border-top:1px solid #e8e8e8;";

    const label = document.createElement("div");
    label.style.cssText =
      "font-size:14px;font-weight:600;color:#5f6368;text-transform:uppercase;" +
      "letter-spacing:0.5px;border-bottom:1px solid #e8e8e8;padding:10px 16px;";
    label.textContent = `${headingText} with Tags (${refs.length})`;
    section.appendChild(label);

    const list = document.createElement("ul");
    list.style.cssText = "margin:0;list-style:none;padding:0;";

    const COLLAPSED_COUNT = 5;
    const items: HTMLLIElement[] = [];
    for (const ref of refs) {
      const li = buildRefRow(ref);
      items.push(li);
      list.appendChild(li);
    }
    section.appendChild(list);

    if (items.length > COLLAPSED_COUNT) {
      const hidden = items.slice(COLLAPSED_COUNT);
      for (const li of hidden) li.style.display = "none";

      const toggleWrap = document.createElement("div");
      toggleWrap.style.cssText = "padding:8px 16px;text-align:center;border-bottom:1px solid #f0f0f0;";

      const toggle = document.createElement("button");
      toggle.style.cssText =
        "all:unset;cursor:pointer;font-size:12px;font-weight:600;color:#853953;" +
        "padding:4px 10px;border-radius:6px;transition:background 0.15s;";
      toggle.addEventListener("mouseenter", () => { toggle.style.background = "#f9f0f4"; });
      toggle.addEventListener("mouseleave", () => { toggle.style.background = ""; });

      let expanded = false;
      const setLabel = (): void => {
        toggle.textContent = expanded
          ? `Show fewer ${noun}s`
          : `Show ${hidden.length} more ${noun}${hidden.length === 1 ? "" : "s"}`;
      };
      setLabel();
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        for (const li of hidden) li.style.display = expanded ? "" : "none";
        setLabel();
      });

      toggleWrap.appendChild(toggle);
      section.appendChild(toggleWrap);
    }

    summary.appendChild(section);
  };

  // References that carry FORRT replication/reproduction/original data are
  // promoted to a section at the top of the panel so they're prominent — they
  // still appear in the full References list below as well.
  // Full reference list — every flagged reference.
  renderRefSection("References", references, "reference");

  // Single scrollable body between header and footer
  const scrollBody = document.createElement("div");
  scrollBody.style.cssText = "flex:1;overflow-y:auto; background: #f5f8fa;";
  scrollBody.appendChild(summary);

  // PubPeer comments section — only rendered when there is a primary PubPeer URL
  if (primary) {
    const commentsHeader = document.createElement("p");
    commentsHeader.style.cssText =
      "padding:12px 16px;font-size:14px;color:#5f6368;line-height:1.6;" +
      "flex-shrink:0;margin:0;font-weight:600;background:#f5f8fa;text-transform:uppercase;";
    commentsHeader.textContent = "Comments";
    scrollBody.appendChild(commentsHeader);

    const iframeWrap = document.createElement("div");
    iframeWrap.style.cssText = "overflow:hidden;";
    const iframe = document.createElement("iframe");
    iframe.src = primary.url;
    iframe.title = "PubPeer comments";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-forms");
    iframe.style.cssText = "width:100%;height:200px;border:none;display:block;opacity:0;transition:opacity 0.15s;overflow:hidden;";

    const revealIframe = (): void => { iframe.style.opacity = "1"; };

    // When PubPeer refuses to embed (X-Frame-Options / CSP frame-ancestors) the
    // frame stays blank and our in-iframe script never posts CSS_READY. Swap the
    // broken frame for an external link so the comments are still reachable.
    const showFallback = (): void => {
      if (iframeWrap.dataset.floraFallback === "1") return;
      iframeWrap.dataset.floraFallback = "1";
      clearTimeout(fallbackTimer);
      window.removeEventListener("message", onIframeMessage);
      iframe.remove();

      const fb = document.createElement("div");
      fb.style.cssText =
        "display:flex;flex-direction:column;align-items:center;gap:10px;" +
        "padding:24px 20px;text-align:center;color:#5f6368;";
      const msg = document.createElement("span");
      msg.style.cssText = "font-size:12px;line-height:1.5;";
      msg.textContent = "PubPeer comments can't be shown inline here.";
      const link = document.createElement("a");
      link.href = primary.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "View comments on PubPeer ↗";
      link.style.cssText =
        "display:inline-flex;align-items:center;gap:6px;padding:8px 14px;" +
        "font-size:13px;font-weight:600;color:#fff;background:#853953;" +
        "border-radius:6px;text-decoration:none;";
      fb.appendChild(msg);
      fb.appendChild(link);
      iframeWrap.appendChild(fb);
    };

    const fallbackTimer = setTimeout(showFallback, 4000);
    const onIframeMessage = (e: MessageEvent): void => {
      if (e.source !== iframe.contentWindow) return;
      const data = e.data as { type?: string; height?: number };
      if (data?.type === "FLORA_PUBPEER_CSS_READY") {
        clearTimeout(fallbackTimer);
        revealIframe();
      } else if (data?.type === "FLORA_PUBPEER_HEIGHT" && typeof data.height === "number") {
        iframe.style.height = `${data.height}px`;
      }
    };
    window.addEventListener("message", onIframeMessage);
    iframe.addEventListener("error", showFallback);

    iframeWrap.appendChild(iframe);
    scrollBody.appendChild(iframeWrap);
  } else {
    // No PubPeer thread for this article — show an empty state so the panel
    // doesn't read as broken when there's only FORRT replication data, or
    // nothing flagged at all.
    const commentsHeader = document.createElement("p");
    commentsHeader.style.cssText =
      "padding:12px 16px;font-size:14px;color:#5f6368;line-height:1.6;" +
      "flex-shrink:0;margin:0;font-weight:600;background:#f5f8fa;text-transform:uppercase;" +
      "border-top:1px solid #e8e8e8;";
    commentsHeader.textContent = "Comments";
    scrollBody.appendChild(commentsHeader);

    const emptyState = document.createElement("div");
    emptyState.style.cssText =
      "display:flex;flex-direction:column;align-items:center;gap:8px;" +
      "padding:32px 24px;text-align:center;color:#9aa0a6;";
    emptyState.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" ` +
      `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` +
      `<span style="font-size:13px;font-weight:500;color:#5f6368;">No PubPeer comments yet</span>` +
      `<span style="font-size:12px;line-height:1.5;">This article hasn't been discussed on PubPeer.</span>`;

    const startDiscussion = document.createElement("a");
    startDiscussion.href = articleDois.length > 0
      ? `https://pubpeer.com/search?q=${encodeURIComponent(articleDois[0])}`
      : "https://pubpeer.com/";
    startDiscussion.target = "_blank";
    startDiscussion.rel = "noopener";
    startDiscussion.textContent = "Start a discussion on PubPeer";
    startDiscussion.style.cssText =
      "all:unset;cursor:pointer;margin-top:8px;padding:6px 14px;font-size:12px;font-weight:500;" +
      "color:#853953;border:1px solid #853953;border-radius:6px;transition:background 0.15s;";
    startDiscussion.addEventListener("mouseenter", () => { startDiscussion.style.background = "#f9f0f4"; });
    startDiscussion.addEventListener("mouseleave", () => { startDiscussion.style.background = ""; });
    emptyState.appendChild(startDiscussion);

    scrollBody.appendChild(emptyState);
  }

  panel.appendChild(scrollBody);

  // Footer — always pinned at bottom, links to FLoRA Atlas for the article DOI
  if (articleDois.length > 0) {
    const footer = document.createElement("div");
    footer.style.cssText =
      "padding:10px 16px;display:flex;justify-content:flex-end;border-top:1px solid #e8e8e8;flex-shrink:0;";
    const openLink = document.createElement("a");
    openLink.href = `https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(articleDois[0])}`;
    openLink.target = "_blank";
    openLink.rel = "noopener";
    openLink.style.cssText =
      "all:unset;cursor:pointer;padding:6px 16px;font-size:12px;font-weight:500;" +
      "color:#fff;background:linear-gradient(135deg,#853953,#612D53);border-radius:6px;";
    openLink.textContent = "Open in FLoRA Atlas";
    footer.appendChild(openLink);
    panel.appendChild(footer);
  }

  // Toggle logic
  let isOpen = false;

  const openPanel = (): void => {
    // Clear animation fill so JS can freely control 'right'
    tab.style.animation = "none";
    isOpen = true;
    host.dataset.floraPanelOpen = "1";
    panel.style.transform = "translateX(0)";
    tab.style.right = `${PANEL_WIDTH}px`;
    arrow.style.transform = "rotate(180deg)";
    tab.setAttribute("aria-label", "Close FLoRA panel");
    const style = document.createElement("style");
    style.textContent = "#scite-popup,#unpaywall{z-index:2147483646 !important;}";
    (document.head ?? document.documentElement).appendChild(style);
  };

  const closePanel = (): void => {
    tab.style.animation = "none";
    isOpen = false;
    host.dataset.floraPanelOpen = "0";
    panel.style.transform = "translateX(100%)";
    tab.style.right = "0";
    arrow.style.transform = "rotate(0deg)";
    tab.setAttribute("aria-label", "Open FLoRA panel");
    const style = document.createElement("style");
    style.textContent = "#scite-popup,#unpaywall{z-index:2147483647 !important;}";
    (document.head ?? document.documentElement).appendChild(style);
  };

  // Use a shared didDrag flag so the click handler can tell drag from tap.
  // attachTabDrag (called inside setupTabPositioning) sets this via its own closure,
  // so we read it off the tab element via a data attribute instead.
  tab.addEventListener("click", () => {
    if (tab.dataset.dragged === "1") { tab.dataset.dragged = ""; return; }
    if (isOpen) closePanel(); else openPanel();
  });
  closeBtn.addEventListener("click", () => closePanel());

  host.appendChild(tab);
  host.appendChild(panel);
  document.body.appendChild(host);
  debugLog(`renderSidePanel: panel rendered (${references.length} reference row(s), reopened=${wasOpen})`);

  setupTabPositioning(tab);

  if (wasOpen) {
    // The panel was already open before this re-render (e.g. references
    // lazy-loaded and triggered a content refresh). Snap it straight to the
    // open position without the 0.3s slide-in — otherwise the user perceives
    // the panel as closing and reopening on every content update. Drop the
    // transition for one frame, set the open state, then restore it so future
    // user-driven open/close still animates.
    const savedTransition = panel.style.transition;
    panel.style.transition = "none";
    openPanel();
    // Force a reflow so the transition reset takes effect before re-enabling.
    void panel.offsetHeight;
    panel.style.transition = savedTransition;
  }
}

export function removeSidePanel(): void {
  cleanupTabPositioning();
  document.getElementById(PUBPEER_PANEL_ID)?.remove();
}

function isSafePubPeerUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "pubpeer.com" || parsed.hostname.endsWith(".pubpeer.com");
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────
// Retractions Banner
// ──────────────────────────────────────────────

const RETRACTS_MODAL_ID = "flora-retracts-modal";

export interface RetractsModalCallbacks {
    onDismiss: () => void;
    onSnooze: () => void;
}

export function renderRetractedBanner(
    matched: RetractionResponse[],
    callbacks?: RetractsModalCallbacks
): void {
    if (matched.length === 0) {
        removeRetractsModal();
        return;
    }
    if (document.getElementById(RETRACTS_MODAL_ID)) {
        return
    }
    const host = document.createElement("div");
    let entries = document.createElement(matched.length > 1 ? "ol" : "div");
    for (const m of matched) {
        let wrapper = document.createElement(matched.length > 1 ? "li" : "div");
        let link = document.createElement("a");
        link.href = `https://doi.org/${m.doi}`;
        link.innerText = m.originDoi;
        link.style.fontWeight = "normal";
        link.style.color = "#111";
        link.style.textDecoration = "none";
        link.style.display = "block";
        if (m != matched[0]) wrapper.style.marginTop = "8px";
        if (matched.length > 1) {
            wrapper.style.listStyleType = "bullet";
            wrapper.style.marginLeft = "12px";
        }
        wrapper.appendChild(link);
        entries.appendChild(wrapper);
    }
    host.id = RETRACTS_MODAL_ID;
    host.innerHTML = `
    <div role="dialog" aria-labelledby="flora-modal-title" style="
      position:fixed;top:60px;right:24px;z-index:2147483647;
      width:360px;background:#fff;border-radius:12px;
      box-shadow:0 8px 28px rgba(0,0,0,0.18),0 2px 8px rgba(0,0,0,0.08);
      font-family:'Google Sans',Roboto,-apple-system,sans-serif;
      overflow:hidden;animation:floraSlideIn 0.25s ease-out;
    ">
      <!-- header -->
      <div style="background:linear-gradient(135deg,#853953,#612D53);padding:14px 16px;display:flex;align-items:center;gap:10px;">
        <span style="
          background:rgba(255,255,255,0.2);color:#fff;font-weight:700;font-size:13px;
          padding:4px 10px;border-radius:6px;letter-spacing:0.3px;
        ">FLoRA</span>
        <span id="flora-modal-title" style="color:#fff;font-size:13px;font-weight:500;flex:1;">
          Caution &mdash; Retraction Alert
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
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" style="width:18px!important; height:18px!important; display: inline-block; vertical-align: text-bottom; margin-right:4px;"><path d="M320 64C334.7 64 348.2 72.1 355.2 85L571.2 485C577.9 497.4 577.6 512.4 570.4 524.5C563.2 536.6 550.1 544 536 544L104 544C89.9 544 76.8 536.6 69.6 524.5C62.4 512.4 62.1 497.4 68.8 485L284.8 85C291.8 72.1 305.3 64 320 64zM320 416C302.3 416 288 430.3 288 448C288 465.7 302.3 480 320 480C337.7 480 352 465.7 352 448C352 430.3 337.7 416 320 416zM320 224C301.8 224 287.3 239.5 288.6 257.7L296 361.7C296.9 374.2 307.4 384 319.9 384C332.5 384 342.9 374.3 343.8 361.7L351.2 257.7C352.5 239.5 338.1 224 319.8 224z"/></svg>
        Found a mention of <strong data-flora-doi-count style="color:#202124;">${matched.length} retraction${matched.length !== 1 ? "s" : ""}</strong> on this page.
        </div>
        <!-- list of entries -->
        <div style="font-size:13px;color:#3c4043;margin-bottom:14px;line-height:1.5;flex:1;background:#f9f0f4;border:1px solid #d4a5b8;border-radius:8px;
            padding:12px;text-align:left;max-height: 250px;overflow: auto">
        ${entries.outerHTML}
        </div>
      </div>  
      <!-- Footer -->
      <div style="padding:10px 16px 14px;display:flex;align-items:center;gap:8px;">
        <span style="display: flex;flex-grow: 1;"></span>
        <button class="flora-modal-dismiss" style="
          all:unset;cursor:pointer;padding:7px 18px;font-size:13px;font-weight:500;
          color:#fff;background:linear-gradient(135deg,#853953,#612D53);border-radius:6px;text-align:center;
        ">Close</button>
      </div>
    </div>
    <style>
      @keyframes floraSlideIn {
        from { opacity:0; transform:translateY(-8px); }
        to { opacity:1; transform:translateY(0); }
      }
    </style>`;
    document.body.appendChild(host);
    for (const el of host.querySelectorAll(".flora-modal-close, .flora-modal-dismiss")) {
        el.addEventListener("click", () => {
            removeRetractsModal();
            callbacks?.onDismiss();
        });
    }
}

export function removeRetractsModal(): void {
    document.getElementById(RETRACTS_MODAL_ID)?.remove();
}

