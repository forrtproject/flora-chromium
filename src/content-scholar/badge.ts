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

  // Only show the badge when there are actual replications or reproductions
  const hasReplicationData = stats.n_replications_total > 0 || stats.n_reproductions_total > 0;
  if (!hasReplicationData) return;

  // Place badge in the right-side PDF area; create one if absent to match Scholar's layout
  let target = row.querySelector(".gs_ggs");
  if (!target) {
    target = document.createElement("div");
    target.className = "gs_ggs gs_fl";
    const gsRi = row.querySelector(".gs_ri");
    row.insertBefore(target, gsRi);
  }

  const host = document.createElement("div");
  host.className = BADGE_HOST_CLASS;

  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  shadow.appendChild(styleEl);

  const replLabel = stats.n_replications_total === 1 ? "replication" : "replications";
  const reproLabel = stats.n_reproductions_total === 1 ? "reproduction" : "reproductions";

  const badge = document.createElement("a");
  badge.className = "flora-scholar-badge badge--success";
  badge.href = `https://forrt.org/flora-replication-atlas/?doi=${encodeURIComponent(r.doi)}`;
  badge.target = "_blank";
  badge.rel = "noopener";
  badge.innerHTML = `
    <span class="badge-label">FLoRA</span>
    ${stats.n_replications_total > 0 ? `<span class="badge-count">${stats.n_replications_total} ${replLabel}</span>` : ""}
    ${stats.n_reproductions_total > 0 ? `<span class="badge-count">${stats.n_reproductions_total} ${reproLabel}</span>` : ""}
  `;

  shadow.appendChild(badge);
  target.appendChild(host);
}
