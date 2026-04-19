import { describe, it, expect, vi, beforeEach } from "vitest"

const { findManyMock, countMock } = vi.hoisted(() => ({
  findManyMock: vi.fn().mockResolvedValue([]),
  countMock: vi.fn().mockResolvedValue(0),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findMany: findManyMock, count: countMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

import { getContracts } from "@/lib/actions/contracts"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getContracts — facilityScope", () => {
  it("'this' (default) scopes by facilityId", async () => {
    await getContracts({})
    const call = findManyMock.mock.calls[0][0]
    const where = JSON.stringify(call.where)
    expect(where).toContain("fac-1")
    expect(where).not.toContain("isMultiFacility")
  })

  it("'all' drops the facility filter", async () => {
    await getContracts({ facilityScope: "all" })
    const call = findManyMock.mock.calls[0][0]
    const where = JSON.stringify(call.where)
    // No facilityId scoping in 'all' mode
    expect(where).not.toContain("\"facilityId\":")
  })

  it("'shared' filters to multi-facility rows the facility participates in", async () => {
    await getContracts({ facilityScope: "shared" })
    const call = findManyMock.mock.calls[0][0]
    const where = JSON.stringify(call.where)
    expect(where).toContain("isMultiFacility")
    expect(where).toContain("contractFacilities")
  })
})
