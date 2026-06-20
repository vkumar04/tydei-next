import type { NextConfig } from "next"
import bundleAnalyzer from "@next/bundle-analyzer"

const config: NextConfig = {
  // 2026-06-09: standalone output for Railway — produces a minimal traced
  // `.next/standalone/server.js` so the runtime image is a fraction of the
  // full build, cutting container boot time (the "Deploying…" phase). The
  // build copies `.next/static` into the standalone dir (see package.json
  // build script) and start runs the traced server with HOSTNAME=0.0.0.0.
  // serverExternalPackages (prisma adapter, pdf-parse/pdfjs-dist) are traced
  // into .next/standalone/node_modules by Next's file tracing.
  output: "standalone",
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    // pdf-parse v2 ships a pdfjs-dist worker file (pdf.worker.mjs) and
    // dynamic-imports it at runtime. When Turbopack bundles either
    // package, the worker file isn't copied alongside the chunk and
    // every PDF upload 500s with "Cannot find module
    // '/app/.next/server/chunks/pdf.worker.mjs'" — then pdf.js falls
    // back to vision-only which blew past Claude's 1M-token cap on a
    // large scanned Mako PDF (Vick prod report 2026-05-25). Marking
    // these external keeps both packages resolved from node_modules at
    // runtime, where pdfjs-dist's worker sits next to its entry file.
    "pdf-parse",
    "pdfjs-dist",
    // 2026-06-15: scanned-PDF OCR for contract capital extraction.
    // mupdf (WASM, top-level await) rasterizes pages and tesseract.js
    // (WASM worker + lazily-fetched language data) OCRs them. Both must
    // resolve from node_modules at runtime — bundling the WASM/worker
    // assets breaks them the same way pdfjs-dist's worker broke above.
    "mupdf",
    "tesseract.js",
  ],
  // 2026-06-15: tesseract.js spawns a worker_threads child
  // (src/worker-script/node/index.js) that does relative `require('..')`
  // calls + loads tesseract.js-core's WASM, and mupdf loads its own .wasm —
  // all resolved dynamically, so Next's static file tracing misses them.
  // In the standalone bundle the worker threw "Cannot find module '..'" as
  // an UNCAUGHT exception (Vick prod 2026-06-15: "still not getting the
  // capital") and OCR silently fell back to vision. Force the whole package
  // trees into .next/standalone so the worker + WASM resolve at runtime.
  outputFileTracingIncludes: {
    "**": [
      "./node_modules/tesseract.js/**",
      "./node_modules/tesseract.js-core/**",
      "./node_modules/mupdf/**",
    ],
  },
  // 2026-04-26: cacheComponents was enabled but caused build failures
  // during static-page generation — `cacheComponents: true` requires
  // every uncached data access (e.g. `await requireFacility()`) to be
  // inside a Suspense boundary, and every page.tsx in the app does
  // it at the top level. Rollout deferred until a proper PPR plan
  // wraps each route in Suspense or opts each into force-dynamic.
  // The analytics-layer refactor (_cache.ts / _cached.ts /
  // contract-score-impl.ts split) stays — it's independent of the
  // flag and the cleaner module shape is worth keeping.
  // 2026-05-25 audit: confirmed and concretely scoped. Re-running
  // `bun run build` with this flag on fails with "Uncached data was
  // accessed outside of <Suspense>" on every dashboard route. The
  // work is bigger than the 21 page.tsx files that do top-level
  // `await requireX()` — each portal layout also does it:
  //   - app/dashboard/layout.tsx → requireFacility + getUnreadAlertCount
  //   - app/admin/layout.tsx     → requireAdmin + (similar)
  //   - app/vendor/layout.tsx    → requireVendor + (similar)
  // Layouts run on every route under them, so a single un-Suspended
  // layout breaks every page under it (which is what the prerender
  // error stack traces showed — pointing at providers.tsx through
  // the shared shell, not the page-specific data fetch).
  // Re-enabling requires:
  //   1. Refactor 3 portal layouts so requireX() + per-user reads
  //      stream via Suspense (PortalShell needs to render its chrome
  //      synchronously, with user/alert-count slots streamed in)
  //   2. Refactor 21 page.tsx files to wrap top-level data access
  //      in <Suspense> via a child PageContent() pattern
  //   3. Restore `'use cache'` + cacheLife + cacheTag in
  //      lib/actions/analytics/_cached.ts read helpers
  //   4. Flip this flag
  // Estimated 4–6 hours focused, not appropriate for a bundled audit
  // PR. Worth a docs/superpowers/specs/ entry when prioritised.
  // cacheComponents: true,
  experimental: {
    // Bug 2026-05-18 (Vick "XLS not working for loading COGS"):
    // proxy.ts intercepts every /dashboard/* request for auth-gating.
    // Next.js buffers the request body so middleware can access it,
    // capped at 10MB by default — independent of the
    // `serverActions.bodySizeLimit` below. The 46k-record COG import
    // serializes to ~11MB JSON and tripped this cap, surfacing as a
    // generic "Server Components render" overlay. Server log:
    //   "Request body exceeded 10MB for /dashboard/cog-data.
    //    Only the first 10MB will be available unless configured.
    //    See …/middlewareClientMaxBodySize"
    // followed by `SyntaxError: ... in JSON at position 10476543`.
    // Bump to 200mb so the proxy doesn't truncate the body it never
    // even reads.
    proxyClientMaxBodySize: "200mb",
    serverActions: {
      // Charles 2026-04-29: 46,512-record COG import was hitting the
      // 10mb cap (~250B/row × 46K ≈ 11-15MB JSON) and surfacing as the
      // generic "Server Components render" overlay because the body
      // never reached the action. 50mb gives ~4× headroom for the
      // largest realistic import (200K rows ≈ 50MB). On Vercel Fluid
      // Compute the platform tolerates this.
      //
      // Bug #27 (2026-05-11, Vick): standard quarterly XLS dumps run
      // 70-100MB raw. Once parsed server-side they fan out to even
      // larger JSON payloads when bulkImportCOGRecords is called from
      // the client. Bump to 200mb so the parse-file → confirm-import
      // flow doesn't silently drop the request body.
      bodySizeLimit: "200mb",
    },
  },
  // 2026-06-19 security remediation: baseline security headers applied to
  // EVERY route (including public pages like /login and /). Previously these
  // were only set in proxy.ts, which runs solely on matched (auth-gated)
  // routes — so public pages got no HSTS / clickjacking / sniff protection.
  // Setting them here (Next's headers() applies to all routes) closes that
  // gap. proxy.ts no longer re-sets these (de-duped) to avoid drift; it keeps
  // only X-DNS-Prefetch-Control, which is not part of the baseline set.
  //
  // The Content-Security-Policy is REPORT-ONLY for now: it logs violations
  // (browser console) without blocking, so we can observe what a real
  // enforcing policy would break before flipping to the enforcing header.
  async headers() {
    const cspReportOnly = [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts; 'unsafe-inline' is needed
      // until we wire nonce-based CSP. Report-only, so non-blocking for now.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Tailwind + styled-jsx emit inline styles.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // App's own API/server-action calls; blob: for client-side file parsing.
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value: cspReportOnly,
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      // v0 parity: v0's facility renewals route was `/dashboard/contract-renewals`.
      // Prod lives at `/dashboard/renewals`; keep the v0 URL working for back-compat.
      {
        source: "/dashboard/contract-renewals",
        destination: "/dashboard/renewals",
        permanent: true,
      },
      // /dashboard/analysis is just a redirect to the prospective analyzer
      // (the legacy existing-contract ROI surface was retired). Doing it at
      // the routing layer instead of a render-time `redirect()` in the page
      // avoids a Next.js client-Router hooks glitch ("Rendered more hooks
      // than during the previous render", React #310) that fired when the
      // client followed the in-render redirect. Verified: direct nav to the
      // prospective page throws 0 errors; only the in-render redirect did.
      {
        source: "/dashboard/analysis",
        destination: "/dashboard/analysis/prospective",
        permanent: false,
      },
      // Portal-index + legacy redirects done at the routing layer (not a
      // render-time `redirect()` in the page) for the same reason as
      // /dashboard/analysis above — the in-render redirect tripped the
      // Next client-Router React #310 hooks glitch, which adding a
      // segment `loading.tsx` made fire reliably on /admin.
      { source: "/admin", destination: "/admin/dashboard", permanent: false },
      { source: "/vendor", destination: "/vendor/dashboard", permanent: false },
      {
        source: "/dashboard/purchase-orders/new",
        destination: "/dashboard/purchase-orders",
        permanent: false,
      },
    ]
  },
}

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})

export default withBundleAnalyzer(config)
