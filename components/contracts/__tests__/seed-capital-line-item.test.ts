import { describe, it, expect } from "vitest"
import { buildSeededCapitalLineItem } from "@/components/contracts/capital-line-items-editor"

// Regression: the Capital / Leased Items editor must NEVER land empty for a
// tie_in/capital contract — an empty editor blocks save. Both the AI-extract
// handler and the manual contractType→tie_in/capital safety net build their
// seed row through this one helper, so its fallbacks are load-bearing.
// Vick "AI not grabbing the capital again on the Tie in" 2026-06-22.
describe("buildSeededCapitalLineItem", () => {
  it("uses the financed total as the contract total and mints a fresh _uid", () => {
    const a = buildSeededCapitalLineItem({ financedTotal: 651900 })
    const b = buildSeededCapitalLineItem({ financedTotal: 651900 })
    expect(a.contractTotal).toBe(651900)
    expect(a._uid).toBeTruthy()
    expect(a._uid).not.toBe(b._uid)
  })

  it("falls back description → contractName → 'Capital equipment'", () => {
    expect(
      buildSeededCapitalLineItem({ financedTotal: 1, description: "MRI system" })
        .description,
    ).toBe("MRI system")
    expect(
      buildSeededCapitalLineItem({ financedTotal: 1, contractName: "Stryker Tie-In" })
        .description,
    ).toBe("Stryker Tie-In")
    expect(buildSeededCapitalLineItem({ financedTotal: 1 }).description).toBe(
      "Capital equipment",
    )
  })

  it("truncates an overlong description to 80 chars", () => {
    const long = "x".repeat(200)
    expect(
      buildSeededCapitalLineItem({ financedTotal: 1, description: long })
        .description.length,
    ).toBe(80)
  })

  it("applies safe defaults when capital fields are absent", () => {
    const seeded = buildSeededCapitalLineItem({ financedTotal: 0 })
    expect(seeded.initialSales).toBe(0)
    expect(seeded.interestRatePercent).toBe(0)
    expect(seeded.termMonths).toBe(60)
    expect(seeded.paymentType).toBe("fixed")
    expect(seeded.paymentCadence).toBe("monthly")
  })

  it("threads through extracted capital fields when present", () => {
    const seeded = buildSeededCapitalLineItem({
      financedTotal: 785195,
      downPayment: 50000,
      interestRatePercent: 4.953,
      termMonths: 84,
      paymentCadence: "semi_annual",
    })
    expect(seeded.initialSales).toBe(50000)
    expect(seeded.interestRatePercent).toBe(4.953)
    expect(seeded.termMonths).toBe(84)
    expect(seeded.paymentCadence).toBe("semi_annual")
  })
})
