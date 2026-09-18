import { build } from "esbuild";
import { mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

const entries = [
  { entry: "src/runtime-inline.ts", out: "dist/runtime-inline.js", budgetGzipBytes: 2048 },
  { entry: "src/tracker.ts", out: "dist/tracker.js", budgetGzipBytes: 8192 },
];

const targets = [
  join(here, "dist"),
  join(here, "..", "..", "hub", "apps", "api", "public"),
  join(here, "..", "..", "wp-plugin", "tcw-ab-tester", "assets"),
];

for (const t of targets) mkdirSync(t, { recursive: true });

for (const { entry, out, budgetGzipBytes } of entries) {
  const ctx = await build({
    entryPoints: [join(here, entry)],
    outfile: join(here, out),
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2018"],
    legalComments: "none",
    logLevel: "info",
  });

  const built = join(here, out);
  const gz = zlib.gzipSync(readFileSync(built));
  const gzKb = (gz.length / 1024).toFixed(2);
  const overBudget = gz.length > budgetGzipBytes;
  console.log(`[tracker] ${out}: ${gzKb}KB gzipped ${overBudget ? "OVER BUDGET (" + (budgetGzipBytes / 1024) + "KB)" : "(within budget)"}`);

  const filename = out.split("/").pop();
  for (const t of targets) {
    const dest = join(t, filename);
    if (dest !== built) copyFileSync(built, dest);
  }
}

if (watch) {
  console.log("[tracker] --watch is not wired up yet in phase 1; run `npm run tracker:build` again after edits.");
}
