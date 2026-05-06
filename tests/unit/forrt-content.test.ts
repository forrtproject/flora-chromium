import {describe, it, expect} from "vitest";
import {readFileSync} from "fs";
import {join} from "path";
import {JSDOM} from "jsdom";
import {main as ContentScriptMainLogic, INSTALL_BANNER_UUID} from "../../src/content-forrt"


function loadFixture(name: string): void {
    const html = readFileSync(
        join(__dirname, "..", "fixtures", name),
        "utf-8"
    );
    const dom =  new JSDOM(html, { url: "https://forrt.org/index.html" });
    global.window = dom.window as any;
    global.document = dom.window.document;
    global.NodeFilter = dom.window.NodeFilter;
    global.MutationObserver = dom.window.MutationObserver;
}

describe("FORRT content script", () => {
    it("removes installation banner", () => {
        loadFixture("forrt-website.html");

        const bannerPre = document.querySelector(INSTALL_BANNER_UUID);
        expect(bannerPre).not.toBeNull();
        ContentScriptMainLogic();

        const bannerPost = document.querySelector(INSTALL_BANNER_UUID);
        expect(bannerPost).toBeNull();
    });
})