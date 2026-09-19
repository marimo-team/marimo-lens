import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build, context } from "esbuild";
import stylex from "@stylexjs/unplugin/esbuild";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const outputDirectory = fileURLToPath(
  new URL("./src/marimo_lens/static", import.meta.url),
);
const watch = process.argv.includes("--watch");
const options = {
  absWorkingDir: packageRoot,
  alias: {
    "@": fileURLToPath(new URL("../widget/src", import.meta.url)),
  },
  bundle: true,
  entryNames: "widget",
  entryPoints: ["../widget/src/widget.tsx"],
  format: "esm",
  loader: {
    ".svg": "dataurl",
  },
  minify: true,
  outdir: outputDirectory,
  plugins: [stylex({ useCSSLayers: true })],
  sourcemap: watch ? "inline" : false,
};

if (watch) {
  const watcher = await context(options);
  await watcher.watch();
} else {
  await rm(outputDirectory, { force: true, recursive: true });
  await build(options);
}
