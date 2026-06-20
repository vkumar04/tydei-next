/**
 * BUG 9 (Charles 2026-06-20 "not sure why it is showing not compliant"):
 * the Tie-In Bundle Compliance card used a YTD, uncategorized spend window
 * — far smaller than (and scoped differently from) the contract header's
 * trailing-12mo "Current Spend" — so the bundle read 0.00% / Not compliant
 * despite real spend. These tests lock the trailing-12mo window + that a
 * bundle whose spend clears its minimums reports compliant with a rate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface TermMock {
  termName: string
  minimumPurchaseCommitment: number
  appliesTo: string | null
  categories: string[]
  tiers: Array<{ spendMin: number; rebateValue: number; rebateType: string }>
}
let contractMock: {
  vendorId: string
  facilityId: string
  effectiveDate: Date
  terms: TermMock[]
}
let aggregateWhere: { transactionDate?: { gte: Date; lte: Date } } = {}

const aggregateMock = vi.fn(
  async (args: { where: { transactionDate?: { gte: Date; lte: Date } } }) => {
    aggregateWhere = args.where
    return { _sum: { extendedPrice: 4_000_000 } }
  },
)

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findFirstOrThrow: vi.fn(async () => contractMock) },
    cOGRecord: { aggregate: (args: unknown) => aggregateMock(args as never) },
  },
}))
vi.mock("@/lib/actions/analytics/_scope", () => ({
  requireContractScope: vi.fn(async () => ({
    kind: "facility",
    facilityId: "fac-1",
    cogScopeFacilityIds: ["fac-1"],
  })),
}))
vi.mock("@/lib/actions/analytics/_telemetry", () => ({
  withTelemetry: (_n: string, _m: unknown, fn: () => Promise<unknown>) => fn(),
}))
vi.mock("@/lib/contracts/cog-category-universe", () => ({
  facilityCogCategoryUniverse: vi.fn(async () => ["Spine", "Joint Replacement"]),
}))

import { getTieInCompliance } from "@/lib/actions/analytics/tie-in-compliance"

describe("getTieInCompliance — BUG 9 window + compliance", () => {
  beforeEach(() => {
    aggregateWhere = {}
    contractMock = {
      vendorId: "v-1",
      facilityId: "fac-1",
      effectiveDate: new Date("2021-01-05"),
      terms: [
        {
          termName: "Primary Term",
          minimumPurchaseCommitment: 200_000,
          appliesTo: "all_products",
          categories: [],
          tiers: [{ spendMin: 0, rebateValue: 0.1, rebateType: "percent_of_spend" }],
        },
        {
          termName: "Equipment Contribution Schedule",
          minimumPurchaseCommitment: 200_000,
          appliesTo: "all_products",
          categories: [],
          tiers: [{ spendMin: 0, rebateValue: 0.1, rebateType: "percent_of_spend" }],
        },
      ],
    }
  })

  it("aggregates a trailing-12-month window, not YTD", async () => {
    await getTieInCompliance("c-1", "all_or_nothing")
    const gte = aggregateWhere.transactionDate!.gte
    const lte = aggregateWhere.transactionDate!.lte
    const monthsBack =
      (lte.getTime() - gte.getTime()) / (1000 * 60 * 60 * 24 * 30)
    expect(monthsBack).toBeGreaterThan(11)
    expect(monthsBack).toBeLessThan(13)
  })

  it("reports compliant with a non-zero rate when trailing-12mo spend clears the minimums", async () => {
    const r = await getTieInCompliance("c-1", "all_or_nothing")
    // $4M trailing-12mo spend vs $400k combined minimum → compliant.
    expect(r.allOrNothing.compliant).toBe(true)
    expect(r.allOrNothing.applicableRate).toBeGreaterThan(0)
    expect(r.allOrNothing.rebateEarned).toBeGreaterThan(0)
  })
})
