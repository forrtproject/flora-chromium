import type { LookupState } from "../shared/types";
import styles from "./styles.css";

const BADGE_HOST_CLASS = "flora-scholar-badge-host";

export function renderScholarBadge(
  row: HTMLElement,
  state: LookupState
): void {
  if (state.status !== "matched") return;
  if (row.querySelector(`.${BADGE_HOST_CLASS}`)) return;

  const r = state.result;
  const stats = r.record.stats;

  const hasData = stats.n_replications_total > 0
    || stats.n_reproductions_total > 0
    || stats.n_originals_total > 0;
  if (!hasData) return;

  const badgeClass = stats.n_replications_total > 0 || stats.n_reproductions_total > 0
    ? "badge--success"
    : "badge--neutral";

  // Place badge on the right side (PDF area), falling back to .gs_ri or row
  const target = row.querySelector(".gs_ggs") ?? row.querySelector(".gs_ri") ?? row;

  const host = document.createElement("div");
  host.className = BADGE_HOST_CLASS;

  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  shadow.appendChild(styleEl);

  const replLabel = stats.n_replications_total === 1 ? "replication" : "replications";
  const reproLabel = stats.n_reproductions_total === 1 ? "reproduction" : "reproductions";
  const origLabel = stats.n_originals_total === 1 ? "original" : "originals";

  const badge = document.createElement("a");
  badge.className = `flora-scholar-badge ${badgeClass}`;
  badge.href = `https://forrt.org/fred_repl_landing_page/?doi=${encodeURIComponent(r.doi)}`;
  badge.target = "_blank";
  badge.rel = "noopener";
  badge.innerHTML = `
    <span class="badge-label">FLoRA</span>
    ${stats.n_replications_total > 0 ? `<span class="badge-count">${stats.n_replications_total} ${replLabel}</span>` : ""}
    ${stats.n_reproductions_total > 0 ? `<span class="badge-count">${stats.n_reproductions_total} ${reproLabel}</span>` : ""}
    ${stats.n_originals_total > 0 ? `<span class="badge-count">${stats.n_originals_total} ${origLabel}</span>` : ""}
  `;

  shadow.appendChild(badge);
  target.appendChild(host);
}
