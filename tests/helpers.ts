import type { DoiString, ReplicationResult, ReplicationEntry, OriginalEntry } from "../src/shared/types";

export function doi(s: string): DoiString {
  return s as DoiString;
}

export function mockEntry(overrides: Partial<ReplicationEntry> = {}): ReplicationEntry {
  return {
    doi: "10.1000/mock.replication",
    type: "replication",
    title: "Mock Replication Study",
    authors: [{ sequence: "first", given: "Alice", family: "Smith" }],
    journal: "Mock Journal",
    year: 2022,
    outcome: "failed",
    outcome_quote: "We were unable to replicate the original findings.",
    ...overrides,
  };
}

export function mockOriginal(overrides: Partial<OriginalEntry> = {}): OriginalEntry {
  return {
    doi: "10.1000/mock.original",
    title: "Mock Original Study",
    authors: [{ sequence: "first", given: "Bob", family: "Jones" }],
    journal: "Original Journal",
    year: 2018,
    ...overrides,
  };
}

export function mockResult(
  overrides: Partial<ReplicationResult> = {}
): ReplicationResult {
  return {
    doi: "10.1038/nature12373",
    title: "Test Article",
    authors: [{ sequence: "first", given: "Jane", family: "Doe" }],
    journal: "Nature",
    year: 2020,
    url: "https://forrt.org/replication/10.1038/nature12373",
    record: {
      stats: {
        n_replications_total: 3,
        n_replications_with_doi: 2,
        n_replications_only: 1,
        n_unique_replication_dois: 2,
        n_reproductions_total: 1,
        n_reproductions_with_doi: 1,
        n_reproductions_only: 0,
        n_originals_total: 1,
        n_unique_original_dois: 1,
      },
      replications: [],
      reproductions: [],
      originals: [],
    },
    ...overrides,
  };
}
