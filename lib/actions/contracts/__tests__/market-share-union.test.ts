/**
 * bugs.rtfd 2026-06-13 M — canonical per-period market-share computation.
 *
 * Charles: "if more than one category is chosen the total spend for both
 * combined vs other companies is what should be used."
 *
 * `computePerPeriodMarketShare` (extracted from the threshold writer's
 * per-period branch) must compute, per evaluation window:
 *
 *     combined vendor spend across ALL scoped categories' canonical
 *     variants  ÷  combined facility spend across the SAME union
 *
 * — never a per-category average and never just the first category. The
 * writer calls the same function, so writer and timeline display cannot
 * drift. Fixture is built so the three candidate answers differ:
 *   combined  900 / 5,000  = 18%
 *   average  (80% + 2.5%)/2 = 41.25%
 *   first-category           80%
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { deleteManyMock, createManyMock, cogFindManyMock, cogGroupByMock } =
  vi.hoisted(() => ({
    deleteManyMock: vi.fn(),
    createManyMock: vi.fn(),
    cogFindManyMock: vi.fn(),
    cogGroupByMock: vi.fn(),
  }))

vi.mock("@/lib/db", () => ({
  prisma: {
    rebate: { findMany: vi.fn().mockResolvedValue([]), /* preserved-collected read (2026-07-29) */  deleteMany: deleteManyMock, createMany: createManyMock },
    cOGRecord: { findMany: cogFindManyMock, groupBy: cogGroupByMock },
  },
}))

import {
  buildThresholdEvaluationWindows,
  computePerPeriodMarketShare,
  recomputeThresholdAccrualForTerm,
} from "@/lib/contracts/recompute/threshold"

/** Facility COG: the stored spellings are canonical-variant drifts of the
 * term's scoped names ("Joint Replacement" / "Trauma Implants"). */
const COG_ROWS = [
  // Category A — vendor holds 80% of a $1,000 market.
  { vendorId: "v-1", category: "Joint replacement", extendedPrice: 800, transactionDate: new Date(Date.UTC(2025, 5, 10)) },
  { vendorId: "v-other", category: "Joint replacement", extendedPrice: 200, transactionDate: new Date(Date.UTC(2025, 5, 11)) },
  // Category B — vendor holds 2.5% of a $4,000 market.
  { vendorId: "v-1", category: "TRAUMA IMPLANTS", extendedPrice: 100, transactionDate: new Date(Date.UTC(2025, 6, 10)) },
  { vendorId: "v-other", category: "TRAUMA IMPLANTS", extendedPrice: 3900, transactionDate: new Date(Date.UTC(2025, 6, 11)) },
]

beforeEach(() => {
  deleteManyMock.mockReset().mockResolvedValue({ count: 0 })
  createManyMock.mockReset().mockResolvedValue({ count: 0 })
  cogGroupByMock
    .mockReset()
    .mockResolvedValue([
      { category: "Joint replacement" },
      { category: "TRAUMA IMPLANTS" },
      { category: "Spine" },
    ])
  // Behave like the DB: honor the vendorId / category filters the caller
  // sends, so the union semantics are actually exercised.
  cogFindManyMock.mockReset().mockImplementation(
    async (args: {
      where?: {
        vendorId?: { in: string[] }
        category?: { in: string[] }
      }
    }) => {
      const where = args?.where ?? {}
      return COG_ROWS.filter((r) => {
        if (where.vendorId && !where.vendorId.in.includes(r.vendorId)) {
          return false
        }
        if (where.category && !where.category.in.includes(r.category)) {
          return false
        }
        return true
      })
    },
  )
})

const ANNUAL_2025_WINDOW = {
  periodStart: new Date(Date.UTC(2025, 0, 1)),
  periodEnd: new Date(Date.UTC(2025, 11, 31, 23, 59, 59, 999)),
}

