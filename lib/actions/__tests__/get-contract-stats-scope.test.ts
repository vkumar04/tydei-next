import { describe, it, expect, vi, beforeEach } from "vitest"

const { countMock, aggregateMock, rebateAggregateMock } = vi.hoisted(() => ({
  countMock: vi.fn().mockResolvedValue(0),
  aggregateMock: vi
    .fn()
    .mockResolvedValue({ _sum: { totalValue: 0, annualValue: 0 } }),
  rebateAggregateMock: vi.fn().mockResolvedValue({ _sum: { rebateEarned: 0 } }),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { count: countMock, aggregate: aggregateMock },
    rebate: { aggregate: rebateAggregateMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getContractStats } from "@/lib/actions/contracts"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getContractStats — facilityScope", () => {
  it("'this' (default) scopes by facilityId", async () => {
    await getContractStats({})
    const where = JSON.stringify(countMock.mock.calls[0][0].where)
    expect(where).toContain("fac-1")
  })
  it("'all' drops the facility filter", async () => {
    await getContractStats({ facilityScope: "all" })
    const where = JSON.stringify(countMock.mock.calls[0][0].where)
    expect(where).not.toContain("\"facilityId\":\"fac-1\"")
  })
  it("'shared' filters to multi-facility only", async () => {
    await getContractStats({ facilityScope: "shared" })
    const where = JSON.stringify(countMock.mock.calls[0][0].where)
    expect(where).toContain("isMultiFacility")
  })
})
