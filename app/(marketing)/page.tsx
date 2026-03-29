import { HeroSection } from "@/components/marketing/hero-section"
import { ValueProps } from "@/components/marketing/value-props"
import { FeaturesGrid } from "@/components/marketing/features-grid"
import { CapabilitiesSection } from "@/components/marketing/capabilities-section"
import { CtaSection } from "@/components/marketing/cta-section"

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <ValueProps />
      <FeaturesGrid />
      <CapabilitiesSection />
      <CtaSection />
    </>
  )
}
