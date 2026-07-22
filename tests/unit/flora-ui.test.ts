import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isExternalMutation, isFloraOwnedNode } from "../../src/shared/flora-ui";
import { createIndicatorPill } from "../../src/shared/indicator-pill";
import type { DoiString } from "../../src/shared/types";

function mutation(target: Node, added: Node[]): MutationRecord {
  return { type: "childList", target, addedNodes: added as unknown as NodeList } as MutationRecord;
}

describe("isFloraOwnedNode", () => {
  it("recognises a flora- class and a flora- id", () => {
    const a = document.createElement("span");
    a.className = "flora-indicator-pill";
    const b = document.createElement("div");
    b.id = "flora-working-toast";
    expect(isFloraOwnedNode(a)).toBe(true);
    expect(isFloraOwnedNode(b)).toBe(true);
  });

  it("recognises an unclassed node inside a marked container", () => {
    // The regression: segments swapped into a pill when its async lookups land
    // carry no flora- class of their own.
    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-flora-ui", "");
    const seg = document.createElement("span");
    wrapper.appendChild(seg);
    expect(isFloraOwnedNode(seg)).toBe(true);
  });

  it("does not claim ordinary page nodes", () => {
    const el = document.createElement("div");
    el.className = "citation-content";
    document.body.appendChild(el);
    expect(isFloraOwnedNode(el)).toBe(false);
    el.remove();
  });
});

describe("isExternalMutation", () => {
  it("reports a genuine page insertion", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const added = document.createElement("p");
    expect(isExternalMutation(mutation(host, [added]))).toBe(true);
    host.remove();
  });

  it("ignores an insertion of FLoRA's own pill", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const pill = document.createElement("span");
    pill.className = "flora-indicator-pill";
    expect(isExternalMutation(mutation(host, [pill]))).toBe(false);
    host.remove();
  });

  it("ignores mutations inside a marked container", () => {
    const wrapper = document.createElement("span");
    wrapper.setAttribute("data-flora-ui", "");
    document.body.appendChild(wrapper);
    expect(isExternalMutation(mutation(wrapper, [document.createElement("span")]))).toBe(false);
    wrapper.remove();
  });

  it("ignores mutations with no added nodes", () => {
    expect(isExternalMutation(mutation(document.body, []))).toBe(false);
  });
});

// The scan loop this guards against: a pill's OA and PubPeer lookups resolve
// and swap in new segments. Those swaps used to read as page changes, which
// triggered a rescan, which rendered more pills, which fired more lookups.
describe("pill async updates do not read as page changes", () => {
  let observed: MutationRecord[];
  let observer: MutationObserver;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    })));
    observed = [];
    observer = new MutationObserver((records) => observed.push(...records));
    observer.observe(document.body, { childList: true, subtree: true });
  });

  afterEach(() => {
    observer.disconnect();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("treats no part of a pill's lifecycle as an external change", async () => {
    const entry = document.createElement("div");
    entry.className = "citation-content";
    document.body.appendChild(entry);
    // Records are delivered on a microtask — let the entry's own insertion land
    // before clearing, or it shows up later and pollutes the assertion.
    await new Promise((r) => setTimeout(r, 0));
    observed.length = 0;

    const pill = createIndicatorPill({
      doi: "10.1234/x" as DoiString,
      isAugmented: false,
      oaStatus: Promise.resolve({ isOa: true, url: "https://example.com" } as never),
    });
    entry.appendChild(pill);

    // Let the OA and PubPeer promises settle and swap their segments in.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 60));

    expect(observed.length).toBeGreaterThan(0); // the swaps really did happen
    expect(observed.filter(isExternalMutation)).toEqual([]);
  });
});
