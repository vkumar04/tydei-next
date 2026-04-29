import type { NextConfig } from "next"
import bundleAnalyzer from "@next/bundle-analyzer"

const config: NextConfig = {
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  // 2026-04-26: cacheComponents was enabled but caused build failures
  // during static-page generation — `cacheComponents: true` requires
  // every uncached data access (e.g. `await requireFacility()`) to be
  // inside a Suspense boundary, and every page.tsx in the app does
  // it at the top level. Rollout deferred until a proper PPR plan
  // wraps each route in Suspense or opts each into force-dynamic.
  // The analytics-layer refactor (_cache.ts / _cached.ts /
  // contract-score-impl.ts split) stays — it's independent of the
  // flag and the cleaner module shape is worth keeping.
  // cacheComponents: true,
  experimental: {
    serverActions: {
      // Charles 2026-04-29: 46,512-record COG import was hitting the
      // 10mb cap (~250B/row × 46K ≈ 11-15MB JSON) and surfacing as the
      // generic "Server Components render" overlay because the body
      // never reached the action. 50mb gives ~4× headroom for the
      // largest realistic import (200K rows ≈ 50MB). On Vercel Fluid
      // Compute the platform tolerates this.
      bodySizeLimit: "50mb",
    },
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
    ]
  },
}

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})

export default withBundleAnalyzer(config)
