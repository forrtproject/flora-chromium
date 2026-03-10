import { z } from "zod";

/** Branded type for normalised DOI strings */
export type DoiString = string & { readonly __brand: "DoiString" };

/** Possible states for a DOI lookup */
export type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "matched"; result: ReplicationResult }
  | { status: "no-match" }
  | { status: "error"; message: string };

/** Zod schema for replication stats from FORRT API */
const StatsSchema = z.object({
  n_replications_total: z.number(),
  n_replications_with_doi: z.number(),
  n_replications_only: z.number(),
  n_unique_replication_dois: z.number(),
  n_reproductions_total: z.number(),
  n_reproductions_with_doi: z.number(),
  n_reproductions_only: z.number(),
  n_originals_total: z.number(),
  n_unique_original_dois: z.number(),
});

/** Zod schema for a single result from the FORRT replication API */
export const ReplicationResultSchema = z.object({
  doi: z.string(),
  title: z.string().nullable(),
  authors: z.array(
    z.object({
      sequence: z.string().nullable().optional(),
      given: z.string().nullable().optional(),
      family: z.string().nullable().optional(),
    })
  ).nullable(),
  journal: z.string().nullable(),
  year: z.number().nullable(),
  url: z.string().nullable(),
  record: z.object({
    stats: StatsSchema,
    replications: z.array(z.unknown()),
    originals: z.array(z.unknown()),
  }),
});

export type ReplicationResult = z.infer<typeof ReplicationResultSchema>;

/** Zod schema for the full API response — keyed by DOI */
export const ApiResponseSchema = z.object({
  results: z.record(z.string(), ReplicationResultSchema.nullable()),
});

export type ApiResponse = z.infer<typeof ApiResponseSchema>;

/** Cache entry with TTL tracking */
export interface CachedEntry<T> {
  data: T;
  timestamp: number;
}
