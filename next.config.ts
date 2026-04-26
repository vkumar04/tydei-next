import type { NextConfig } from "next"
import bundleAnalyzer from "@next/bundle-analyzer"

const config: NextConfig = {
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  // 2026-04-26: cacheComponents enables the 'use cache' directive +
  // cacheLife/cacheTag APIs from next/cache. Top-level in Next 16 (was
  // experimental.cacheComponents in earlier alphas). First user:
  // lib/actions/analytics/_cached.ts. Plan:
  // docs/superpowers/plans/2026-04-26-cache-components-rollout.md.
  cacheComponents: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
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
