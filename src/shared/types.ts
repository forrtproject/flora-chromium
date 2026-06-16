import { z } from "zod";

/** Branded type for normalised DOI strings */
export type DoiString = string & { readonly __brand: "DoiString" };

/** How the DOI was obtained */
export type DoiSource = "extracted" | "augmented";

/** Possible states for a DOI lookup */
export type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "matched"; result: ReplicationResult; source: DoiSource }
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

const AuthorSchema = z.object({
  sequence: z.string().nullable().optional(),
  given: z.string().nullable().optional(),
  family: z.string().nullable().optional(),
});

// FORRT sometimes returns a consortium/group name as a plain string instead of
// an author array (e.g. "Open Science Collaboration"). Normalise that to a
// single-author array so one such field can't fail the whole response parse.
const AuthorsField = z.preprocess(
  (val) => (typeof val === "string" ? [{ family: val }] : val),
  z.array(AuthorSchema)
);

/** A single replication or reproduction entry from the FORRT API */
export const ReplicationEntrySchema = z.object({
  doi: z.string().nullable().optional(),
  doi_hash: z.string().optional(),
  type: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  authors: AuthorsField.nullable().optional(),
  journal: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  volume: z.string().nullable().optional(),
  issue: z.string().nullable().optional(),
  pages: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  outcome_quote: z.string().nullable().optional(),
  outcome_quote_source: z.string().nullable().optional(),
});

export type ReplicationEntry = z.infer<typeof ReplicationEntrySchema>;

/** An original/target study entry (when the queried paper is itself a replication) */
export const OriginalEntrySchema = z.object({
  doi: z.string().nullable().optional(),
  doi_hash: z.string().optional(),
  title: z.string().nullable().optional(),
  authors: AuthorsField.nullable().optional(),
  journal: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  url: z.string().nullable().optional(),
});

export type OriginalEntry = z.infer<typeof OriginalEntrySchema>;

/** Zod schema for a single result from the FORRT replication API */
export const ReplicationResultSchema = z.object({
  doi: z.string(),
  types: z.array(z.string()).optional(),
  title: z.string().nullable(),
  authors: AuthorsField.nullable(),
  journal: z.string().nullable(),
  year: z.number().nullable(),
  url: z.string().nullable(),
  record: z.object({
    stats: StatsSchema,
    replications: z.array(ReplicationEntrySchema),
    reproductions: z.array(ReplicationEntrySchema).optional(),
    originals: z.array(OriginalEntrySchema),
  }),
});

export type ReplicationResult = z.infer<typeof ReplicationResultSchema>;

/** Cache entry with TTL tracking */
export interface CachedEntry<T> {
  data: T | null; // null = cached no-match
  expiresAt: number | null; // null = never expires
}

/** How a DOI was classified on the page */
export type DoiContext = "article" | "reference" | "other" | "retracted";

/** What kind of page we're on */
export type PageType = "article" | "listing" | "unknown";

/** DOIs grouped by where they were found on the page */
export interface ClassifiedDois {
  pageType: PageType;
  /** DOI(s) representing the current article — from URL, meta tags, or JSON-LD */
  articleDois: DoiString[];
  /** DOIs found inside reference/bibliography sections */
  referenceDois: DoiString[];
  /** All other DOIs found on the page */
  otherDois: DoiString[];
  /** All DOIs marked retracted*/
  retractedDois:DoiString[];
  /** Union of article + reference + other — every DOI found on the page. */
  allDois: DoiString[];
}
