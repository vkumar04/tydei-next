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

describe("getOffContractSpend", () => {
  it("splits totals by isOnContract and returns top-10 off-contract items", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: 800_000 } }) // on-contract
      .mockResolvedValueOnce({ _sum: { extendedPrice: 200_000 } }) // off-contract
    groupByMock.mockResolvedValueOnce([
      { vendorItemNo: "X-1", _sum: { extendedPrice: 75_000 } },
      { vendorItemNo: "X-2", _sum: { extendedPrice: 50_000 } },
    ])

    const r = await getOffContractSpend("c-1")
    expect(r.onContract).toBe(800_000)
    expect(r.offContract).toBe(200_000)
    expect(r.offContractItems).toHaveLength(2)
    expect(r.offContractItems[0]).toMatchObject({ vendorItemNo: "X-1", totalSpend: 75_000 })
  })

  it("returns zeros when no COG records exist", async () => {
    aggregateMock
      .mockResolvedValueOnce({ _sum: { extendedPrice: null } })
      .mockResolvedValueOnce({ _sum: { extendedPrice: null } })
    groupByMock.mockResolvedValueOnce([])

    const r = await getOffContractSpend("c-1")
    expect(r.onContract).toBe(0)
    expect(r.offContract).toBe(0)
    expect(r.offContractItems).toEqual([])
  })
})
