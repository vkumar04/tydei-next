import { describe, it, expect } from "vitest"
import { calculateTierProgress } from "@/lib/contracts/tier-progress"
import {
  formatTierRebateLabel,
  formatTierDollarAnnotation,
} from "@/lib/contracts/tier-rebate-label"
import type { TierLike } from "@/lib/contracts/rebate-method"

/**
 * Charles R5.22 regression: the contract Terms tab rendered
 * "Current: Tier 1 - 300.0%" for a tier whose stored `rebateValue`
 * was 0.03 (3%). Root cause: `contract-terms-display.tsx` hand-rolled
 * the fraction→percent conversion (`rebateValue * 100`) while passing
 * the result through `formatPercent` — a display path parallel to the
 * canonical `formatTierRebateLabel` helper. Any double-scaling in the
 * engine chain (e.g. `calculateMarginal` feeding an already-scaled
 * value in) then shows up as 300% instead of 3%.
 *
 * These tests lock in the contract: going through `formatTierRebateLabel`
 * with the raw Prisma `rebateValue` fraction must render as "3.0%",
 * never "300.0%" and never "0.03%", regardless of rebate method.
 */
describe("tier-progress display (Charles R5.22 regression)", () => {
  const cumulativeTiers: TierLike[] = [
    { tierNumber: 1, spendMin: 0, spendMax: 5_500_000, rebateValue: 0.03 },
    { tierNumber: 2, spendMin: 5_500_000, spendMax: null, rebateValue: 0.05 },
  ]

  it("renders 0.03 as '3.0%' on the cumulative tier-progress card", () => {
    const progress = calculateTierProgress(4_700_000, cumulativeTiers, "cumulative")
    expect(progress.currentTier?.tierNumber).toBe(1)
    // The display code should feed the ORIGINAL tier's rebateValue
    // (0.03) through the canonical helper, producing "3.0%".
    const label = formatTierRebateLabel(
      "percent_of_spend",
      Number(progress.currentTier!.rebateValue),
    )
    expect(label).toBe("3.0%")
    expect(label).not.toBe("300.0%")
    expect(label).not.toBe("0.03%")
  })

  it("renders 0.03 as '3.0%' on the marginal tier-progress card", () => {
    const progress = calculateTierProgress(4_700_000, cumulativeTiers, "marginal")
    expect(progress.currentTier?.tierNumber).toBe(1)
    const label = formatTierRebateLabel(
      "percent_of_spend",
      Number(progress.currentTier!.rebateValue),
    )
    expect(label).toBe("3.0%")
    expect(label).not.toBe("300.0%")
  })

  it("progress toward the next tier reads ~85% for $4.7M of a $5.5M bracket", () => {
    const progress = calculateTierProgress(4_700_000, cumulativeTiers, "cumulative")
    // (4.7M - 0) / (5.5M - 0) * 100 ≈ 85.45%
    expect(progress.progressPercent).toBeGreaterThan(80)
    expect(progress.progressPercent).toBeLessThan(90)
    // Must never return > 100 — a "300%" progress bar is the downstream
    // symptom if this ever regresses.
    expect(progress.progressPercent).toBeLessThanOrEqual(100)
  })
})

/**
 * Charles W1.I: the Rebates & Tiers tab should show the dollar-amount
 * rebate context on each tier row, not just the percent. Three cases:
 * (a) dollar-earned inline on the current tier, (b) "$Y to unlock" on
 * tiers above current, (c) non-percent tiers render per-unit / flat /
 * per-procedure annotations rather than percent math.
 */
describe("tier dollar annotation (Charles W1.I / N10 re-label)", () => {
  it("shows projection, clearly labeled, on the current tier (Charles iMessage 2026-04-20 N10)", () => {
    const annotation = formatTierDollarAnnotation(
      { tierNumber: 2, spendMin: 300_000, rebateType: "percent_of_spend", rebateValue: 0.04 },
      412_000,
      2,
      false,
    )
    expect(annotation).not.toBeNull()
    // Must be a clearly-labeled PROJECTION — never read as actual earned.
    // See CLAUDE.md "Rebates are NEVER auto-computed for display".
    expect(annotation).toContain("projects")
    expect(annotation).not.toContain("earning ")
    // 412,000 * 0.04 = 16,480
    expect(annotation).toContain("$16,480")
    expect(annotation).toContain("$412,000")
  })

  it("shows '$Y to unlock' on tiers above current spend", () => {
    const annotation = formatTierDollarAnnotation(
      { tierNumber: 3, spendMin: 500_000, rebateType: "percent_of_spend", rebateValue: 0.06 },
      412_056,
      2,
      false,
    )
    expect(annotation).not.toBeNull()
    // 500,000 - 412,056 = 87,944
    expect(annotation).toBe("$87,944 to unlock")
  })

  it("renders non-percent tiers with per-unit / flat / per-procedure annotations", () => {
    const perUnit = formatTierDollarAnnotation(
      { tierNumber: 1, spendMin: 0, rebateType: "fixed_rebate_per_unit", rebateValue: 50 },
      0,
      1,
      false,
    )
    expect(perUnit).toBe("$50.00 per unit")

    const flat = formatTierDollarAnnotation(
      { tierNumber: 1, spendMin: 0, rebateType: "fixed_rebate", rebateValue: 10_000 },
      0,
      1,
      false,
    )
    expect(flat).toBe("$10,000.00 flat per period")

    const perProc = formatTierDollarAnnotation(
      { tierNumber: 1, spendMin: 0, rebateType: "per_procedure_rebate", rebateValue: 75 },
      0,
      1,
      false,
    )
    expect(perProc).toBe("$75.00 per procedure")
  })

  it("annotates the top tier reached with 'top rate — currently earning $X'", () => {
    const annotation = formatTierDollarAnnotation(
      { tierNumber: 3, spendMin: 1_000_000, rebateType: "percent_of_spend", rebateValue: 0.06 },
      375_000,
      3,
      true,
    )
    expect(annotation).not.toBeNull()
    expect(annotation).toContain("top rate")
    // 375,000 * 0.06 = 22,500
    expect(annotation).toContain("$22,500")
  })
})
