// Jumbles the publisher HTML fixtures in tests/fixtures/publishers so they can
// be committed and used for automated testing without carrying copyrighted
// text. Every human-readable letter is swapped for a deterministic random
// letter; structure, class/id/data attributes, links, DOIs, digits and
// punctuation are all preserved, so the extension's extraction logic
// (meta tags, reference containers, DOI links, citation text) is exercised
// exactly as on the real page — but no original prose survives.
//
// Run:  npx tsx scripts/jumble-fixtures.ts

import { JSDOM } from "jsdom";
import { readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";

const DIR = "tests/fixtures/publishers";

/** Deterministic PRNG (mulberry32) so re-runs produce identical output. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = LOWER.toUpperCase();

// DOI tokens must survive verbatim — finding them is the extension's whole job.
const DOI_RE = /10\.\d{4,}\/[^\s"'<>)\]]+/g;

/** Replace [a-z]/[A-Z] with random letters; keep digits, punctuation, space. */
function scramble(s: string, rng: () => number): string {
  let out = "";
  for (const ch of s) {
    if (ch >= "a" && ch <= "z") out += LOWER[Math.floor(rng() * 26)];
    else if (ch >= "A" && ch <= "Z") out += UPPER[Math.floor(rng() * 26)];
    else out += ch;
  }
  return out;
}

/** Jumble text but leave any embedded DOI token untouched. */
function jumble(text: string, rng: () => number): string {
  if (!text) return text;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(DOI_RE)) {
    out += scramble(text.slice(last, m.index!), rng);
    out += m[0];
    last = m.index! + m[0].length;
  }
  out += scramble(text.slice(last), rng);
  return out;
}

// Attributes whose values are human-readable and must be jumbled.
const TEXT_ATTRS = ["alt", "title", "aria-label", "placeholder"];

function processFile(file: string): void {
  const path = join(DIR, file);
  const before = statSync(path).size;
  const dom = new JSDOM(readFileSync(path, "utf8"));
  const doc = dom.window.document;
  const rng = makeRng(0x5f10a);

  // Strip noise that bloats the fixture and is irrelevant to extraction.
  for (const el of doc.querySelectorAll("script,style,noscript,link,svg,iframe,template")) {
    el.remove();
  }

  // Strip FLoRA's own injected DOM — these pages were captured with the
  // extension running, so they carry its pills, panels and markers. A fixture
  // must be the pristine publisher page the extension would actually see.
  for (const el of doc.querySelectorAll(
    ".flora-doi-label,.flora-inline-badge,.flora-retracted-pill," +
      "#flora-pubpeer-panel,#flora-banner-host,#flora-setup-prompt," +
      "#flora-sheets-modal,#flora-retracts-modal"
  )) {
    el.remove();
  }
  for (const el of doc.querySelectorAll("[data-flora-ref-processed],[flora-ret-checked]")) {
    el.removeAttribute("data-flora-ref-processed");
    el.removeAttribute("flora-ret-checked");
  }
  // Strip HTML comments.
  const commentWalker = doc.createTreeWalker(doc, 128 /* SHOW_COMMENT */);
  const comments: Node[] = [];
  while (commentWalker.nextNode()) comments.push(commentWalker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);

  // Drop base64 image payloads (huge, irrelevant).
  for (const el of doc.querySelectorAll<HTMLElement>("[src],[srcset]")) {
    for (const a of ["src", "srcset"]) {
      const v = el.getAttribute(a);
      if (v && v.trimStart().startsWith("data:")) el.setAttribute(a, "");
    }
  }

  // Jumble every text node.
  const textWalker = doc.createTreeWalker(doc.body ?? doc, 4 /* SHOW_TEXT */);
  const texts: Text[] = [];
  while (textWalker.nextNode()) texts.push(textWalker.currentNode as Text);
  for (const t of texts) t.data = jumble(t.data, rng);

  // Jumble human-readable attributes. Keep class/id/href/name/rel/etc. intact.
  for (const el of doc.querySelectorAll<HTMLElement>("*")) {
    // <meta> content: keep DOI/identifier values verbatim, jumble the rest.
    if (el.tagName === "META") {
      const key = (el.getAttribute("name") || el.getAttribute("property") || "").toLowerCase();
      const content = el.getAttribute("content");
      if (content && !/doi|identifier/.test(key)) {
        el.setAttribute("content", jumble(content, rng));
      }
    }
    for (const attr of TEXT_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) el.setAttribute(attr, jumble(v, rng));
    }
    // data-* values may carry titles/labels; jumble() keeps any DOI intact.
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith("data-") && attr.value) {
        el.setAttribute(attr.name, jumble(attr.value, rng));
      }
    }
  }

  const html = "<!doctype html>\n" + doc.documentElement.outerHTML;
  writeFileSync(path, html, "utf8");
  const after = Buffer.byteLength(html);
  const doiMetas = [...doc.querySelectorAll("meta")].filter((m) =>
    /doi|identifier/.test((m.getAttribute("name") || m.getAttribute("property") || "").toLowerCase())
  );
  const doiLinks = [...doc.querySelectorAll("a[href]")].filter((a) =>
    DOI_RE.test(a.getAttribute("href") || "")
  ).length;
  console.log(
    `${file}: ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB | ` +
      `doi-metas=${doiMetas.length} doi-links=${doiLinks}`
  );
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".html"));
if (files.length === 0) {
  console.error(`No .html files in ${DIR}`);
  process.exit(1);
}
for (const f of files) processFile(f);
console.log(`Jumbled ${files.length} fixture(s).`);
