import { describe, it, expect } from "vitest"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"

// Charles W1.Y-C (C1): a tie-in contract with $312K spend was rendering
// Rebates Earned (YTD) = $0. The root-cause survey found the predicate
// already treats tie_in as rebate-bearing, but there was no regression
// lock against a future refactor excluding it. This test is the lock.
describe("contract-types that earn rebates", () => {
  it("tie_in contracts earn rebates (Charles iMessage 2026-04-20)", () => {
    expect(contractTypeEarnsRebates("tie_in")).toBe(true)
  })
})
