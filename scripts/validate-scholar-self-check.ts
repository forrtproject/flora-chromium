import {readFile, writeFile, mkdir} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import type {DoiString} from "../src/shared/types";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH =
    process.env.SCHOLAR_MANIFEST ??
    resolve(REPO_ROOT, "tests/fixtures/scholar-live/manifest.json");
const OUT_PATH =
    process.env.OUT_PATH ??
    "docs/scholar-self-check-validation.json";
const EMAIL = process.env.FLORA_API_EMAIL ?? "flora@replications.forrt.org";
const SEQUENTIAL = process.env.SEQUENTIAL === "1";

interface Manifest {
    snapshots: Array<{
        file: string;
        query: string;
        rows: Array<{
            index: number;
            title: string;
            byline: string;
            href: string | null;
            extractedDoi: string | null;
        }>;
    }>;
}

interface RowCase {
    sourceFile: string;
    query: string;
    index: number;
    title: string;
    byline: string;
    href: string | null;
    expectedDoi: string;
    firstAuthor: string | null;
    year: number | null;
}

function extractMetadata(byline: string): {firstAuthor: string | null; year: number | null} {
    const beforeSource = byline.split(" - ")[0] ?? "";
    const firstAuthorText = beforeSource.split(",")[0]?.replace(/…/g, "").trim() ?? "";
    const authorTokens = firstAuthorText
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .filter((token) => token && !/^[A-Z]\.?$/i.test(token));
    const firstAuthor = authorTokens[authorTokens.length - 1] ?? null;
    const yearMatch = byline.match(/\b((?:19|20)\d{2})\b/);
    return {
        firstAuthor,
        year: yearMatch ? Number(yearMatch[1]) : null,
    };
}

function cleanExpectedDoi(raw: string, normaliseDOI: (raw: string) => DoiString | null): string {
    const normalized = normaliseDOI(raw) ?? raw.toLowerCase();
    return normalized
        .replace(/\/(?:full|abstract|short|metrics?)$/i, "")
        .replace(/\/fulltext$/i, "");
}

function installChromeMock(): void {
    const localStore: Record<string, unknown> = {};
    globalThis.chrome = {
        storage: {
            sync: {
                get: async () => ({flora_settings: {email: EMAIL}}),
                set: async () => undefined,
            },
            local: {
                get: async (keys: string[] | string) => {
                    const wanted = Array.isArray(keys) ? keys : [keys];
                    return Object.fromEntries(wanted.map((key) => [key, localStore[key]]));
                },
                set: async (entries: Record<string, unknown>) => {
                    Object.assign(localStore, entries);
                },
            },
            onChanged: {
                addListener: () => undefined,
            },
        },
    } as typeof chrome;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
    installChromeMock();
    const {augmentDOIs} = await import("../src/shared/doi-augment");
    const {normaliseDOI} = await import("../src/shared/doi-normalise");

    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Manifest;
    const cases: RowCase[] = manifest.snapshots.flatMap((snapshot) =>
        snapshot.rows
            .filter((row) => row.extractedDoi)
            .map((row) => {
                const metadata = extractMetadata(row.byline);
                return {
                    sourceFile: snapshot.file,
                    query: snapshot.query,
                    index: row.index,
                    title: row.title,
                    byline: row.byline,
                    href: row.href,
                    expectedDoi: cleanExpectedDoi(row.extractedDoi!, normaliseDOI),
                    ...metadata,
                };
            }),
    );

    const augmented = new Map<string, DoiString | null>();
    if (SEQUENTIAL) {
        for (const row of cases) {
            const result = await augmentDOIs([{
                title: row.title,
                firstAuthor: row.firstAuthor,
                year: row.year,
                sourceUrl: row.href,
            }]);
            augmented.set(row.title, result.get(row.title) ?? null);
            await wait(750);
        }
    } else {
        const result = await augmentDOIs(
            cases.map((row) => ({
            title: row.title,
            firstAuthor: row.firstAuthor,
            year: row.year,
            sourceUrl: row.href,
        })),
        );
        for (const [title, doi] of result.entries()) augmented.set(title, doi);
    }

    const results = cases.map((row) => {
        const resolvedDoi = augmented.get(row.title) ?? null;
        return {
            ...row,
            resolvedDoi,
            correct: resolvedDoi === row.expectedDoi,
        };
    });

    const output = {
        manifestPath: MANIFEST_PATH,
        email: EMAIL,
        sequential: SEQUENTIAL,
        totalSelfCheckingRows: results.length,
        resolved: results.filter((row) => row.resolvedDoi).length,
        correct: results.filter((row) => row.correct).length,
        incorrect: results.filter((row) => row.resolvedDoi && !row.correct).length,
        unresolved: results.filter((row) => !row.resolvedDoi).length,
        results,
    };

    await mkdir(dirname(OUT_PATH), {recursive: true});
    await writeFile(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