describe("computePerPeriodMarketShare — multi-category union (bugs.rtfd 2026-06-13 M)", () => {
  it("two categories → combined vendor ÷ combined market across canonical case-variants", async () => {
    const shares = await computePerPeriodMarketShare({
      facilityId: "f-1",
      vendorIds: ["v-1"],
      // Canonically different from every stored COG spelling — the
      // expansion through the facility universe must pick the drifted
      // variants up (never a raw case-sensitive `in`).
      scopedCategoryNames: ["Joint Replacement", "Trauma Implants"],
      windows: [ANNUAL_2025_WINDOW],
    })

    expect(shares).toHaveLength(1)
    expect(shares[0].vendorSpend).toBe(900) // 800 + 100 — both categories
    expect(shares[0].marketSpend).toBe(5000) // 1,000 + 4,000 — both categories
    expect(shares[0].share).toBeCloseTo(18, 8) // combined ÷ combined
    // The wrong answers this test exists to forbid:
    expect(shares[0].share).not.toBeCloseTo(41.25, 2) // per-category average
    expect(shares[0].share).not.toBeCloseTo(80, 2) // first category only
    // The out-of-scope category never leaks into either query.
    for (const call of cogFindManyMock.mock.calls) {
      expect(call[0].where.category.in).not.toContain("Spine")
    }
  })

  it("writer agreement: the persisted note carries the same combined share + tier", async () => {
    const term = {
      id: "term-ms",
      evaluationPeriod: "annual",
      effectiveStart: new Date(Date.UTC(2025, 0, 1)),
      effectiveEnd: new Date(Date.UTC(2025, 11, 31)),
      termType: "market_share",
      vendorId: "v-1",
      vendorIds: ["v-1"],
      appliesTo: "specific_category",
      categories: ["Joint Replacement", "Trauma Implants"],
      tiers: [
        {
          tierNumber: 1,
          tierName: "Base",
          spendMin: 15, // 15% threshold — the 18% combined share qualifies
          spendMax: null,
          rebateValue: 5_000,
          rebateType: "fixed_rebate",
        },
      ],
    }
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "currentMarketShare",
      metricValue: null,
      term,
    })
    expect(r.inserted).toBe(1)
    expect(r.sumEarned).toBe(5_000)
    const data = createManyMock.mock.calls[0][0].data
    expect(data[0].notes).toContain("currentMarketShare=18.0% (period)")
    expect(data[0].notes).toContain("tier 1")

    // Helper called standalone over the writer's own grid returns the
    // identical share — one code path, no drift possible.
    const grid = buildThresholdEvaluationWindows({
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      effectiveStart: term.effectiveStart,
      effectiveEnd: term.effectiveEnd,
      evaluationPeriod: term.evaluationPeriod,
    })
    expect(grid).not.toBeNull()
    expect(grid?.windows).toHaveLength(1)
    const shares = await computePerPeriodMarketShare({
      facilityId: "f-1",
      vendorIds: ["v-1"],
      scopedCategoryNames: ["Joint Replacement", "Trauma Implants"],
      windows: grid?.windows ?? [],
      queryStart: grid?.start,
      queryEnd: grid?.end,
    })
    expect(shares[0].share).toBeCloseTo(18, 8)
  })

  it("below-lowest-threshold window persists NO row — the visibility gap the timeline display closes", async () => {
    const term = {
      id: "term-ms",
      evaluationPeriod: "annual",
      effectiveStart: new Date(Date.UTC(2025, 0, 1)),
      effectiveEnd: new Date(Date.UTC(2025, 11, 31)),
      termType: "market_share",
      vendorId: "v-1",
      vendorIds: ["v-1"],
      appliesTo: "specific_category",
      categories: ["Joint Replacement", "Trauma Implants"],
      tiers: [
        {
          tierNumber: 1,
          tierName: "Base",
          spendMin: 50, // 18% combined share does NOT qualify
          spendMax: null,
          rebateValue: 5_000,
          rebateType: "fixed_rebate",
        },
      ],
    }
    const r = await recomputeThresholdAccrualForTerm({
      contractId: "c-1",
      facilityId: "f-1",
      contractEffectiveDate: new Date(Date.UTC(2025, 0, 1)),
      contractExpirationDate: new Date(Date.UTC(2025, 11, 31)),
      metric: "currentMarketShare",
      metricValue: null,
      term,
    })
    // Confirmed prod behavior (threshold.ts `periodPayment <= 0` gate):
    // zero-payment windows produce no persisted Rebate row at all.
    expect(r).toEqual({ inserted: 0, sumEarned: 0 })
    expect(createManyMock).not.toHaveBeenCalled()
  })
})
