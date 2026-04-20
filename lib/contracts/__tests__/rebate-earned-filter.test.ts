import { describe, it, expect } from "vitest"
import {
  sumEarnedRebatesLifetime,
  sumEarnedRebatesYTD,
} from "@/lib/contracts/rebate-earned-filter"

// Charles W1.U-B: the "Earned" number must agree across the contract
// detail header card (YTD), the contracts list earned column (YTD),
// and the Transactions tab summary card (lifetime). Both helpers
// share the "closed period" rule (payPeriodEnd <= today) — the only
// difference is whether YTD applies the "Jan 1 of today's year" floor.
describe("rebate-earned-filter (canonical Earned aggregate)", () => {
  // Canonical fixture from the W1.U-B task brief:
  //   - 2024-06-30, $100  (closed, prior year)
  //   - 2025-03-31, $200  (closed, prior year)
  //   - 2026-02-15, $300  (closed, current year)
  //   - 2026-06-30, $400  (FUTURE — excluded from both aggregates)
  const TODAY = new Date("2026-04-19T12:00:00Z")
  const ROWS = [
    { payPeriodEnd: new Date("2024-06-30"), rebateEarned: 100 },
    { payPeriodEnd: new Date("2025-03-31"), rebateEarned: 200 },
    { payPeriodEnd: new Date("2026-02-15"), rebateEarned: 300 },
    { payPeriodEnd: new Date("2026-06-30"), rebateEarned: 400 },
  ]

  describe("sumEarnedRebatesLifetime", () => {
    it("sums all closed periods and excludes future periods ($600)", () => {
      // 100 + 200 + 300 = $600; the 2026-06-30 row is future so $0.
      expect(sumEarnedRebatesLifetime(ROWS, TODAY)).toBe(600)
    })

    it("returns 0 when every row is in the future", () => {
      const rows = [
        { payPeriodEnd: new Date("2027-01-01"), rebateEarned: 500 },
        { payPeriodEnd: new Date("2026-12-31"), rebateEarned: 250 },
      ]
      expect(sumEarnedRebatesLifetime(rows, TODAY)).toBe(0)
    })

    it("skips rows with a null payPeriodEnd", () => {
      const rows = [
        { payPeriodEnd: null, rebateEarned: 9999 },
        { payPeriodEnd: new Date("2025-01-15"), rebateEarned: 100 },
      ]
      expect(sumEarnedRebatesLifetime(rows, TODAY)).toBe(100)
    })

    it("accepts ISO string payPeriodEnd values", () => {
      const rows = [
        { payPeriodEnd: "2025-06-30", rebateEarned: "150.5" },
        { payPeriodEnd: "2026-06-30", rebateEarned: 400 },
      ]
      expect(sumEarnedRebatesLifetime(rows, TODAY)).toBe(150.5)
    })

    it("includes a row whose payPeriodEnd equals today (boundary)", () => {
      const rows = [{ payPeriodEnd: TODAY, rebateEarned: 42 }]
      expect(sumEarnedRebatesLifetime(rows, TODAY)).toBe(42)
    })
  })

  describe("sumEarnedRebatesYTD", () => {
    it("sums only current-year closed periods ($300)", () => {
      // Only the 2026-02-15 row falls in [2026-01-01, 2026-04-19].
      expect(sumEarnedRebatesYTD(ROWS, TODAY)).toBe(300)
    })

    it("excludes prior-year rows even if the amount is large", () => {
      const rows = [
        { payPeriodEnd: new Date("2025-12-31"), rebateEarned: 100_000 },
        { payPeriodEnd: new Date("2026-01-02"), rebateEarned: 1 },
      ]
      expect(sumEarnedRebatesYTD(rows, TODAY)).toBe(1)
    })

    it("excludes future rows in the same calendar year", () => {
      const rows = [
        { payPeriodEnd: new Date("2026-03-31"), rebateEarned: 100 },
        { payPeriodEnd: new Date("2026-05-31"), rebateEarned: 999 },
      ]
      expect(sumEarnedRebatesYTD(rows, TODAY)).toBe(100)
    })

    it("returns 0 when no row falls in the YTD window", () => {
      const rows = [
        { payPeriodEnd: new Date("2024-01-01"), rebateEarned: 50 },
        { payPeriodEnd: new Date("2025-12-31"), rebateEarned: 50 },
        { payPeriodEnd: new Date("2027-01-01"), rebateEarned: 50 },
      ]
      expect(sumEarnedRebatesYTD(rows, TODAY)).toBe(0)
    })

    it("includes a row whose payPeriodEnd equals Jan 1 of today's year (lower boundary)", () => {
      const rows = [
        { payPeriodEnd: new Date(TODAY.getFullYear(), 0, 1), rebateEarned: 7 },
      ]
      expect(sumEarnedRebatesYTD(rows, TODAY)).toBe(7)
    })
  })
})
