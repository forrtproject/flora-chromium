import type { DoiString } from "./types";

const DOI_PREFIXES = [
  "https://doi.org/",
  "http://doi.org/",
  "https://dx.doi.org/",
  "http://dx.doi.org/",
  "doi:",
];

/**
 * Normalise a raw DOI string by stripping known prefixes and lowercasing.
 * Returns null if the input is not a valid DOI.
 *
 * Accepts `unknown` rather than `string` because callers feed values out of
 * JSON.parse (Crossref/OpenAlex/JSON-LD/cached storage) where the runtime
 * value can be a number, array, null, etc. even when typed as string.
 */
export function normaliseDOI(raw: unknown): DoiString | null {
  if (typeof raw !== "string") return null;
  let doi = raw.trim();

  // Decode percent-encoded DOIs (e.g. 10.1088%2F0960-1317%2F16%2F3%2F007)
  if (doi.includes("%")) {
    try {
      doi = decodeURIComponent(doi);
    } catch {
      // Invalid encoding — continue with raw value
    }
  }

  for (const prefix of DOI_PREFIXES) {
    if (doi.toLowerCase().startsWith(prefix)) {
      doi = doi.slice(prefix.length);
      break;
    }
  }

  // A valid DOI starts with "10." followed by a registrant code
  if (!/^10\.\d{4,}/.test(doi)) {
    return null;
  }

  return doi.toLowerCase() as DoiString;
}
