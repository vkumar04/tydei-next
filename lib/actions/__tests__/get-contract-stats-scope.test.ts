import { describe, it, expect, vi, beforeEach } from "vitest"

const { groupByMock, countMock, aggregateMock, rebateAggregateMock } =
  vi.hoisted(() => ({
    // 2026-07-28: the contract count behind "Total Contracts" (and the
    // "Active" bucket beside it) is one `groupBy(['status'])` — see
    // get-contract-stats-hero-scope.test.ts. `count` is now the
    // expiring-soon query, so the scope assertions below read the groupBy.
    groupByMock: vi.fn().mockResolvedValue([{ status: "active", _count: 0 }]),
    countMock: vi.fn().mockResolvedValue(0),
    aggregateMock: vi
      .fn()
      .mockResolvedValue({ _sum: { totalValue: 0, annualValue: 0 } }),
    rebateAggregateMock: vi
      .fn()
      .mockResolvedValue({ _sum: { rebateEarned: 0 } }),
  }))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      groupBy: groupByMock,
      count: countMock,
      aggregate: aggregateMock,
    },
    rebate: { aggregate: rebateAggregateMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getContractStats } from "@/lib/actions/contracts/stats"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getContractStats — facilityScope", () => {
  it("'this' (default) scopes by facilityId", async () => {
    await getContractStats({})
    const where = JSON.stringify(groupByMock.mock.calls[0][0].where)
    expect(where).toContain("fac-1")
  })
  it("'all' drops the facility filter", async () => {
    await getContractStats({ facilityScope: "all" })
    const where = JSON.stringify(groupByMock.mock.calls[0][0].where)
    expect(where).not.toContain("\"facilityId\":\"fac-1\"")
  })
  it("'shared' filters to multi-facility only", async () => {
    await getContractStats({ facilityScope: "shared" })
    const where = JSON.stringify(groupByMock.mock.calls[0][0].where)
    expect(where).toContain("isMultiFacility")
  })
})
