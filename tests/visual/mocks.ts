// Hermetic mock data for the visual-regression harness.
//
// Nothing here touches the real network. Two mechanisms keep the harness
// deterministic:
//
//   1. Pre-seeded chrome.storage (see the buildLocalSeed / buildSyncSeed
//      builders). The service worker caches FLoRA replication lookups
//      (`LocalCache` prefix "flora"), the retraction map (`RET_MAP_KEY`), and
//      settings. Content-script page caches (BlobCache: doi.org validation,
//      PubPeer, Unpaywall) also live in chrome.storage.local. Seeding every
//      fixture DOI turns every lookup into a cache hit, so no request is ever
//      made for them.
//
//   2. Request interception. Page-context fetches (doi.org handle API,
//      PubPeer POST, Unpaywall) are served canned JSON; worker-context fetches
//      (FORRT rep-api, Crossref, OpenAlex, the GitHub retraction sync) are
//      failed via a CDP Fetch session on the service-worker target. Together
//      these guarantee pass/fail never depends on real network access.
//
// The exact storage shapes are read from the source of truth:
//   - LocalCache entry:      { data, expiresAt }          (src/shared/cache.ts)
//   - RetractionMaps:        { retractions, concerns }    (src/shared/data-extract.ts)
//   - BlobCache blob:        { [key]: { v, t } }           (src/shared/blob-cache.ts)
//   - FloraSettings:         flora_settings in storage.sync (src/shared/settings.ts)

// ── Fixture DOIs, one per replication "state" the UI can surface ────────────
// All lowercase — normaliseDOI() lowercases every DOI before lookup, and the
// FLoRA cache / retraction map are keyed on the normalised form.
export const DOIS = {
  /** Has replications + reproductions -> pink "FLoRA · N replications" badge. */
  replications: "10.5555/flora.repl.0001",
  /** Reproductions only -> badge with just the reproduction count. */
  reproductions: "10.5555/flora.repro.0002",
  /** Retracted -> red "Retracted" notice pill (and title pin on article pages). */
  retracted: "10.5555/flora.retr.0003",
  /** Expression of concern -> orange "Concern" notice pill. */
  concern: "10.5555/flora.conc.0004",
  /** Known DOI with no replication data and no notice -> no badge, no pill. */
  noData: "10.5555/flora.none.0005",
  /** A replication target used as the article DOI on some fixtures. */
  article: "10.5555/flora.article.0006",
} as const;

export type DoiKey = keyof typeof DOIS;

/**
 * DOIs that already appear in the reused unit-test fixtures
 * (tests/fixtures/*.html). Seeded so those fixtures render deterministic FLoRA
 * UI too, rather than silently touching the network.
 */
export const REUSED_DOIS = {
  cell: "10.1016/j.cell.2020.01.001", // doi-in-href -> replications
  pspa: "10.1037/pspa0000345", // doi-in-table -> reproductions
  psci: "10.1177/0956797620904990", // doi-in-table -> concern
  plosone: "10.1371/journal.pone.0012345", // doi-in-text / article-with-dois -> replications
  nature: "10.1038/nature12373", // article-with-dois article DOI -> replications
  scienceFake: "10.1126/science.9999999", // article-with-dois ref -> no data
  redactedArticle: "10.1007/s00500-023-07906-6", // redacted -> retracted (article)
} as const;

/** Every fixture DOI (values), for bulk seeding. */
export const ALL_DOIS: string[] = [
  ...Object.values(DOIS),
  ...Object.values(REUSED_DOIS),
];

// ── FLoRA replication results (FORRT rep-api shape -> ReplicationResultSchema) ─

interface Stats {
  n_replications_total: number;
  n_replications_with_doi: number;
  n_replications_only: number;
  n_unique_replication_dois: number;
  n_reproductions_total: number;
  n_reproductions_with_doi: number;
  n_reproductions_only: number;
  n_originals_total: number;
  n_unique_original_dois: number;
}

function stats(nRepl: number, nRepro: number, nOrig: number): Stats {
  return {
    n_replications_total: nRepl,
    n_replications_with_doi: nRepl,
    n_replications_only: 0,
    n_unique_replication_dois: nRepl,
    n_reproductions_total: nRepro,
    n_reproductions_with_doi: nRepro,
    n_reproductions_only: 0,
    n_originals_total: nOrig,
    n_unique_original_dois: nOrig,
  };
}

