import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

const isWatch = process.argv.includes("--watch");

const sharedOptions: esbuild.BuildOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? "inline" : false,
  target: "chrome116",
  logLevel: "info",
  loader: { ".css": "text" },
};

const configs: esbuild.BuildOptions[] = [
  {
    ...sharedOptions,
    entryPoints: ["src/content-general/index.ts"],
    outfile: "dist/content-general.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/content-scholar/index.ts"],
    outfile: "dist/content-scholar.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/background/service-worker.ts"],
    outfile: "dist/background.js",
  },
  {
    ...sharedOptions,
    entryPoints: ["src/options/options.ts"],
    outfile: "dist/options.js",
  },
];

function copyStaticAssets() {
  mkdirSync("dist", { recursive: true });
  copyFileSync("src/options/index.html", "dist/options.html");
}

async function build() {
  copyStaticAssets();
  if (isWatch) {
    const contexts = await Promise.all(
      configs.map((config) => esbuild.context(config))
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    await Promise.all(configs.map((config) => esbuild.build(config)));
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
