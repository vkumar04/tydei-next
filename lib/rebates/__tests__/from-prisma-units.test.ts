/**
 * Regression: rebate values are stored as a FRACTION on ContractTier
 * (0.02 = 2%), but the legacy math engine (`lib/rebates/calculate.ts`)
 * expects INTEGER PERCENT values and does `(spend * rebateValue) / 100`
 * internally. The Prisma-to-engine bridges must scale by 100 for
 * `percent_of_spend` tiers or every computed rebate is 100× too small.
 *
 * Reference: lib/contracts/tier-rebate-label.ts — the display side already
 * applies this convention (commit e0d5226). This test locks in the engine
 * side so dashboard / optimizer projections match display.
 */

import { describe, it, expect } from "vitest"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"
import { Prisma } from "@prisma/client"

type Tier = Parameters<typeof computeRebateFromPrismaTiers>[1][number]

function percentTier(
  tierNumber: number,
  spendMin: number,
  spendMax: number | null,
  fractionalRebateValue: number,
): Tier {
  return {
    tierNumber,
    spendMin: new Prisma.Decimal(spendMin),
    spendMax: spendMax === null ? null : new Prisma.Decimal(spendMax),
    rebateValue: new Prisma.Decimal(fractionalRebateValue),
    rebateType: "percent_of_spend",
  } as Tier
}

describe("computeRebateFromPrismaTiers — percent_of_spend unit scaling", () => {
  it("treats Prisma-stored 0.02 as 2% (cumulative)", () => {
    const tiers = [percentTier(1, 0, 500_000, 0.02)]
    // $100k × 2% = $2,000 (not $20).
    const r = computeRebateFromPrismaTiers(100_000, tiers, { method: "cumulative" })
    expect(r.rebateEarned).toBe(2_000)
  })

  it("scales each tier at its own fractional rate (marginal)", () => {
    const tiers = [
      percentTier(1, 0, 500_000, 0.02),
      percentTier(2, 500_000, 1_000_000, 0.03),
    ]
    // $500k @ 2% ($10,000) + $250k @ 3% ($7,500) = $17,500.
    const r = computeRebateFromPrismaTiers(750_000, tiers, { method: "marginal" })
    expect(r.rebateEarned).toBe(17_500)
  })

  it("picks the top tier when spend exceeds every threshold (cumulative)", () => {
    const tiers = [
      percentTier(1, 0, 500_000, 0.02),
      percentTier(2, 500_000, 1_000_000, 0.03),
      percentTier(3, 1_000_000, null, 0.05),
    ]
    // $1.5M × 5% = $75,000.
    const r = computeRebateFromPrismaTiers(1_500_000, tiers, { method: "cumulative" })
    expect(r.rebateEarned).toBe(75_000)
  })
})

describe("computeRebateFromPrismaTiers — non-percent rebate types", () => {
  it("returns 0 for fixed_rebate_per_unit tiers (unit count not available in this facade)", () => {
    const tiers: Tier[] = [
      {
        tierNumber: 1,
        rebateType: "fixed_rebate_per_unit",
        rebateValue: new Prisma.Decimal(100),
        spendMin: new Prisma.Decimal(0),
        spendMax: null,
      } as Tier,
    ]
    const r = computeRebateFromPrismaTiers(750_000, tiers, { method: "cumulative" })
    // Facade is spend-based. Unit-based tiers need computeRebateFromPrismaTerm.
    expect(r.rebateEarned).toBe(0)
  })

  it("returns the flat amount for fixed_rebate tiers", () => {
    const tiers: Tier[] = [
      {
        tierNumber: 1,
        rebateType: "fixed_rebate",
        rebateValue: new Prisma.Decimal(10_000),
        spendMin: new Prisma.Decimal(0),
        spendMax: null,
      } as Tier,
    ]
    const r = computeRebateFromPrismaTiers(500_000, tiers, { method: "cumulative" })
    // Flat amount — not scaled by spend.
    expect(r.rebateEarned).toBe(10_000)
  })

  it("returns 0 for per_procedure_rebate tiers (procedure count not available in this facade)", () => {
    const tiers: Tier[] = [
      {
        tierNumber: 1,
        rebateType: "per_procedure_rebate",
        rebateValue: new Prisma.Decimal(50),
        spendMin: new Prisma.Decimal(0),
        spendMax: null,
      } as Tier,
    ]
    const r = computeRebateFromPrismaTiers(750_000, tiers, { method: "cumulative" })
    expect(r.rebateEarned).toBe(0)
  })
})
