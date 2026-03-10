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
 */
export function normaliseDOI(raw: string): DoiString | null {
  let doi = raw.trim();

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
