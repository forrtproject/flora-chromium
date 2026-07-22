import {afterEach, describe, expect, it, vi} from "vitest";

const KEY = "flora_hidden_pubpeer_commenters";

describe("pubpeer commenter filter", () => {
  afterEach(() => {
    vi.resetModules();
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockReset();
    (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mockReset();
  });

  it("defaults to muting FORRT when nothing is stored", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const {getHiddenCommenters} = await import("../../src/shared/pubpeer-filter");

    await expect(getHiddenCommenters()).resolves.toEqual(["FORRT"]);
  });

  it("returns the stored list when the user has customised it", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      [KEY]: ["FORRT", "Noisy Reviewer"],
    });

    const {getHiddenCommenters} = await import("../../src/shared/pubpeer-filter");

    await expect(getHiddenCommenters()).resolves.toEqual(["FORRT", "Noisy Reviewer"]);
  });

  it("honours an explicitly empty list instead of re-applying the default", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({[KEY]: []});

    const {getHiddenCommenters} = await import("../../src/shared/pubpeer-filter");

    await expect(getHiddenCommenters()).resolves.toEqual([]);
  });

  it("caches reads within a module lifecycle", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({[KEY]: ["FORRT"]});

    const {getHiddenCommenters} = await import("../../src/shared/pubpeer-filter");

    await getHiddenCommenters();
    await getHiddenCommenters();
    expect(chrome.storage.sync.get).toHaveBeenCalledTimes(1);
  });

  it("updates the cache when the list is saved", async () => {
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({[KEY]: ["FORRT"]});
    (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const {getHiddenCommenters, saveHiddenCommenters} = await import(
      "../../src/shared/pubpeer-filter"
    );

    await saveHiddenCommenters(["Someone Else"]);
    await expect(getHiddenCommenters()).resolves.toEqual(["Someone Else"]);
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({[KEY]: ["Someone Else"]});
  });

  describe("isHiddenCommenter", () => {
    it("matches regardless of case or surrounding whitespace", async () => {
      const {isHiddenCommenter} = await import("../../src/shared/pubpeer-filter");

      expect(isHiddenCommenter("forrt", ["FORRT"])).toBe(true);
      expect(isHiddenCommenter("  FORRT  ", ["forrt"])).toBe(true);
    });

    it("does not match unrelated commenters", async () => {
      const {isHiddenCommenter} = await import("../../src/shared/pubpeer-filter");

      expect(isHiddenCommenter("Anolis Jacare", ["FORRT"])).toBe(false);
    });

    it("is false for a blank id and for an empty list", async () => {
      const {isHiddenCommenter} = await import("../../src/shared/pubpeer-filter");

      expect(isHiddenCommenter("   ", ["FORRT"])).toBe(false);
      expect(isHiddenCommenter("FORRT", [])).toBe(false);
    });
  });

  describe("applyCommenterFilter", () => {
    // Mirrors real PubPeer markup: `.inner-id` is the comment NUMBER, and the
    // commenter is the following bare <strong> (wrapped in <em> when
    // pseudonymous). Captured from a live thread.
    function comment(id: string, num: string, name: string, pseudonymous = false): string {
      const inner = pseudonymous ? `<em>${name}</em>` : `${name} `;
      return `
        <div id="${id}" class="vertical-timeline-content ibox float-e-margins">
          <div>
            <div class="ibox-title">
              <div class="left">
                <strong id="${num}" class="inner-id">#${num}</strong>
                <strong>${inner}</strong>
                <div><span>comment accepted July 2026</span></div>
              </div>
            </div>
          </div>
          <div class="ibox-content markdown-body"><p>Comment body.</p></div>
        </div>`;
    }

    function thread(): void {
      document.body.innerHTML =
        comment("c1", "1", "FORRT") +
        comment("c2", "2", "Anolis Jacare", true);
    }

    const displayOf = (id: string): string =>
      (document.getElementById(id) as HTMLElement).style.display;

    it("hides only the muted commenter's comment block", async () => {
      const {applyCommenterFilter} = await import("../../src/shared/pubpeer-filter");
      thread();

      applyCommenterFilter(document.body, ["FORRT"]);

      expect(displayOf("c1")).toBe("none");
      expect(displayOf("c2")).toBe("");
    });

    it("restores a comment when its commenter is unmuted", async () => {
      const {applyCommenterFilter} = await import("../../src/shared/pubpeer-filter");
      thread();

      applyCommenterFilter(document.body, ["FORRT"]);
      applyCommenterFilter(document.body, []);

      expect(displayOf("c1")).toBe("");
      expect(document.getElementById("c1")!.hasAttribute("data-flora-hidden-commenter")).toBe(false);
    });

    it("hides a newly muted commenter without touching the rest", async () => {
      const {applyCommenterFilter} = await import("../../src/shared/pubpeer-filter");
      thread();

      applyCommenterFilter(document.body, ["FORRT"]);
      applyCommenterFilter(document.body, ["FORRT", "Anolis Jacare"]);

      expect(displayOf("c1")).toBe("none");
      expect(displayOf("c2")).toBe("none");
    });

    it("leaves comments hidden by the page itself alone when unmuting", async () => {
      const {applyCommenterFilter} = await import("../../src/shared/pubpeer-filter");
      thread();
      // Not hidden by FLoRA — no marker attribute, so it must not be revealed.
      (document.getElementById("c2") as HTMLElement).style.display = "none";

      applyCommenterFilter(document.body, []);

      expect(displayOf("c2")).toBe("none");
    });

    it("does not mute on the comment number", async () => {
      const {applyCommenterFilter} = await import("../../src/shared/pubpeer-filter");
      thread();

      // "1" is the .inner-id of comment c1 — muting it must hide nothing.
      applyCommenterFilter(document.body, ["1"]);

      expect(displayOf("c1")).toBe("");
      expect(displayOf("c2")).toBe("");
    });

    it("ignores the reply editor, which shares the comment block class", async () => {
      const {applyCommenterFilter} = await import("../../src/shared/pubpeer-filter");
      document.body.innerHTML = `
        <div id="editor" class="vertical-timeline-content">
          <div class="ibox-content ibox-bordered"><div id="comment-editor"></div></div>
        </div>`;

      applyCommenterFilter(document.body, ["FORRT"]);

      expect(displayOf("editor")).toBe("");
    });

    it("filters a comment block passed directly as the root", async () => {
      const {applyCommenterFilter} = await import("../../src/shared/pubpeer-filter");
      thread();

      applyCommenterFilter(document.getElementById("c1"), ["FORRT"]);

      expect(displayOf("c1")).toBe("none");
    });

    it("is a no-op for a null root", async () => {
      const {applyCommenterFilter} = await import("../../src/shared/pubpeer-filter");

      expect(() => applyCommenterFilter(null, ["FORRT"])).not.toThrow();
    });
  });
});
