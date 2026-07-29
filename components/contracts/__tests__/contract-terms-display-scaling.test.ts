/**
 * Tier-progress unit scaling on the "Rebates & Tiers" card
 * (2026-07-29 math audit, CRITICAL).
 *
 * THE BUG. `ContractTier.rebateValue` is stored as a FRACTION for
 * percent_of_spend (0.10 = 10%), but every rebate-engine entry point takes
 * INTEGER PERCENT and divides by 100 internally
 * (lib/rebates/engine/shared/cumulative.ts: `eligibleAmount * rebateValue / 100`).
 * The card handed the engine the raw fraction, so every dollar it projected was
 * divided by 100 twice.
 *
 * Measured on the live Smith & Nephew ladder at $806,162.47 of contract spend:
 *     before  $1,443.84
 *     after   $144,383.75      ratio exactly 100
 *
 * The engine's unit contract is not a matter of opinion — tests/contracts/
 * tier-progress.test.ts builds its fixtures with 2 / 3 / 4, integer percent.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { calculateTierProgress } from "@/lib/contracts/tier-progress"
import {
  scaleRebateValueForEngine,
  type TierLike,
} from "@/lib/rebates/calculate"

const SRC = readFileSync(
  join(__dirname, "..", "contract-terms-display.tsx"),
  "utf8",
)

/** The production Smith & Nephew ladder, verbatim from the snapshot. */
const PROD_LADDER = [
  { tierNumber: 1, tierName: null, spendMin: 0, spendMax: 1499999, rebateValue: 0.1 },
  { tierNumber: 2, tierName: null, spendMin: 1500000, spendMax: 1999999, rebateValue: 0.15 },
  { tierNumber: 3, tierName: null, spendMin: 2000000, spendMax: null, rebateValue: 0.2 },
] as const
const SPEND = 806162.47

const scaled = (): TierLike[] =>
  PROD_LADDER.map((t) => ({
    ...t,
    rebateValue: scaleRebateValueForEngine(t.rebateValue, "percent_of_spend"),
  })) as TierLike[]
const raw = (): TierLike[] =>
  PROD_LADDER.map((t) => ({ ...t })) as unknown as TierLike[]

describe("the card scales tiers before handing them to the engine", () => {
  it("routes rebateValue through scaleRebateValueForEngine", () => {
    expect(SRC).toContain("scaleRebateValueForEngine(t.rebateValue, t.rebateType)")
  })

  it("no longer passes the raw fraction", () => {
    expect(SRC).not.toContain("rebateValue: Number(t.rebateValue),")
  })
})

describe("the numbers the fix changes", () => {
  it("projects $144,383.75 on the live ladder, not $1,443.84", () => {
    const after = calculateTierProgress(SPEND, scaled(), "cumulative")
      .projectedAdditionalRebate!
    expect(after).toBeCloseTo(144383.753, 2)
    // hand-derived: 1,500,000 x 0.15 − 806,162.47 x 0.10
    expect(after).toBeCloseTo(1_500_000 * 0.15 - SPEND * 0.1, 2)
  })

  it("the old behaviour was exactly 100x too small", () => {
    const before = calculateTierProgress(SPEND, raw(), "cumulative")
      .projectedAdditionalRebate!
    const after = calculateTierProgress(SPEND, scaled(), "cumulative")
      .projectedAdditionalRebate!
    expect(after / before).toBeCloseTo(100, 6)
  })

  it("holds for the marginal method too", () => {
    const before = calculateTierProgress(SPEND, raw(), "marginal")
      .projectedAdditionalRebate!
    const after = calculateTierProgress(SPEND, scaled(), "marginal")
      .projectedAdditionalRebate!
    expect(after / before).toBeCloseTo(100, 6)
  })
})

describe("the scaling helper stays per-rebateType", () => {
  it("multiplies percent_of_spend by 100", () => {
    expect(scaleRebateValueForEngine(0.03, "percent_of_spend")).toBeCloseTo(3, 10)
  })

  it("leaves fixed_rebate alone — the $30,000 -> $3,000,000 incident", () => {
    expect(scaleRebateValueForEngine(30000, "fixed_rebate")).toBe(30000)
  })

  it("leaves per-unit dollars alone", () => {
    expect(scaleRebateValueForEngine(100, "fixed_rebate_per_unit")).toBe(100)
    expect(scaleRebateValueForEngine(75, "per_procedure_rebate")).toBe(75)
  })

  it("every production rebate fraction scales to an exact integer", () => {
    // Prisma Decimal -> Number is float64; 0.1 * 100 need not be exactly 10.
    // Every fraction actually present in production does land exact, so no
    // drift reaches the dollars.
    for (const v of [0.02, 0.03, 0.05, 0.06, 0.1, 0.15, 0.2]) {
      const s = scaleRebateValueForEngine(v, "percent_of_spend")
      expect(Number.isInteger(s)).toBe(true)
    }
  })
})
