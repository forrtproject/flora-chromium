// Sanity-checks the jumbled publisher fixtures: confirms DOM structure the
// extension relies on survived the jumble (DOI metas, reference containers,
// DOI links) and that no obviously-real prose remains.
//
// Run:  npx tsx scripts/verify-fixtures.ts

import { JSDOM } from "jsdom";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const DIR = "tests/fixtures/publishers";
const SECTION_RE = /^(?:cites|citations|bibliography|bibliographies|references|reflist|ref-list|works-cited|footnotes|cited-by(?:__[\w-]+)?)$/i;
const CLASS_RE = /^[a-z]+(?:-[a-z]+)*-references$/i;
const DOI_RE = /10\.\d{4,}\//;

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".html"))) {
  const doc = new JSDOM(readFileSync(join(DIR, f), "utf8")).window.document;

  const cdoi =
    doc.querySelector('meta[name="citation_doi"]')?.getAttribute("content") ||
    doc.querySelector('meta[name="DOI"]')?.getAttribute("content") ||
    "(none)";

  const containers: Element[] = [];
  for (const el of doc.querySelectorAll("[class],[id]")) {
    const cls = typeof el.className === "string" ? el.className : "";
    let match = cls.split(/\s+/).some((t) => t && (SECTION_RE.test(t) || CLASS_RE.test(t)));
    if (el.id && SECTION_RE.test(el.id)) match = true;
    if (match) containers.push(el);
  }
  const outer = containers.filter((el) => !containers.some((o) => o !== el && o.contains(el)));
  const entries = outer.reduce(
    (n, el) => n + [...el.querySelectorAll("li")].filter((li) => !li.querySelector("li")).length,
    0
  );
  const doiLinks = [...doc.querySelectorAll("a[href]")].filter((a) =>
    DOI_RE.test(decodeURIComponent(a.getAttribute("href") || ""))
  ).length;
  const sample = (doc.body?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100);

  console.log(
    `\n${f}  (${(statSync(join(DIR, f)).size / 1024) | 0} KB)\n` +
      `  citation_doi   : ${cdoi}\n` +
      `  ref containers : ${outer.length}  (${outer.map((e) => e.tagName + "." + (typeof e.className === "string" ? e.className.split(/\s+/)[0] : "")).join(", ")})\n` +
      `  ref entries    : ${entries}\n` +
      `  DOI links      : ${doiLinks}\n` +
      `  text sample    : ${sample}`
  );
}
