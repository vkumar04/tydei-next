/**
 * Charles W1.N — Contract Transactions ledger: the per-row "Rebate
 * Collected" column and the top-of-tab "Collected" summary card must
 * honor the CLAUDE.md invariant: a rebate counts as collected ONLY
 * when a `Rebate` row has a non-null `collectionDate`. ContractPeriod
 * rows carry a seed-synthesized `rebateCollected` (a projection), but
 * they have no `collectionDate` column — so they must render $0 here,
 * no matter what their stored value is.
 *
 * Bug report: "Why are rebate collected data being entered auto?" The
 * ledger was pulling thousands-of-dollars "Collected" values from
 * ContractPeriod rollups even though the user never logged a
 * collection. This test locks the fix — `displayedCollected` is the
 * single helper that drives both the table cell and the summary card,
 * so asserting it is equivalent to asserting both surfaces.
 */
import { describe, it, expect } from "vitest"
import {
  displayedCollected,
  type PeriodRow,
} from "@/lib/contracts/transactions-display"

function periodRow(overrides: Partial<PeriodRow> = {}): PeriodRow {
  return {
    id: "p-1",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    totalSpend: 100000,
    rebateEarned: 500,
    rebateCollected: 500,
    tierAchieved: 1,
    source: "period",
    collectionDate: null,
    notes: null,
    ...overrides,
  }
}

function rebateRow(overrides: Partial<PeriodRow> = {}): PeriodRow {
  return {
    id: "r-1",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    totalSpend: 0,
    rebateEarned: 0,
    rebateCollected: 200,
    tierAchieved: null,
    source: "rebate",
    collectionDate: "2026-04-01",
    notes: null,
    ...overrides,
  }
}

describe("displayedCollected — only Rebate rows with collectionDate contribute", () => {
  it("period-sourced row renders $0 collected even when stored rebateCollected is large", () => {
    // Reproduces the bug: seed-synthesized ContractPeriod.rebateCollected
    // must NOT leak into the ledger's Collected column.
    expect(displayedCollected(periodRow({ rebateCollected: 6666.67 }))).toBe(0)
  })

  it("rebate-sourced row with a collectionDate renders the stored collected amount", () => {
    expect(
      displayedCollected(
        rebateRow({ rebateCollected: 200, collectionDate: "2026-04-01" }),
      ),
    ).toBe(200)
  })

  it("rebate-sourced row without a collectionDate renders $0 (pending collection)", () => {
    expect(
      displayedCollected(
        rebateRow({ rebateCollected: 9999, collectionDate: null }),
      ),
    ).toBe(0)
  })

  it("summary total across mixed rows counts ONLY the collected Rebate row", () => {
    // The exact shape in Charles's report: a ContractPeriod rollup with a
    // projected collected value, plus a user-logged Rebate with a real
    // collectionDate. Expected: 200, never 700.
    const rows: PeriodRow[] = [
      periodRow({ rebateCollected: 500 }),
      rebateRow({ rebateCollected: 200, collectionDate: "2026-04-01" }),
    ]
    const total = rows.reduce((s, r) => s + displayedCollected(r), 0)
    expect(total).toBe(200)
  })

  it("pending Rebate rows are excluded from the summary (no double-count)", () => {
    const rows: PeriodRow[] = [
      periodRow({ rebateCollected: 1000 }),
      rebateRow({ rebateCollected: 5000, collectionDate: null }),
      rebateRow({ id: "r-2", rebateCollected: 300, collectionDate: "2026-04-15" }),
    ]
    const total = rows.reduce((s, r) => s + displayedCollected(r), 0)
    expect(total).toBe(300)
  })
})
