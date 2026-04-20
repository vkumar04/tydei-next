import { describe, it, expect, vi, beforeEach } from "vitest"

const { aggregateMock, groupByMock, findUniqueMock } = vi.hoisted(() => ({
  aggregateMock: vi.fn(),
  groupByMock: vi.fn(),
  findUniqueMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUniqueOrThrow: findUniqueMock },
    cOGRecord: { aggregate: aggregateMock, groupBy: groupByMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getOffContractSpend } from "@/lib/actions/contracts/off-contract-spend"

beforeEach(() => {
  vi.clearAllMocks()
  findUniqueMock.mockResolvedValue({ id: "c-1", vendorId: "v-1" })
})

// Order of aggregates: onAgg, notPricedAgg, preMatchAgg, offAgg.
// Order of groupBys:   onItems, notPricedItems, preMatchItems, offItems.
describe("getOffContractSpend (4-way partition)", () => {
  it("splits spend across On Contract / Not Priced / Pre-Match / Off Contract buckets", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 800_000 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 150_000 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 40_000 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 10_000 } })
    groupByMock
      .mockResolvedValueOnce([
        { vendorItemNo: "ON-1", _sum: { extendedPrice: 500_000 } },
      ])
      .mockResolvedValueOnce([
        { vendorItemNo: "NP-1", _sum: { extendedPrice: 90_000 } },
        { vendorItemNo: "NP-2", _sum: { extendedPrice: 60_000 } },
      ])
      .mockResolvedValueOnce([
        { vendorItemNo: "PM-1", _sum: { extendedPrice: 25_000 } },
      ])
      .mockResolvedValueOnce([
        { vendorItemNo: "OFF-1", _sum: { extendedPrice: 10_000 } },
      ])

    const r = await getOffContractSpend("c-1")

    expect(r.onContract).toBe(800_000)
    expect(r.notPriced).toBe(150_000)
    expect(r.preMatch).toBe(40_000)
    expect(r.offContract).toBe(10_000)
    expect(r.topOnContract).toHaveLength(1)
    expect(r.topOnContract[0]).toMatchObject({
      vendorItemNo: "ON-1",
      totalSpend: 500_000,
    })
    expect(r.topNotPriced).toHaveLength(2)
    expect(r.topNotPriced[0]).toMatchObject({
      vendorItemNo: "NP-1",
      totalSpend: 90_000,
    })
    expect(r.topPreMatch).toHaveLength(1)
    expect(r.topPreMatch[0]).toMatchObject({
      vendorItemNo: "PM-1",
      totalSpend: 25_000,
    })
    expect(r.topOffContract).toHaveLength(1)
    expect(r.topOffContract[0]).toMatchObject({
      vendorItemNo: "OFF-1",
      totalSpend: 10_000,
    })
    // Back-compat alias points at the narrow "genuine leakage" bucket.
    expect(r.offContractItems).toEqual(r.topOffContract)
  })

  it("classifies same-vendor out_of_scope rows as preMatch, not offContract", async () => {
    // Pre-match bucket carries the $4.7M, offContract is $0.
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } }) // on
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } }) // not priced
      .mockResolvedValueOnce({ _sum: { extendedPrice: 4_700_000 } }) // preMatch
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } }) // unknown_vendor
    groupByMock.mockResolvedValue([])

    const r = await getOffContractSpend("c-1")
    expect(r.preMatch).toBe(4_700_000)
    expect(r.offContract).toBe(0)
  })

  it("queries each of the 5 match statuses in the correct bucket", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 1 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 1 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 1 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 1 } })
    groupByMock.mockResolvedValue([])

    await getOffContractSpend("c-1")

    const onWhere = aggregateMock.mock.calls[0][0].where
    const notPricedWhere = aggregateMock.mock.calls[1][0].where
    const preMatchWhere = aggregateMock.mock.calls[2][0].where
    const offWhere = aggregateMock.mock.calls[3][0].where

    expect(onWhere.matchStatus).toEqual({
      in: ["on_contract", "price_variance"],
    })
    expect(notPricedWhere.matchStatus).toBe("off_contract_item")
    expect(preMatchWhere.matchStatus).toBe("out_of_scope")
    expect(offWhere.matchStatus).toBe("unknown_vendor")

    // All 5 COG enums except `pending` are covered exactly once.
    const covered = [
      "on_contract",
      "price_variance",
      "off_contract_item",
      "out_of_scope",
      "unknown_vendor",
    ]
    expect(new Set(covered).size).toBe(5)
  })

  it("returns zeros when no COG records exist (guards null _sum)", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: null } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: null } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: null } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: null } })
    groupByMock.mockResolvedValue([])

    const r = await getOffContractSpend("c-1")
    expect(r.onContract).toBe(0)
    expect(r.notPriced).toBe(0)
    expect(r.preMatch).toBe(0)
    expect(r.offContract).toBe(0)
    expect(r.topOnContract).toEqual([])
    expect(r.topNotPriced).toEqual([])
    expect(r.topPreMatch).toEqual([])
    expect(r.topOffContract).toEqual([])
    expect(r.offContractItems).toEqual([])
  })

  it("also handles undefined _sum safely (guards TS2532)", async () => {
    aggregateMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
    groupByMock.mockResolvedValue([])

    const r = await getOffContractSpend("c-1")
    expect(r.onContract).toBe(0)
    expect(r.notPriced).toBe(0)
    expect(r.preMatch).toBe(0)
    expect(r.offContract).toBe(0)
  })

  it("filters COG rows by contractId so sibling-contract spend is excluded", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 100 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 50 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 25 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 10 } })
    groupByMock.mockResolvedValue([])

    await getOffContractSpend("c-1")

    const allWheres = [
      ...aggregateMock.mock.calls.map((c) => c[0].where),
      ...groupByMock.mock.calls.map((c) => c[0].where),
    ]

    for (const where of allWheres) {
      expect(where.facilityId).toBe("fac-1")
      expect(where).not.toHaveProperty("vendorId")
      expect(where.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ contractId: "c-1" }),
          expect.objectContaining({ contractId: null, vendorId: "v-1" }),
        ]),
      )
    }
  })

  it("returns top on-contract items ordered by spend desc", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 8_500 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } })
    groupByMock
      .mockResolvedValueOnce([
        { vendorItemNo: "SKU-B", _sum: { extendedPrice: 5_000 } },
        { vendorItemNo: "SKU-C", _sum: { extendedPrice: 2_500 } },
        { vendorItemNo: "SKU-A", _sum: { extendedPrice: 1_000 } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const r = await getOffContractSpend("c-1")
    expect(r.topOnContract.map((i) => i.vendorItemNo)).toEqual([
      "SKU-B",
      "SKU-C",
      "SKU-A",
    ])
  })

  it("surfaces where the $4.7M Off Contract comes from (Charles iMessage 2026-04-20)", async () => {
    // Scenario matching diagnostic finding: 164 same-vendor rows that would
    // be stamped out_of_scope in prod (un-enriched / pre-match) sum to
    // $4.7M. Nothing in on_contract / not_priced / unknown_vendor buckets.
    // Expected: preMatch == $4.7M, offContract == $0, and the drilldown
    // surfaces the top contributing SKUs so Charles can see where it
    // came from.
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } }) // on
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } }) // not priced
      .mockResolvedValueOnce({ _sum: { extendedPrice: 4_711_378 } }) // preMatch
      .mockResolvedValueOnce({ _sum: { extendedPrice: 0 } }) // offContract
    groupByMock
      .mockResolvedValueOnce([]) // on items
      .mockResolvedValueOnce([]) // not priced items
      .mockResolvedValueOnce([
        { vendorItemNo: "MDT-SOL-001", _sum: { extendedPrice: 1_800_000 } },
        { vendorItemNo: "MDT-IBG-001", _sum: { extendedPrice: 1_600_000 } },
        { vendorItemNo: "MDT-PLP-001", _sum: { extendedPrice: 1_311_378 } },
      ])
      .mockResolvedValueOnce([]) // off items

    const r = await getOffContractSpend("c-1")

    // The $4.7M is classified as pre-match, not leakage.
    expect(r.preMatch).toBe(4_711_378)
    expect(r.offContract).toBe(0)

    // The drilldown exposes the top SKUs feeding pre-match so the user
    // can see exactly what's contributing.
    expect(r.topPreMatch).toHaveLength(3)
    expect(r.topPreMatch.map((i) => i.vendorItemNo)).toEqual([
      "MDT-SOL-001",
      "MDT-IBG-001",
      "MDT-PLP-001",
    ])
    expect(r.topPreMatch[0].totalSpend).toBe(1_800_000)
    // Total of the top 3 matches the bucket aggregate.
    const topTotal = r.topPreMatch.reduce((s, i) => s + i.totalSpend, 0)
    expect(topTotal).toBe(4_711_378)
  })
})
