import {describe, it, expect, vi, beforeEach} from "vitest";
import {readFileSync} from "fs";
import {join} from "path";
import {JSDOM} from "jsdom";
import {LookupRequest, LookupResponse} from "../../src/shared/messages";
import {mockResult} from "../helpers";

const MOCK_RESULT = mockResult();

describe("scholar observer", () => {
    beforeEach(async () => {
        vi.resetModules();
        const html = readFileSync(
            join(__dirname, "..", "fixtures", "scholar-results.html"),
            "utf-8"
        );
        const dom = new JSDOM(html);
        document.body.innerHTML = dom.window.document.body.innerHTML;
        const mockResponse: LookupResponse = {
            type: "FLORA_LOOKUP_RESULT",
            results: {
                "10.1038/nature12373": MOCK_RESULT,
            },
            errors: {},
        };
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(
            mockResponse
        );
        const {processScholarResults} = await import(
            "../../src/content-scholar/observer"
            );
        await processScholarResults(document);
    });

    it("processes Scholar result rows and sends lookup request", async () => {
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "FLORA_LOOKUP",
                dois: expect.arrayContaining(["10.1038/nature12373"]),
            })
        );
    });

    it("marks rows as processed to avoid re-processing", async () => {
        const {processScholarResults} = await import("../../src/content-scholar/observer");
        const processedRows = document.querySelectorAll("[data-flora-processed]");
        expect(processedRows.length).toBeGreaterThan(0);
        (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockClear();
        await processScholarResults(document);
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it("extracts DOI from title link href", async () => {
        const call = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls
            .find(args => args[0]?.type === "FLORA_LOOKUP")?.[0] as LookupRequest | undefined;
        expect(call).to.not.be.undefined;
        if (call) expect(call.dois).toContain("10.1038/nature12373");
    });

    it("extracts DOI from author line text", async () => {
        const call = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls
            .find(args => args[0]?.type === "FLORA_LOOKUP")?.[0] as LookupRequest | undefined;
        expect(call).to.not.be.undefined;
        if (call) expect(call.dois).toContain("10.1126/science.9999999");
    });
});
