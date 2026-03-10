import { describe, it, expect } from "vitest";
import { normaliseDOI } from "../../src/shared/doi-normalise";

describe("normaliseDOI", () => {
  it("returns bare DOI lowercased", () => {
    expect(normaliseDOI("10.1234/Example.Article")).toBe(
      "10.1234/example.article"
    );
  });

  it("strips https://doi.org/ prefix", () => {
    expect(normaliseDOI("https://doi.org/10.1000/test")).toBe("10.1000/test");
  });

  it("strips http://doi.org/ prefix", () => {
    expect(normaliseDOI("http://doi.org/10.1000/test")).toBe("10.1000/test");
  });

  it("strips https://dx.doi.org/ prefix", () => {
    expect(normaliseDOI("https://dx.doi.org/10.1000/test")).toBe(
      "10.1000/test"
    );
  });

  it("strips http://dx.doi.org/ prefix", () => {
    expect(normaliseDOI("http://dx.doi.org/10.1000/test")).toBe(
      "10.1000/test"
    );
  });

  it("strips doi: prefix", () => {
    expect(normaliseDOI("doi:10.1000/test")).toBe("10.1000/test");
  });

  it("handles mixed-case prefix", () => {
    expect(normaliseDOI("HTTPS://DOI.ORG/10.1000/Test")).toBe("10.1000/test");
  });

  it("trims whitespace", () => {
    expect(normaliseDOI("  10.1000/test  ")).toBe("10.1000/test");
  });

  it("lowercases the entire DOI", () => {
    expect(normaliseDOI("10.1038/Nature12373")).toBe("10.1038/nature12373");
  });

  it("handles long registrant codes", () => {
    expect(normaliseDOI("10.12345/long.path/sub")).toBe(
      "10.12345/long.path/sub"
    );
  });

  it("returns null for empty string", () => {
    expect(normaliseDOI("")).toBeNull();
  });

  it("returns null for random text", () => {
    expect(normaliseDOI("not a doi")).toBeNull();
  });

  it("returns null for DOI missing registrant (too few digits)", () => {
    expect(normaliseDOI("10.12/short")).toBeNull();
  });

  it("returns null for string starting with wrong prefix", () => {
    expect(normaliseDOI("11.1000/wrong")).toBeNull();
  });

  it("returns null for just a URL prefix with no DOI", () => {
    expect(normaliseDOI("https://doi.org/")).toBeNull();
  });
});
