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
});
