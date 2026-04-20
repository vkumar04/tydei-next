import { describe, it, expect } from "vitest"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"

// Charles W1.R: the "Collected" number must agree across the contract
// detail header card, the contracts list, and the Transactions tab
// summary card. This helper is the single filter used by all three, so
// these tests are the regression lock for all three surfaces at once.
describe("sumCollectedRebates (canonical Collected aggregate)", () => {
  it("sums rebateCollected across every row when all have a collectionDate", () => {
    // All three rows are "collected" — each contributes its full amount.
    const rows = [
      { collectionDate: new Date("2025-01-15"), rebateCollected: 1000 },
      { collectionDate: new Date("2025-04-30"), rebateCollected: 2500.5 },
      { collectionDate: "2025-07-01", rebateCollected: 499.5 },
    ]
    expect(sumCollectedRebates(rows)).toBe(4000)
  })

  it("excludes rows without a collectionDate (mixed case — Charles W1.R)", () => {
    // Charles W1.R reproduction: seed gives rows a rebateCollected value
    // even when collectionDate is null. Those rows must NOT contribute —
    // otherwise the header card (9,711.29) and the ledger summary
    // (180,728.96) disagree, which is the exact bug Charles reported.
    const rows = [
      { collectionDate: new Date("2025-02-01"), rebateCollected: 9711.29 },
      { collectionDate: null, rebateCollected: 90000 },
      { collectionDate: null, rebateCollected: 81017.67 },
      { collectionDate: undefined, rebateCollected: 50000 },
    ]
    expect(sumCollectedRebates(rows)).toBe(9711.29)
  })

  it("returns 0 when no row has a collectionDate", () => {
    // Contract has accrued earnings but nothing has been collected yet.
    const rows = [
      { collectionDate: null, rebateCollected: 1234 },
      { collectionDate: null, rebateCollected: 5678 },
      { collectionDate: null, rebateCollected: "9999.99" },
    ]
    expect(sumCollectedRebates(rows)).toBe(0)
  })
})