function replEntry(doi: string, title: string, year: number): unknown {
  return {
    doi,
    type: "replication",
    title,
    authors: [{ sequence: "first", given: "Robin", family: "Mock" }],
    journal: "Journal of Mock Studies",
    year,
    url: null,
    outcome: "success",
  };
}

/** A ReplicationResult (see src/shared/types.ts ReplicationResultSchema). */
function replicationResult(
  doi: string,
  title: string,
  nRepl: number,
  nRepro: number,
): unknown {
  return {
    doi,
    types: ["original"],
    title,
    authors: [{ sequence: "first", given: "Alex", family: "Author" }],
    journal: "Journal of Mock Studies",
    year: 2015,
    url: null,
    record: {
      stats: stats(nRepl, nRepro, 0),
      replications: Array.from({ length: nRepl }, (_, i) =>
        replEntry(`10.5555/repl.child.${i}`, `Replication study ${i + 1}`, 2018 + i),
      ),
      reproductions: Array.from({ length: nRepro }, (_, i) =>
        replEntry(`10.5555/repro.child.${i}`, `Reproduction study ${i + 1}`, 2019 + i),
      ),
      originals: [],
    },
  };
}

/**
 * Map of DOI -> cached ReplicationResult. DOIs with no real replication data
 * (retracted / concern / noData) still get a zero-stats record so the worker
 * lookup is a cache hit (no network) yet yields no badge.
 */
export const REPLICATION_DATA: Record<string, unknown> = {
  [DOIS.replications]: replicationResult(DOIS.replications, "A Highly Replicated Finding", 3, 1),
  [DOIS.reproductions]: replicationResult(DOIS.reproductions, "A Computationally Reproduced Analysis", 0, 2),
  [DOIS.article]: replicationResult(DOIS.article, "The Article Under Study", 2, 0),
  [DOIS.retracted]: replicationResult(DOIS.retracted, "A Retracted Paper", 0, 0),
  [DOIS.concern]: replicationResult(DOIS.concern, "A Paper Of Concern", 0, 0),
  [DOIS.noData]: replicationResult(DOIS.noData, "An Ordinary Paper", 0, 0),
  // Reused-fixture DOIs.
  [REUSED_DOIS.cell]: replicationResult(REUSED_DOIS.cell, "Cell Biology Study", 4, 0),
  [REUSED_DOIS.pspa]: replicationResult(REUSED_DOIS.pspa, "Social Psychology Study", 0, 2),
  [REUSED_DOIS.plosone]: replicationResult(REUSED_DOIS.plosone, "PLOS ONE Study", 2, 1),
  [REUSED_DOIS.nature]: replicationResult(REUSED_DOIS.nature, "Nature Study", 5, 0),
  // Zero-stats (cache hit, no badge) for the remaining reused DOIs.
  [REUSED_DOIS.psci]: replicationResult(REUSED_DOIS.psci, "Psychological Science Study", 0, 0),
  [REUSED_DOIS.scienceFake]: replicationResult(REUSED_DOIS.scienceFake, "Placeholder Study", 0, 0),
  [REUSED_DOIS.redactedArticle]: replicationResult(REUSED_DOIS.redactedArticle, "Retracted ML Study", 0, 0),
};

// ── Retraction map (src/shared/data-extract.ts RetractionMaps) ──────────────
export const RET_MAP_KEY = "RetractionLookupLocal";

export const RETRACTION_MAP = {
  retractions: {
    [DOIS.retracted]: "10.9999/retraction.notice.0003",
    [REUSED_DOIS.redactedArticle]: "10.9999/retraction.notice.redacted",
  },
  concerns: {
    [DOIS.concern]: "10.9999/concern.notice.0004",
    [REUSED_DOIS.psci]: "10.9999/concern.notice.psci",
  },
};

// ── Open Access statuses (Unpaywall -> BlobCache flora_oa_blob) ─────────────
// isOa:true surfaces a "Free" padlock link inside the DOI pill.
const OA_STATUS: Record<string, { isOa: boolean; url: string | null }> = {
  [DOIS.replications]: { isOa: true, url: "http://127.0.0.1/mock/free.pdf" },
  [DOIS.reproductions]: { isOa: false, url: null },
  [DOIS.retracted]: { isOa: false, url: null },
  [DOIS.concern]: { isOa: true, url: "http://127.0.0.1/mock/free.pdf" },
  [DOIS.noData]: { isOa: false, url: null },
  [DOIS.article]: { isOa: true, url: "http://127.0.0.1/mock/free.pdf" },
};

