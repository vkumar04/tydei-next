#!/usr/bin/env bash
# Post-build fixups for Next.js `output: "standalone"` (Railway deploy).
#
# Next's standalone output is incomplete for our app in two ways:
#
#   1. `.next/static` is NOT copied into the standalone dir. The standalone
#      server.js serves static assets from `.next/standalone/.next/static`,
#      so without this every JS/CSS chunk 404s.
#
#   2. Next's file tracing (nft) copies `pdfjs-dist/legacy/build/pdf.mjs` but
#      MISSES the `pdf.worker.mjs` it dynamic-imports at runtime (and the
#      sibling .wasm files). A PDF upload then 500s with "Cannot find module
#      …/pdf.worker.mjs" — the exact failure documented in next.config.ts.
#      Copying the full pdfjs-dist package (~36M) restores the worker + wasm.
#      pdf-parse / pdfjs-dist are serverExternalPackages, so they resolve
#      from node_modules at runtime — having the complete package there fixes it.
set -euo pipefail

echo "[standalone-postbuild] copying .next/static → standalone…"
cp -r .next/static .next/standalone/.next/

echo "[standalone-postbuild] copying full pdfjs-dist (worker + wasm) → standalone…"
rm -rf .next/standalone/node_modules/pdfjs-dist
cp -R node_modules/pdfjs-dist .next/standalone/node_modules/

echo "[standalone-postbuild] done."
