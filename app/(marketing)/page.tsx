import { HeroSection } from "@/components/marketing/hero-section"
import { ValueProps } from "@/components/marketing/value-props"
import { FeaturesGrid } from "@/components/marketing/features-grid"
import { CapabilitiesSection } from "@/components/marketing/capabilities-section"
import { CtaSection } from "@/components/marketing/cta-section"

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://tydei-app-production.up.railway.app"

// Rich-result structured data: Organization + the product as a
// SoftwareApplication, so search engines understand what TYDEi is.
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "TYDEi",
      url: siteUrl,
      logo: `${siteUrl}/icon`,
      description:
        "Healthcare contract, rebate, and case-costing intelligence platform.",
    },
    {
      "@type": "SoftwareApplication",
      name: "TYDEi Platform",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: siteUrl,
      publisher: { "@id": `${siteUrl}/#organization` },
      description:
        "The contract, rebate, and case-costing intelligence platform for healthcare supply chains. Automate rebate tracking, see true per-case margins, extract contract terms with AI, and let vendors manage their own data.",
      offers: { "@type": "Offer", category: "SaaS" },
    },
  ],
}

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static, app-authored JSON — not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HeroSection />
      <ValueProps />
      <FeaturesGrid />
      <CapabilitiesSection />
      <CtaSection />
    </>
  )
}
