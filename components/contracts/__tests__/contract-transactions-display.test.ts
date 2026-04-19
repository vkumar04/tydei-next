import { describe, it, expect } from "vitest"
import {
  mapRebateRowsToLedger,
  shouldRenderEmptyState,
} from "@/components/contracts/contract-transactions-display"

// Charles W1.P: the Transactions ledger's only data source is the
// `Rebate` table. These tests lock the behavior: ContractPeriod rows
// never appear, and an empty Rebate set drops the ledger table in
// favor of a "no rebate transactions yet" Card.
describe("mapRebateRowsToLedger", () => {
  it("maps Rebate query rows 1:1 with no ContractPeriod merge", () => {
    const rebates = [
      {
        id: "reb-1",
        payPeriodStart: "2025-01-01",
        payPeriodEnd: "2025-03-31",
        rebateEarned: 12_500,
        rebateCollected: 0,
        collectionDate: null,
        notes: null,
      },
      {
        id: "reb-2",
        payPeriodStart: "2025-04-01",
        payPeriodEnd: "2025-06-30",
        rebateEarned: 0,
        rebateCollected: 7_500,
        collectionDate: "2025-07-15",
        notes: "Q2 2025 rebate check received",
      },
    ]
    const rows = mapRebateRowsToLedger(rebates)
    expect(rows).toHaveLength(2)
    // Every row originates from the Rebate query — nothing synthesized
    // from ContractPeriod (spend is always 0 in the ledger; the
    // performance chart uses ContractPeriod separately).
    for (const row of rows) {
      expect(row.totalSpend).toBe(0)
      expect(row.tierAchieved).toBeNull()
    }
    // Manual-entry collection row preserves collectionDate + notes.
    const collected = rows.find((r) => r.id === "reb-2")
    expect(collected?.collectionDate).toBe("2025-07-15")
    expect(collected?.rebateCollected).toBe(7_500)
    expect(collected?.rebateEarned).toBe(0)
  })

  it("sorts rows newest-first by payPeriodEnd", () => {
    const rebates = [
      {
        id: "old",
        payPeriodStart: "2024-01-01",
        payPeriodEnd: "2024-03-31",
        rebateEarned: 1_000,
        rebateCollected: 0,
        collectionDate: null,
        notes: null,
      },
      {
        id: "new",
        payPeriodStart: "2025-10-01",
        payPeriodEnd: "2025-12-31",
        rebateEarned: 2_000,
        rebateCollected: 0,
        collectionDate: null,
        notes: null,
      },
      {
        id: "mid",
        payPeriodStart: "2025-04-01",
        payPeriodEnd: "2025-06-30",
        rebateEarned: 1_500,
        rebateCollected: 0,
        collectionDate: null,
        notes: null,
      },
    ]
    const rows = mapRebateRowsToLedger(rebates)
    expect(rows.map((r) => r.id)).toEqual(["new", "mid", "old"])
  })

  it("returns an empty array when no Rebate rows exist (no ContractPeriod fallback)", () => {
    // This is the regression guard for Charles W1.P: previously a
    // contract with zero Rebate rows but seeded ContractPeriods would
    // still render ledger rows. Post-fix the ledger has zero rows and
    // the component renders the empty-state Card.
    expect(mapRebateRowsToLedger([])).toEqual([])
  })

  it("coerces bigint/string rebate values to Number", () => {
    const rebates = [
      {
        id: "reb-3",
        payPeriodStart: "2025-01-01",
        payPeriodEnd: "2025-03-31",
        rebateEarned: "42.5",
        rebateCollected: null,
        collectionDate: null,
        notes: null,
      },
    ]
    const [row] = mapRebateRowsToLedger(rebates)
    expect(row.rebateEarned).toBe(42.5)
    expect(row.rebateCollected).toBe(0)
  })
})

describe("shouldRenderEmptyState", () => {
  it("is true when there are zero Rebate rows", () => {
    expect(shouldRenderEmptyState([])).toBe(true)
  })

  it("is false as soon as any Rebate row is present", () => {
    const rows = mapRebateRowsToLedger([
      {
        id: "reb-1",
        payPeriodStart: "2025-01-01",
        payPeriodEnd: "2025-03-31",
        rebateEarned: 100,
        rebateCollected: 0,
        collectionDate: null,
        notes: null,
      },
    ])
    expect(shouldRenderEmptyState(rows)).toBe(false)
  })
})
