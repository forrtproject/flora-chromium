// Runs in the pubpeer.com iframe embedded in FLoRA's side panel. Separate from
// content-general so that script needn't be injected into every frame.

import {
    applyCommenterFilter,
    getHiddenCommenters,
    onHiddenCommentersChanged
} from "@shared/pubpeer-filter";

let hiddenCommenters: string[] = [];

const PANEL_CSS = "body.top-navigation{overflow:hidden!important;} nav, .breadcrumb, ol.breadcrumb, div.forum-sub-title, div.sticky.affix, div.sticky.affix-top, div.extension-installer.container, div.footer.fixed, div.page-component-up, a.forum-item-title { display: none !important; } div.vertical-timeline-block {margin:0 15px 0px 10px;} div.selected div {background-color: transparent!important;} div.wrapper {width: 500px!important;} ul.nav.nav-tabs>li>a{color:#fff!important;} ul.nav.nav-tabs>li:nth-child(2).active>a{color:#853953!important;} ul.nav.nav-tabs>li:nth-child(1).active>a{color:#853953!important;} .ibox-title div, .ibox-title strong, .ibox-title span, .ibox-title em, .ibox-content a{color:#853953!important;}  .all-user-footer div:nth-child(1){visibility:hidden;} .el-button{background-color:#853953!important; border-color:#853953!important;} .ibox-bordered:before{background-color:#853953!important;} .btn-link.manual-file-chooser-text{color:#853953!important;}  .el-button.el-button--text{background:transparent!important;border-color:transparent!important;color:#853953!important;}}";

// Top-level PubPeer browsing is left untouched — only the panel embed is styled.
if (window !== window.top) {
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    (document.head ?? document.documentElement).appendChild(style);
    window.parent.postMessage({type: "FLORA_PUBPEER_CSS_READY"}, "*");

    const stripCommentAccepted = (root: Node = document.body): void => {
        if (!root) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        while (walker.nextNode()) nodes.push(walker.currentNode as Text);
        for (const node of nodes) {
            if (/comment accepted /i.test(node.nodeValue ?? "")) {
                node.nodeValue = (node.nodeValue ?? "").replace(/comment accepted /gi, "");
            }
        }
    };

    const filterAll = (): void => applyCommenterFilter(document.body, hiddenCommenters);

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const n of m.addedNodes) {
                stripCommentAccepted(n);
                applyCommenterFilter(n, hiddenCommenters);
            }
        }
    });
    const startStripping = (): void => {
        stripCommentAccepted();
        filterAll();
        observer.observe(document.body, {childList: true, subtree: true});
    };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startStripping);
    } else {
        startStripping();
    }

    void getHiddenCommenters().then((ids) => {
        hiddenCommenters = ids;
        filterAll();
    });
    onHiddenCommentersChanged((ids) => {
        hiddenCommenters = ids;
        filterAll();
    });

    const sendHeight = (): void => {
        const h = Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight);
        window.parent.postMessage({type: "FLORA_PUBPEER_HEIGHT", height: h}, "*");
    };
    window.addEventListener("load", sendHeight);
    new ResizeObserver(sendHeight).observe(document.documentElement);
}