// ── Storage seed builders ───────────────────────────────────────────────────

const now = () => Date.now();

/** chrome.storage.local seed: FLoRA cache + retraction map + page BlobCaches. */
export function buildLocalSeed(): Record<string, unknown> {
  const seed: Record<string, unknown> = {};

  // FLoRA replication cache — LocalCache prefix "flora", entry { data, expiresAt }.
  // Every DOI resolves to a stored result (real data or a zero-stats record) so
  // the worker lookup is always a cache hit and never touches the network.
  for (const doi of ALL_DOIS) {
    const data = REPLICATION_DATA[doi] ?? replicationResult(doi, "Seeded Paper", 0, 0);
    seed[`flora:${doi}`] = { data, expiresAt: null };
  }

  // Retraction map + a fresh synctime so the weekly sync never fires.
  seed[RET_MAP_KEY] = RETRACTION_MAP;
  seed["synctime"] = now();

  // doi.org validation BlobCache — every fixture DOI is valid.
  const doival: Record<string, { v: { valid: boolean }; t: number }> = {};
  for (const doi of ALL_DOIS) doival[doi] = { v: { valid: true }, t: now() };
  seed["flora_doival_blob"] = doival;

  // PubPeer reference-DOI BlobCache — seed every DOI as "no comments" so the
  // batched reference lookup is a full cache hit (no POST).
  const pubpeer: Record<string, { v: { feedback: null }; t: number }> = {};
  for (const doi of ALL_DOIS) pubpeer[doi] = { v: { feedback: null }, t: now() };
  seed["flora_pubpeer_blob"] = pubpeer;

  // Unpaywall Open Access BlobCache (default: not open access).
  const oa: Record<string, { v: { isOa: boolean; url: string | null }; t: number }> = {};
  for (const doi of ALL_DOIS) oa[doi] = { v: OA_STATUS[doi] ?? { isOa: false, url: null }, t: now() };
  seed["flora_oa_blob"] = oa;

  return seed;
}

/** chrome.storage.sync seed: settings (email set -> setup complete, no prompt). */
export function buildSyncSeed(): Record<string, unknown> {
  return {
    flora_settings: {
      email: "visual-test@example.com",
      // Pill on every reference (even ones already showing a DOI) so the
      // DOI-pill widget is exercised across the fixtures.
      showDoiPillsOnAllReferences: true,
      cacheQuotaMb: 500,
    },
  };
}

// ── Request-interception responders ─────────────────────────────────────────

/** A canned HTTP response for a mocked external API. */
export interface MockResponse {
  status: number;
  contentType: string;
  body: string;
}

/**
 * Decide how to answer a page-context request. Returns a canned response for
 * the known external APIs, "allow" for localhost, or "abort" for anything
 * else so a stray external request can never reach the network.
 */
export function classifyPageRequest(url: string): MockResponse | "allow" | "abort" {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return "abort";
  }

  if (host.startsWith("127.0.0.1") || host.startsWith("localhost")) return "allow";

  // doi.org Handle API — every DOI resolves (responseCode 1).
  if (host === "doi.org" && url.includes("/api/handles/")) {
    return { status: 200, contentType: "application/json", body: JSON.stringify({ responseCode: 1, values: [] }) };
  }

  // PubPeer publications POST — no feedback for anything.
  if (host === "pubpeer.com") {
    return { status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", feedbacks: [] }) };
  }

  // Unpaywall — report not open access (pills are seeded from the blob cache;
  // this is only a safety net for an unseeded DOI).
  if (host === "api.unpaywall.org") {
    return { status: 200, contentType: "application/json", body: JSON.stringify({ is_oa: false, best_oa_location: null }) };
  }

  return "abort";
}

/** Worker-context hosts that must never hit the network (failed via CDP Fetch). */
export function isBlockedWorkerHost(url: string): boolean {
  try {
    const host = new URL(url).host;
    return (
      host === "rep-api.forrt.org" ||
      host === "api.crossref.org" ||
      host === "api.openalex.org" ||
      host === "raw.githubusercontent.com" ||
      host === "docs.google.com"
    );
  } catch {
    return false;
  }
}
