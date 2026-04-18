import { describe, it, expect } from "vitest"
import { calculateRebate } from ".."
import type { PeriodData, RebateConfig } from "../types"

const emptyPeriod: PeriodData = {
  purchases: [],
  totalSpend: 0,
}

describe("calculateRebate dispatcher — stub phase", () => {
  // Each engine file will replace the stub error as it ships; until then,
  // the dispatcher returns a zero-rebate result with a descriptive error.
  // SPEND_REBATE is live as of subsystem 2 — its case is asserted separately
  // below (empty errors array, type echoed through).
  const types: Array<{ config: RebateConfig; label: string }> = [
    {
      label: "TIER_PRICE_REDUCTION",
      config: {
        type: "TIER_PRICE_REDUCTION",
        boundaryRule: "EXCLUSIVE",
        tiers: [],
        spendBasis: "ALL_SPEND",
        trigger: "RETROACTIVE",
      },
    },
    {
      label: "MARKET_SHARE_REBATE",
      config: {
        type: "MARKET_SHARE_REBATE",
        method: "CUMULATIVE",
        boundaryRule: "EXCLUSIVE",
        tiers: [],
      },
    },
    {
      label: "MARKET_SHARE_PRICE_REDUCTION",
      config: {
        type: "MARKET_SHARE_PRICE_REDUCTION",
        boundaryRule: "EXCLUSIVE",
        tiers: [],
        trigger: "RETROACTIVE",
      },
    },
    {
      label: "CAPITATED",
      config: {
        type: "CAPITATED",
        groupedReferenceNumbers: [],
        periodCap: 0,
      },
    },
    {
      label: "CARVE_OUT",
      config: { type: "CARVE_OUT", lines: [] },
    },
    {
      label: "TIE_IN_CAPITAL",
      config: {
        type: "TIE_IN_CAPITAL",
        capitalCost: 100_000,
        interestRate: 0.05,
        termMonths: 36,
        period: "quarterly",
        shortfallHandling: "CARRY_FORWARD",
        rebateEngine: {
          type: "SPEND_REBATE",
          method: "CUMULATIVE",
          boundaryRule: "EXCLUSIVE",
          tiers: [],
          spendBasis: "ALL_SPEND",
          baselineType: "NONE",
        },
      },
    },
  ]

  for (const { config, label } of types) {
    it(`${label} — returns zero-rebate with 'not implemented' error (stub phase)`, () => {
      const result = calculateRebate(config, emptyPeriod, { periodLabel: "2026-Q1" })
      expect(result.type).toBe(label)
      expect(result.rebateEarned).toBe(0)
      expect(result.priceReductionValue).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain("not yet implemented")
      expect(result.periodLabel).toBe("2026-Q1")
    })
  }

  it("SPEND_REBATE — dispatches to live engine (no stub error)", () => {
    const config: RebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const result = calculateRebate(config, emptyPeriod, { periodLabel: "2026-Q1" })
    expect(result.type).toBe("SPEND_REBATE")
    expect(result.errors).toEqual([])
    expect(result.periodLabel).toBe("2026-Q1")
  })

  it("VOLUME_REBATE — dispatches to live engine (no stub error)", () => {
    const config: RebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
      cptCodes: [],
      baselineType: "NONE",
    }
    const result = calculateRebate(config, emptyPeriod, { periodLabel: "2026-Q1" })
    expect(result.type).toBe("VOLUME_REBATE")
    expect(result.errors).toEqual([])
    expect(result.periodLabel).toBe("2026-Q1")
  })

  it("unknown config type returns zero-rebate with descriptive error", () => {
    const bogus = { type: "BOGUS_TYPE" } as unknown as RebateConfig
    const result = calculateRebate(bogus, emptyPeriod)
    expect(result.errors[0]).toContain("Unknown config type")
  })
})
