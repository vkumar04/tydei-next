// Canonical public site URL — the ONE place the production domain lives.
// Every SEO surface (metadata, robots, sitemap, JSON-LD) imports this;
// NEXT_PUBLIC_SITE_URL overrides it for local dev and previews.
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://tydei.com"

// Authenticated-app URL used in email links, ICS links, and Stripe redirect
// URLs. Same host as the marketing site today; NEXT_PUBLIC_APP_URL overrides
// it if the app ever moves to its own subdomain.
export const appUrl = process.env.NEXT_PUBLIC_APP_URL || siteUrl
