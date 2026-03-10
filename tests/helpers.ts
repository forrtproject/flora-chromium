import type { DoiString, ReplicationResult } from "../src/shared/types";

export function doi(s: string): DoiString {
  return s as DoiString;
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
      originals: [],
    },
    ...overrides,
  };
}
