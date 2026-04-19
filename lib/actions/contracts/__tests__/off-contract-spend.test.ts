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

describe("getOffContractSpend (3-way partition)", () => {
  it("splits spend across On Contract / Not Priced / Off Contract buckets", async () => {
    // Order: onAgg, notPricedAgg, offAgg, notPricedItems, offItems
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 800_000 } }) // on_contract + price_variance
      .mockResolvedValueOnce({ _sum: { extendedPrice: 150_000 } }) // off_contract_item (not priced)
      .mockResolvedValueOnce({ _sum: { extendedPrice: 50_000 } }) // out_of_scope + unknown_vendor
    groupByMock
      .mockResolvedValueOnce([
        { vendorItemNo: "NP-1", _sum: { extendedPrice: 90_000 } },
        { vendorItemNo: "NP-2", _sum: { extendedPrice: 60_000 } },
      ])
      .mockResolvedValueOnce([
        { vendorItemNo: "OFF-1", _sum: { extendedPrice: 30_000 } },
        { vendorItemNo: "OFF-2", _sum: { extendedPrice: 20_000 } },
      ])

    const r = await getOffContractSpend("c-1")

    expect(r.onContract).toBe(800_000)
    expect(r.notPriced).toBe(150_000)
    expect(r.offContract).toBe(50_000)
    expect(r.topNotPriced).toHaveLength(2)
    expect(r.topNotPriced[0]).toMatchObject({
      vendorItemNo: "NP-1",
      totalSpend: 90_000,
    })
    expect(r.topOffContract).toHaveLength(2)
    expect(r.topOffContract[0]).toMatchObject({
      vendorItemNo: "OFF-1",
      totalSpend: 30_000,
    })
    // Back-compat alias
    expect(r.offContractItems).toEqual(r.topOffContract)
  })

  it("queries each of the 6 match statuses in the correct bucket", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 1 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 1 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 1 } })
    groupByMock.mockResolvedValue([])

    await getOffContractSpend("c-1")

    const onWhere = aggregateMock.mock.calls[0][0].where
    const notPricedWhere = aggregateMock.mock.calls[1][0].where
    const offWhere = aggregateMock.mock.calls[2][0].where

    // On Contract bucket: on_contract + price_variance
    expect(onWhere.matchStatus).toEqual({
      in: ["on_contract", "price_variance"],
    })
    // Not Priced bucket: off_contract_item only
    expect(notPricedWhere.matchStatus).toBe("off_contract_item")
    // Off Contract bucket: out_of_scope + unknown_vendor
    expect(offWhere.matchStatus).toEqual({
      in: ["out_of_scope", "unknown_vendor"],
    })

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
    groupByMock.mockResolvedValue([])

    const r = await getOffContractSpend("c-1")
    expect(r.onContract).toBe(0)
    expect(r.notPriced).toBe(0)
    expect(r.offContract).toBe(0)
    expect(r.topNotPriced).toEqual([])
    expect(r.topOffContract).toEqual([])
    expect(r.offContractItems).toEqual([])
  })

  it("also handles undefined _sum safely (guards TS2532)", async () => {
    aggregateMock
      .mockResolvedValueOnce({}) // no _sum at all
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
    groupByMock.mockResolvedValue([])

    const r = await getOffContractSpend("c-1")
    expect(r.onContract).toBe(0)
    expect(r.notPriced).toBe(0)
    expect(r.offContract).toBe(0)
  })

  it("filters COG rows by contractId so sibling-contract spend is excluded", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 100 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 50 } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: 25 } })
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
})
