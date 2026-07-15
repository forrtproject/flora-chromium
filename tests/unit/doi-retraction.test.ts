import {describe, it, expect, vi, beforeEach} from "vitest";
import {doi} from "../helpers";

// retractionCheck now runs in the content scripts purely as a thin client: it
// asks the background service worker (which owns the data) for a verdict. These
// tests pin that message contract; the lookup logic itself is covered by the
// service-worker tests.
describe("doi retraction content helper", () => {
    beforeEach(() => {
        vi.resetModules();
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockReset();
    });

    it("requests retraction checks from the background service worker", async () => {
        const originalDoi = doi("10.1038/nature12373");
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
            type: "FLORA_RET_CHECK_RESULT",
            results: [{originDoi: originalDoi, doi: "10.1038/retraction", kind: "retraction"}],
        });

        const {retractionCheck} = await import("../../src/shared/doi-retraction");
        const result = await retractionCheck([originalDoi]);

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            type: "FLORA_RET_CHECK",
            dois: [originalDoi],
        });
        expect(result).toEqual([
            {originDoi: originalDoi, doi: "10.1038/retraction", kind: "retraction"},
        ]);
    });

    it("passes expression-of-concern verdicts through unchanged", async () => {
        const originalDoi = doi("10.5678/eoc-paper");
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
            type: "FLORA_RET_CHECK_RESULT",
            results: [{originDoi: originalDoi, doi: "10.5678/eoc-notice", kind: "concern"}],
        });

        const {retractionCheck} = await import("../../src/shared/doi-retraction");
        await expect(retractionCheck([originalDoi])).resolves.toEqual([
            {originDoi: originalDoi, doi: "10.5678/eoc-notice", kind: "concern"},
        ]);
    });

    it("returns no retractions for unexpected responses", async () => {
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
            type: "FLORA_LOOKUP_RESULT",
            results: {},
            errors: {},
        });

        const {retractionCheck} = await import("../../src/shared/doi-retraction");
        await expect(retractionCheck([doi("10.1038/nature12373")])).resolves.toEqual([]);
    });
});

// Defence-in-depth: even if a retracted DOI is somehow anchored to an editable
// target, the placement layer must refuse to inject the notice pill so the
// markup is never serialized into the user's saved document.
describe("injectRetractionInfo editable-context guard", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = "";
    });

    const info = {
        originDoi: doi("10.1038/nature12373"),
        doi: doi("10.1038/retraction"),
        kind: "retraction" as const,
    };

    it("injects a notice pill for an ordinary target", async () => {
        document.body.innerHTML = `<p id="t">10.1038/nature12373</p>`;
        const {injectRetractionInfo} = await import("../../src/shared/doi-retraction");
        injectRetractionInfo(document.getElementById("t")!, info);
        expect(document.querySelector(".flora-notice-pill")).not.toBeNull();
    });

    it("refuses a contenteditable target", async () => {
        document.body.innerHTML = `<div contenteditable="true"><span id="t">10.1038/nature12373</span></div>`;
        const {injectRetractionInfo} = await import("../../src/shared/doi-retraction");
        injectRetractionInfo(document.getElementById("t")!, info);
        expect(document.querySelector(".flora-notice-pill")).toBeNull();
    });

    it("refuses a target inside a textarea", async () => {
        document.body.innerHTML = `<textarea><span id="t">x</span></textarea>`;
        const {injectRetractionInfo} = await import("../../src/shared/doi-retraction");
        const target = document.getElementById("t") ?? document.querySelector("textarea")!;
        injectRetractionInfo(target, info);
        expect(document.querySelector(".flora-notice-pill")).toBeNull();
    });
});
