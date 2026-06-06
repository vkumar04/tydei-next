/**
 * E4 (Charles 2026-06-06) — minimum-annual-purchase selection.
 *
 * Unit-tests the pure `selectMinAnnualPurchase` helper extracted from
 * `getContractCapitalSchedule`. The business rule changed: when multiple
 * terms carry a `minimumPurchaseCommitment`, the system surfaces the
 * LOWEST (was: largest), records whether the value came from an explicit
 * commitment or a `spendBaseline` fallback, and counts how many positive
 * commitments existed so the UI can disclose "lowest of N".
 */

import { describe, it, expect } from "vitest"
import { selectMinAnnualPurchase } from "@/lib/contracts/min-annual-selection"

describe("selectMinAnnualPurchase (E4 — lowest commitment)", () => {
  it("picks the LOWEST of two commitments (not the largest)", () => {
    const result = selectMinAnnualPurchase([
      { minimumPurchaseCommitment: 400_000, spendBaseline: null },
      { minimumPurchaseCommitment: 250_000, spendBaseline: null },
    ])
    expect(result.value).toBe(250_000)
    expect(result.source).toBe("commitment")
    expect(result.commitmentCount).toBe(2)
  })

  it("falls back to the LOWEST positive spendBaseline when no commitment exists", () => {
    const result = selectMinAnnualPurchase([
      { minimumPurchaseCommitment: null, spendBaseline: 100_000 },
      { minimumPurchaseCommitment: null, spendBaseline: 60_000 },
    ])
    expect(result.value).toBe(60_000)
    expect(result.source).toBe("baseline")
    expect(result.commitmentCount).toBe(0)
  })

  it("returns nulls for empty terms", () => {
    const result = selectMinAnnualPurchase([])
    expect(result.value).toBeNull()
    expect(result.source).toBeNull()
    expect(result.commitmentCount).toBe(0)
  })
})
