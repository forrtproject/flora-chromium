import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createIndicatorPill } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

// Provenance is signalled inside the pill, not by its colour.
describe("indicator pill provenance", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });
  afterEach(() => vi.unstubAllGlobals());

  const build = (isAugmented: boolean) =>
    createIndicatorPill({ doi: "10.1234/x" as DoiString, isAugmented });

  const background = (wrapper: HTMLElement) =>
    (wrapper.firstElementChild as HTMLElement).style.background;

  it("uses the same background for confirmed and unconfirmed DOIs", () => {
    expect(background(build(true))).toBe(background(build(false)));
  });

  it("underlines the unconfirmed DOI and omits the check", () => {
    const seg = build(true).querySelector("[data-flora-doi-segment]") as HTMLElement;
    expect(seg.style.textDecoration).toContain("underline");
    expect(seg.querySelector("svg")).toBeNull();
    expect(seg.textContent).toContain("DOI");
  });

  it("shows a check and no underline on a confirmed DOI", () => {
    const seg = build(false).querySelector("[data-flora-doi-segment]") as HTMLElement;
    expect(seg.style.textDecoration).not.toContain("underline");
    expect(seg.querySelector("svg")).not.toBeNull();
  });

  it("lists every free copy outright in the popover", async () => {
    // The popover has room the Scholar panel does not, so nothing is folded.
    const pill = createIndicatorPill({
      doi: "10.1234/x" as DoiString,
      oaStatus: Promise.resolve({
        isOa: true,
        url: "https://publisher.example/a.pdf",
        locations: [
          { url: "https://publisher.example/a.pdf", label: "Publisher", version: "published", isPdf: true },
          { url: "https://osf.example/a", label: "OSF", version: "submitted", isPdf: false },
          { url: "https://repo.example/a.pdf", label: "Repo Uni", version: "accepted", isPdf: true },
        ],
      }),
    });

    await vi.waitFor(() =>
      expect(pill.querySelector("[data-flora-oa-choices]")).not.toBeNull()
    );
    const list = pill.querySelector<HTMLElement>("[data-flora-oa-row] > div:last-child")!;
    expect(list.style.display).toBe("flex");
    expect([...list.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "https://publisher.example/a.pdf",
      "https://osf.example/a",
      "https://repo.example/a.pdf",
    ]);
  });

  it("spells provenance out in the popover too, not just the compact segment", () => {
    const provenance = (isAugmented: boolean) =>
      build(isAugmented).querySelector("[data-flora-doi-provenance]")!.textContent;
    expect(provenance(false)).toBe("Found on this page");
    expect(provenance(true)).toBe("Matched by title");
  });
});
