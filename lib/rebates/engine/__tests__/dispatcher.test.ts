import { describe, it, expect } from "vitest"
import { calculateRebate } from ".."
import type { PeriodData, RebateConfig } from "../types"

const emptyPeriod: PeriodData = {
  purchases: [],
  totalSpend: 0,
}

describe("calculateRebate dispatcher — stub + live phases", () => {
  // Live engines (each has a standalone live-dispatch assertion below):
  //   - SPEND_REBATE (subsystem 2)
  //   - VOLUME_REBATE (subsystem 3)
  //   - TIER_PRICE_REDUCTION (subsystem 4)
  //   - MARKET_SHARE_PRICE_REDUCTION (subsystem 4)
<<<<<<< HEAD
  //   - MARKET_SHARE_REBATE (subsystem 5)
=======
  //   - CARVE_OUT (subsystem 7)
>>>>>>> 2ef8bb7 (feat(rebates): CARVE_OUT engine (subsystem 7))
  //
  // The parametrized stub phase below covers types still awaiting their
  // engine implementation.
  const types: Array<{ config: RebateConfig; label: string }> = [
    {
      label: "CAPITATED",
      config: {
        type: "CAPITATED",
        groupedReferenceNumbers: [],
        periodCap: 0,
      },
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

  it("TIER_PRICE_REDUCTION — dispatches to live engine (simple valid config, no errors)", () => {
    const config: RebateConfig = {
      type: "TIER_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 0,
          thresholdMax: null,
          rebateValue: 0,
          reducedPrice: 50,
        },
      ],
      spendBasis: "ALL_SPEND",
      trigger: "RETROACTIVE",
    }
    const result = calculateRebate(config, emptyPeriod, { periodLabel: "2026-Q1" })
    expect(result.type).toBe("TIER_PRICE_REDUCTION")
    expect(result.errors).toEqual([])
    expect(result.rebateEarned).toBe(0)
    expect(result.periodLabel).toBe("2026-Q1")
  })

  it("MARKET_SHARE_REBATE — dispatches to live engine; missing totalCategorySpend surfaces error", () => {
    const config: RebateConfig = {
      type: "MARKET_SHARE_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 0,
          thresholdMax: null,
          rebateValue: 2,
        },
      ],
    }
    const result = calculateRebate(config, emptyPeriod, { periodLabel: "2026-Q1" })
    expect(result.type).toBe("MARKET_SHARE_REBATE")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("totalCategorySpend")
    expect(result.rebateEarned).toBe(0)
    expect(result.periodLabel).toBe("2026-Q1")
  })

  it("CARVE_OUT — dispatches to live engine (empty lines, no errors)", () => {
    const config: RebateConfig = {
      type: "CARVE_OUT",
      lines: [],
    }
    const result = calculateRebate(config, emptyPeriod, { periodLabel: "2026-Q1" })
    expect(result.type).toBe("CARVE_OUT")
    expect(result.errors).toEqual([])
    expect(result.rebateEarned).toBe(0)
    expect(result.eligibleSpend).toBe(0)
    expect(result.carveOutLines).toEqual([])
    expect(result.periodLabel).toBe("2026-Q1")
  })

  it("MARKET_SHARE_PRICE_REDUCTION — dispatches to live engine; missing totalCategorySpend surfaces error", () => {
    const config: RebateConfig = {
      type: "MARKET_SHARE_PRICE_REDUCTION",
      boundaryRule: "EXCLUSIVE",
      tiers: [
        {
          tierNumber: 1,
          thresholdMin: 0,
          thresholdMax: null,
          rebateValue: 0,
          reducedPrice: 50,
        },
      ],
      trigger: "RETROACTIVE",
    }
    const result = calculateRebate(config, emptyPeriod, { periodLabel: "2026-Q1" })
    expect(result.type).toBe("MARKET_SHARE_PRICE_REDUCTION")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain("totalCategorySpend")
    expect(result.rebateEarned).toBe(0)
  })

  it("unknown config type returns zero-rebate with descriptive error", () => {
    const bogus = { type: "BOGUS_TYPE" } as unknown as RebateConfig
    const result = calculateRebate(bogus, emptyPeriod)
    expect(result.errors[0]).toContain("Unknown config type")
  })
})
