import { describe, it, expect } from "vitest"
import { computeRunningCapitalBalances } from "@/lib/reports/running-capital-balance"

// "Balance not coming over" (Vick 2026-06-22): the tie-in period table's
// Balance column showed $0. It now shows a running remaining capital balance
// anchored so the most-recent period equals the contract's current balance.
describe("computeRunningCapitalBalances", () => {
  it("anchors the newest period to the remaining balance and walks older periods up", () => {
    // Periods given newest-first (as the table displays them); paydown = May 10k.
    const periods = [
      { periodStart: "2026-05-01", paymentActual: 0, rebateEarned: 10_000 },
      { periodStart: "2026-04-01", paymentActual: 0, rebateEarned: 12_000 },
    ]
    const balances = computeRunningCapitalBalances(periods, 4_000_000)
    // index 0 = May (newest) = current remaining; index 1 = April = + May paydown.
    expect(balances).toEqual([4_000_000, 4_010_000])
  })

  it("counts both logged payments and earned rebate as capital paydown", () => {
    const periods = [
      { periodStart: "2026-02-01", paymentActual: 5_000, rebateEarned: 3_000 },
      { periodStart: "2026-01-01", paymentActual: 1_000, rebateEarned: 0 },
    ]
    // Newest (Feb) = remaining; Jan = remaining + Feb paydown (5k + 3k).
    expect(computeRunningCapitalBalances(periods, 100_000)).toEqual([
      100_000, 108_000,
    ])
  })

  it("returns the remaining balance for a single period", () => {
    expect(
      computeRunningCapitalBalances(
        [{ periodStart: "2026-03-01", paymentActual: 0, rebateEarned: 9_000 }],
        250_000,
      ),
    ).toEqual([250_000])
  })

  it("orders by date regardless of input order (oldest gets the highest balance)", () => {
    // Input oldest-first; result still maps newest → remaining.
    const periods = [
      { periodStart: "2026-01-01", paymentActual: 0, rebateEarned: 4_000 },
      { periodStart: "2026-03-01", paymentActual: 0, rebateEarned: 1_000 },
      { periodStart: "2026-02-01", paymentActual: 0, rebateEarned: 2_000 },
    ]
    // chronological: Jan, Feb, Mar. Mar(newest)=50k; Feb=50k+1k=51k; Jan=51k+2k=53k.
    // returned in INPUT order [Jan, Mar, Feb] = [53k, 50k, 51k].
    expect(computeRunningCapitalBalances(periods, 50_000)).toEqual([
      53_000, 50_000, 51_000,
    ])
  })

  it("returns [] for no periods", () => {
    expect(computeRunningCapitalBalances([], 100_000)).toEqual([])
  })
})
