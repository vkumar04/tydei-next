import type { MetadataRoute } from "next"

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://tydei-app-production.up.railway.app"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Auth-gated tenant areas + API — keep them out of the index.
      disallow: ["/dashboard", "/vendor", "/admin", "/api", "/login", "/sign-up", "/reset-password"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}
