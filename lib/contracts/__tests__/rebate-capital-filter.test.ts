import { describe, it, expect } from "vitest"
import { sumRebateAppliedToCapital } from "@/lib/contracts/rebate-capital-filter"

// Charles W1.Y-C (C2): three surfaces rendered different "applied to
// capital" numbers — $293,465 (amortization paid-to-date), $185,124
// (header sublabel), and $195,124 (collected lifetime). This helper is
// the single reducer that collapses all three. Charles's rule: on tie-in
// contracts, 100% of collected rebate retires capital.
describe("sumRebateAppliedToCapital (canonical capital-applied aggregate)", () => {
  it("tie_in: sums every collected rebate", () => {
    const rebates = [
      {
        rebateEarned: 100,
        rebateCollected: 100,
        collectionDate: new Date("2025-01-01"),
      },
      {
        rebateEarned: 50,
        rebateCollected: 50,
        collectionDate: new Date("2025-02-01"),
      },
      { rebateEarned: 30, rebateCollected: 0, collectionDate: null },
    ]
    expect(sumRebateAppliedToCapital(rebates, "tie_in")).toBe(150)
  })

  it("tie_in: Charles's screenshot numbers — $195,124 collected", () => {
    const rebates = [
      { rebateCollected: 50_000, collectionDate: new Date("2025-03-01") },
      { rebateCollected: 75_000, collectionDate: new Date("2025-06-30") },
      { rebateCollected: 70_124, collectionDate: new Date("2025-09-30") },
      // Earned-uncollected row must NOT contribute.
      { rebateCollected: 19_280, collectionDate: null },
    ]
    expect(sumRebateAppliedToCapital(rebates, "tie_in")).toBe(195_124)
  })

  it("non-tie_in (usage): returns 0 — no capital to retire", () => {
    const rebates = [
      {
        rebateEarned: 100,
        rebateCollected: 100,
        collectionDate: new Date(),
      },
    ]
    expect(sumRebateAppliedToCapital(rebates, "usage")).toBe(0)
  })

  it("non-tie_in (capital): returns 0", () => {
    const rebates = [
      { rebateCollected: 5_000, collectionDate: new Date("2025-01-01") },
    ]
    expect(sumRebateAppliedToCapital(rebates, "capital")).toBe(0)
  })

  it("rejects earned-but-uncollected on tie_in", () => {
    const rebates = [
      { rebateEarned: 100, rebateCollected: 0, collectionDate: null },
      { rebateEarned: 500, rebateCollected: 500, collectionDate: undefined },
    ]
    expect(sumRebateAppliedToCapital(rebates, "tie_in")).toBe(0)
  })

  it("handles null/undefined contractType safely", () => {
    const rebates = [
      { rebateCollected: 100, collectionDate: new Date("2025-01-01") },
    ]
    expect(sumRebateAppliedToCapital(rebates, null)).toBe(0)
    expect(sumRebateAppliedToCapital(rebates, undefined)).toBe(0)
  })
})
