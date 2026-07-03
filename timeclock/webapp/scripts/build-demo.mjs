#!/usr/bin/env node
/*
 * Build the static GitHub Pages demo.
 *
 * The production app has a live server API route (app/api/[[...route]]) and a
 * cron instrumentation hook — both incompatible with Next's `output: "export"`.
 * The demo doesn't need them (the API is served in-browser by lib/demo), so we
 * temporarily move them aside, run `next build` with NEXT_PUBLIC_DEMO=1, then
 * ALWAYS restore them (even on failure). Output lands in ./out.
 *
 * Run from timeclock/webapp:  node scripts/build-demo.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Rename individual FILES (not the app/api directory — Windows locks the dir
// via the Next watcher / AV, causing EPERM). Renaming route.ts is enough: Next
// only treats route.ts/route.js as a handler, so app/api/** becomes route-less
// and the export succeeds. Suffix `.demobak` is never a valid route file.
const MOVES = [
  [resolve(root, "app/api/[[...route]]/route.ts"), resolve(root, "app/api/[[...route]]/route.ts.demobak")],
  [resolve(root, "instrumentation.ts"), resolve(root, "instrumentation.ts.demobak")],
];

function move(from, to) {
  if (existsSync(from)) renameSync(from, to);
}
function stashOut() {
  for (const [src, dst] of MOVES) move(src, dst);
}
function restore() {
  for (const [src, dst] of MOVES) move(dst, src);
}

let code = 0;
try {
  // Undo any prior aborted stash first so restore can't clobber real files.
  restore();
  stashOut();
  execSync("next build", {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, NEXT_PUBLIC_DEMO: "1" },
  });
} catch (e) {
  console.error("[build-demo] build failed:", e?.message ?? e);
  code = 1;
} finally {
  restore();
}
process.exit(code);
