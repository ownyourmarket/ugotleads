import * as esbuild from "esbuild";

const opts = {
  entryPoints: { popup: "src/popup.js", content: "src/content.js" },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome110",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  (await esbuild.context(opts)).watch();
} else {
  await esbuild.build(opts);
}
