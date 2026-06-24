/**
 * Deal Scorer "constructs" → analyzer scenarios.
 *
 * The Deal Scorer lets a vendor enter one row ("construct") per product, each
 * with Current / Floor / Target / Ask unit prices, an annual volume, and a
 * rebate % (Vick 2026-06-23). The tested `analyzeVendorProspective` engine
 * scores `pricingScenarios` ({ scenarioName, unitPrice, estimatedAnnualVolume,
 * rebatePercent }), so we BLEND the constructs into the three scenarios the
 * engine already understands — a spend-weighted average unit price + summed
 * volume + spend-weighted rebate at each price tier. "Current" is the baseline
 * the facility pays today (→ facilityEstimatedAnnualSpend).
 */

export interface DealConstruct {
  current: number
  floor: number
  target: number
  ask: number
  annualVolume: number
  /** Integer percent, e.g. 5 = 5%. */
  rebatePercent: number
}

export interface BlendedScenario {
  scenarioName: string
  unitPrice: number
  estimatedAnnualVolume: number
  rebatePercent: number
}

export interface BlendedDeal {
  /** Floor / Target / Ask scenarios for the analyzer (price tiers with volume). */
  scenarios: BlendedScenario[]
  /** Σ(current × volume) — what the facility pays today (baseline). */
  currentAnnualSpend: number
}

/**
 * Blend constructs into Floor/Target/Ask scenarios + the Current baseline.
 * Only constructs with a positive annual volume contribute. A tier whose blended
 * unit price is 0 (no priced rows) is dropped so the analyzer never scores an
 * empty scenario.
 */
export function blendConstructsToScenarios(
  constructs: DealConstruct[],
): BlendedDeal {
  const valid = constructs.filter((c) => c.annualVolume > 0)
  const totalVolume = valid.reduce((s, c) => s + c.annualVolume, 0)

  const tier = (
    scenarioName: string,
    pick: (c: DealConstruct) => number,
  ): BlendedScenario => {
    const spend = valid.reduce((s, c) => s + pick(c) * c.annualVolume, 0)
    const rebateWeighted = valid.reduce(
      (s, c) => s + c.rebatePercent * pick(c) * c.annualVolume,
      0,
    )
    return {
      scenarioName,
      unitPrice: totalVolume > 0 ? spend / totalVolume : 0,
      estimatedAnnualVolume: totalVolume,
      rebatePercent: spend > 0 ? rebateWeighted / spend : 0,
    }
  }

  const scenarios =
    totalVolume > 0
      ? [
          tier("Floor", (c) => c.floor),
          tier("Target", (c) => c.target),
          tier("Ask", (c) => c.ask),
        ].filter((s) => s.unitPrice > 0)
      : []

  const currentAnnualSpend = valid.reduce(
    (s, c) => s + c.current * c.annualVolume,
    0,
  )

  return { scenarios, currentAnnualSpend }
}
