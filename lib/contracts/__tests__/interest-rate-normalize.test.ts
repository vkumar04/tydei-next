/**
 * Unit tests for the interest-rate normalize helpers (Charles W1.E).
 *
 * Mirrors `rebate-value-normalize.test.ts` (R5.25). The goal is to lock
 * in that:
 *   - `toDisplayInterestRate` converts stored fraction → whole-percent
 *     display (0.04 → 4) without floating-point fuzz.
 *   - `fromDisplayInterestRate` inverts that (4 → 0.04).
 *   - `normalizeAIInterestRate` treats values > 1 as whole-percent and
 *     leaves already-fractional values alone.
 *   - The engine produces a sensible periodic rate when given the
 *     normalized fraction.
 */
import { describe, it, expect } from "vitest"
import {
  toDisplayInterestRate,
  fromDisplayInterestRate,
  normalizeAIInterestRate,
} from "@/lib/contracts/interest-rate-normalize"
import { buildTieInAmortizationSchedule } from "@/lib/rebates/engine/amortization"

describe("interest-rate-normalize", () => {
  describe("toDisplayInterestRate", () => {
    it("converts fraction → whole-percent", () => {
      expect(toDisplayInterestRate(0.04)).toBe(4)
      expect(toDisplayInterestRate(0.0525)).toBe(5.25)
      expect(toDisplayInterestRate(0)).toBe(0)
    })

    it("rounds away floating-point fuzz", () => {
      // 0.035 * 100 === 3.5000000000000004 without rounding.
      expect(toDisplayInterestRate(0.035)).toBe(3.5)
    })
  })

  describe("fromDisplayInterestRate", () => {
    it("converts whole-percent → fraction", () => {
      expect(fromDisplayInterestRate(4)).toBe(0.04)
      expect(fromDisplayInterestRate(5.25)).toBe(0.0525)
      expect(fromDisplayInterestRate(0)).toBe(0)
    })

    it("round-trips with toDisplayInterestRate", () => {
      for (const fraction of [0, 0.01, 0.04, 0.0525, 0.1]) {
        expect(fromDisplayInterestRate(toDisplayInterestRate(fraction))).toBe(
          fraction,
        )
      }
    })
  })

  describe("normalizeAIInterestRate", () => {
    it("divides values > 1 by 100 (whole-percent input)", () => {
      expect(normalizeAIInterestRate(4)).toBe(0.04)
      expect(normalizeAIInterestRate(5.25)).toBe(0.0525)
      expect(normalizeAIInterestRate(12)).toBe(0.12)
    })

    it("passes fractional values through unchanged", () => {
      expect(normalizeAIInterestRate(0.04)).toBe(0.04)
      expect(normalizeAIInterestRate(0.5)).toBe(0.5)
      expect(normalizeAIInterestRate(1)).toBe(1)
    })

    it("collapses null/undefined to 0", () => {
      expect(normalizeAIInterestRate(null)).toBe(0)
      expect(normalizeAIInterestRate(undefined)).toBe(0)
    })
  })

  describe("engine sanity on fraction input", () => {
    it("produces ~4% APR / quarter on Charles's tie-in contract", () => {
      // $900K capital @ 4% APR over 60 months, quarterly cadence.
      // Row #1 interest = 900_000 * (0.04 / 4) = $9,000.
      const schedule = buildTieInAmortizationSchedule({
        capitalCost: 900_000,
        interestRate: 0.04,
        termMonths: 60,
        period: "quarterly",
      })
      expect(schedule.length).toBe(20)
      const row1 = schedule[0]!
      expect(row1.openingBalance).toBe(900_000)
      // Within a cent of 9,000.
      expect(Math.abs(row1.interestCharge - 9_000)).toBeLessThan(0.5)
    })

    it("produces the inflated 100%-per-period result if given the un-normalized value", () => {
      // Sanity check — confirms the bug reproduces when we pass whole
      // percent (4 = 400% APR) into the engine. Row #1 interest then
      // equals capitalCost * (4 / 4) = capitalCost.
      const schedule = buildTieInAmortizationSchedule({
        capitalCost: 900_000,
        interestRate: 4,
        termMonths: 60,
        period: "quarterly",
      })
      const row1 = schedule[0]!
      expect(row1.interestCharge).toBeCloseTo(900_000, 0)
    })
  })
})
