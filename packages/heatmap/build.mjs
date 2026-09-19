import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist", "heatmap.js");
const hubPublic = join(here, "..", "..", "hub", "apps", "api", "public");

await build({
  entryPoints: [join(here, "src", "index.ts")],
  outfile: out,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018"],
  legalComments: "none",
  logLevel: "info",
});

// Served by the hub at /heatmap.js (loaded by the plugin's editor bridge only for a heatmap link).
mkdirSync(hubPublic, { recursive: true });
copyFileSync(out, join(hubPublic, "heatmap.js"));
const gz = zlib.gzipSync(readFileSync(out));
console.log(`[heatmap] dist/heatmap.js: ${(gz.length / 1024).toFixed(2)}KB gzipped`);
