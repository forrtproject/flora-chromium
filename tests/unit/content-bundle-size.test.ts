import {describe, expect, it} from "vitest";
import {execFile} from "node:child_process";
import {promisify} from "node:util";

const contentEntries = [
    "src/content-general/index.ts",
    "src/content-scholar/index.ts",
];
const execFileAsync = promisify(execFile);

describe("content bundle composition", () => {
    it("does not bundle the retraction fallback JSON into content scripts", async () => {
        const script = `
            import * as esbuild from "esbuild";
            const entries = ${JSON.stringify(contentEntries)};
            const results = [];
            for (const entryPoint of entries) {
                const result = await esbuild.build({
                    entryPoints: [entryPoint],
                    bundle: true,
                    write: false,
                    metafile: true,
                    minify: true,
                    target: "chrome116",
                    loader: {".css": "text"},
                    logLevel: "silent",
                });
                const output = Object.values(result.metafile.outputs)[0];
                results.push({
                    entryPoint,
                    bytes: output.bytes,
                    hasRetractionsJson: Object.hasOwn(output.inputs, "src/retractions.json"),
                });
            }
            console.log(JSON.stringify(results));
        `;
        const {stdout} = await execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
        const results = JSON.parse(stdout) as {
            entryPoint: string;
            bytes: number;
            hasRetractionsJson: boolean;
        }[];

        for (const result of results) {
            expect(result.hasRetractionsJson, result.entryPoint).toBe(false);
            expect(result.bytes, result.entryPoint).toBeLessThan(300_000);
        }
    });
});
