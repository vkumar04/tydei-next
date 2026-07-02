/**
 * Charles 2026-06-10 ("should do a 12 month look back and predict what
 * rebates etc would be and compare to other contracts from that vendor"):
 * getVendorLookbackComparison resolves the vendor (id wins, else
 * case-insensitive name), projects the extracted tier ladder onto
 * trailing-12mo COG spend, and summarizes existing contracts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  vendorFindUnique,
  vendorFindFirst,
  vendorFindMany,
  cogAggregate,
  contractFindMany,
} = vi.hoisted(() => ({
  vendorFindUnique: vi.fn(),
  vendorFindFirst: vi.fn(),
  vendorFindMany: vi.fn(),
  cogAggregate: vi.fn(),
  contractFindMany: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    vendor: {
      findUnique: vendorFindUnique,
      findFirst: vendorFindFirst,
      findMany: vendorFindMany,
    },
    cOGRecord: { aggregate: cogAggregate },
    contract: { findMany: contractFindMany },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi
    .fn()
    .mockResolvedValue({ facility: { id: "fac-1" }, user: { id: "u-1" } }),
}))

import { getVendorLookbackComparison } from "@/lib/actions/prospective-analysis"

beforeEach(() => {
  vi.clearAllMocks()
  vendorFindUnique.mockResolvedValue(null)
  vendorFindFirst.mockResolvedValue(null)
  vendorFindMany.mockResolvedValue([])
  cogAggregate.mockResolvedValue({ _sum: { extendedPrice: 0 } })
  contractFindMany.mockResolvedValue([])
})

describe("getVendorLookbackComparison", () => {
  it("resolves vendor by case-insensitive name when no id is given", async () => {
    vendorFindFirst.mockResolvedValueOnce({ id: "v-1", name: "Arthrex, Inc." })
    cogAggregate.mockResolvedValue({ _sum: { extendedPrice: 1_000_000 } })

    const r = await getVendorLookbackComparison({
      vendorName: "arthrex, inc.",
      extractedTiers: [],
    })
    expect(r.vendorId).toBe("v-1")
    expect(vendorFindFirst.mock.calls[0][0].where.name.mode).toBe(
      "insensitive",
    )
    expect(r.trailing12moSpend).toBe(1_000_000)
  })

  it("projects the extracted ladder on trailing-12mo spend (AI '3' = 3%)", async () => {
    vendorFindUnique.mockResolvedValueOnce({ id: "v-1", name: "Arthrex" })
    cogAggregate.mockResolvedValue({ _sum: { extendedPrice: 2_000_000 } })

    const r = await getVendorLookbackComparison({
      vendorId: "v-1",
      extractedTiers: [
        { tierNumber: 1, spendMin: 500_000, rebateValue: 2 },
        { tierNumber: 2, spendMin: 1_500_000, rebateValue: 5 },
        { tierNumber: 3, spendMin: 5_000_000, rebateValue: 8 },
      ],
    })
    // $2M lands in tier 2 (5%). Cumulative method: 5% on all $2M = $100K.
    expect(r.predicted).not.toBeNull()
    expect(r.predicted!.tierAchieved).toBe(2)
    expect(r.predicted!.rebatePercent).toBeCloseTo(5)
    expect(r.predicted!.annualRebate).toBeCloseTo(100_000)
  })

  it("returns predicted=null when spend misses the lowest tier", async () => {
    vendorFindUnique.mockResolvedValueOnce({ id: "v-1", name: "Arthrex" })
    cogAggregate.mockResolvedValue({ _sum: { extendedPrice: 100_000 } })
    const r = await getVendorLookbackComparison({
      vendorId: "v-1",
      extractedTiers: [{ tierNumber: 1, spendMin: 500_000, rebateValue: 2 }],
    })
    expect(r.predicted).toBeNull()
    expect(r.trailing12moSpend).toBe(100_000)
  })

  it("summarizes existing contracts with effective + top tier rates (group-aware)", async () => {
    vendorFindUnique.mockResolvedValueOnce({ id: "v-1", name: "Arthrex" })
    cogAggregate.mockResolvedValue({ _sum: { extendedPrice: 0 } })
    const past = new Date("2025-06-30T00:00:00Z")
    contractFindMany.mockResolvedValueOnce([
      {
        id: "c-1",
        name: "Arthrex Sports Med",
        status: "active",
        expirationDate: new Date("2027-12-31T00:00:00Z"),
        annualValue: 1_200_000,
        rebates: [
          { rebateEarned: 40_000, payPeriodEnd: past },
          // future period — must NOT count as earned
          {
            rebateEarned: 99_999,
            payPeriodEnd: new Date("2099-01-01T00:00:00Z"),
          },
        ],
        terms: [
          {
            tiers: [
              { rebateValue: 0.02, rebateType: "percent_of_spend" },
              { rebateValue: 0.07, rebateType: "percent_of_spend" },
              { rebateValue: 5000, rebateType: "fixed_rebate" },
            ],
          },
        ],
      },
    ])
    // First aggregate call = trailing-12mo vendor spend; second = the
    // per-contract spend bounded to the last CLOSED period (review R4).
    cogAggregate
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 800_000 } })

    const r = await getVendorLookbackComparison({
      vendorId: "v-1",
      extractedTiers: [],
    })
    expect(r.existingContracts).toHaveLength(1)
    const c = r.existingContracts[0]
    expect(c.lifetimeEarned).toBe(40_000)
    expect(c.lifetimeSpend).toBe(800_000)
    expect(c.effectiveRatePct).toBeCloseTo(5)
    // R4: the per-contract spend query is clamped to the last closed
    // payPeriodEnd (2025-06-30), not all-time.
    const spendWhere = cogAggregate.mock.calls[1][0].where
    expect(spendWhere.contractId).toBe("c-1")
    expect(spendWhere.transactionDate.lte.toISOString()).toBe(
      "2025-06-30T00:00:00.000Z",
    )
    // Top tier rate considers only percent_of_spend tiers, scaled to %.
    expect(c.topTierRatePct).toBeCloseTo(7)
    // Group-aware AND ownership-canonical (E-C1): the where AND-composes the
    // contractsOwnedByFacility predicate (primary facilityId OR
    // contractFacilities share) with the vendor group (vendorId OR
    // additionalVendorIds) so the two OR groups can't collide.
    const where = contractFindMany.mock.calls[0][0].where
    expect(where.AND).toHaveLength(2)
    expect(where.AND[0].OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ facilityId: "fac-1" }),
        expect.objectContaining({
          contractFacilities: { some: { facilityId: "fac-1" } },
        }),
      ]),
    )
    expect(where.AND[1].OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ vendorId: "v-1" }),
        expect.objectContaining({ additionalVendorIds: { has: "v-1" } }),
      ]),
    )
  })

  it("returns a null-vendor shell when nothing matches", async () => {
    const r = await getVendorLookbackComparison({
      vendorName: "Nobody Corp",
      extractedTiers: [],
    })
    expect(r.vendorId).toBeNull()
    expect(r.predicted).toBeNull()
    expect(r.existingContracts).toEqual([])
  })
})
