// Canonical public site URL — the ONE place the production domain lives.
// Every SEO surface (metadata, robots, sitemap, JSON-LD) imports this;
// NEXT_PUBLIC_SITE_URL overrides it for local dev and previews.
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://tydei.com"
