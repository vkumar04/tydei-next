import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Contracts hero — every number on it must be computed over the facility
 * SCOPE, not over the page of rows the table happens to have loaded.
 *
 * The bug this pins (2026-07-28): "Total Contracts" came from a real
 * `prisma.contract.count()` in `getContractStats` while "Active" and
 * "Expiring Soon" were counted client-side from `getContracts`'s first
 * page (`pageSize` defaults to 20). A 45-contract facility rendered
 * "45 Total / 20 Active" — Active could not structurally exceed the page
 * size — and "expiring soon" moved with whatever had been edited most
 * recently, because the page is ordered `updatedAt desc`.
 *
 * Invariants:
 *   1. `activeContracts` is unbounded by any page size.
 *   2. `totalContracts` and `activeContracts` come from the SAME query, so
 *      the two numbers on that hero row cannot describe different sets.
 *   3. Per-status counting is ONE `groupBy`, not one `count` per status.
 *   4. `expiringSoon` is a scoped, date-filtered DB count, and the window
 *      it used is echoed back so the pill's label can't drift from it.
 */

const { groupByMock, countMock, aggregateMock, rebateAggregateMock } =
  vi.hoisted(() => ({
    groupByMock: vi.fn(),
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

/** 45 contracts, 31 of them active — both well past a 20-row page. */
const BIG_PORTFOLIO = [
  { status: "active", _count: 31 },
  { status: "expiring", _count: 6 },
  { status: "expired", _count: 5 },
  { status: "draft", _count: 2 },
  { status: "pending", _count: 1 },
]

beforeEach(() => {
  vi.clearAllMocks()
  groupByMock.mockResolvedValue(BIG_PORTFOLIO)
  countMock.mockResolvedValue(0)
  aggregateMock.mockResolvedValue({
    _sum: { totalValue: 0, annualValue: 0 },
  })
  rebateAggregateMock.mockResolvedValue({ _sum: { rebateEarned: 0 } })
})

describe("getContractStats — hero numbers are scope-wide", () => {
  it("counts every active contract, not just the first page", async () => {
    const stats = await getContractStats({})
    // 31 > any page size the list query uses (20 before the fix, 100 now).
    expect(stats.activeContracts).toBe(31)
    expect(stats.totalContracts).toBe(45)
  })

  it("derives total and active from ONE query so they share a scope", async () => {
    await getContractStats({})
    expect(groupByMock).toHaveBeenCalledTimes(1)
    const call = groupByMock.mock.calls[0][0]
    expect(call.by).toEqual(["status"])
    // One grouped round trip — never one count per status.
    expect(countMock).toHaveBeenCalledTimes(1)
  })

  it("totalContracts is exactly the sum of the status buckets", async () => {
    groupByMock.mockResolvedValueOnce([
      { status: "active", _count: 4 },
      { status: "expired", _count: 3 },
    ])
    const stats = await getContractStats({})
    expect(stats.totalContracts).toBe(7)
    expect(stats.activeContracts).toBe(4)
  })

  it("counts expiring-soon in the DB over the same scope", async () => {
    countMock.mockResolvedValueOnce(9)
    const stats = await getContractStats({})
    expect(stats.expiringSoon).toBe(9)

    const where = countMock.mock.calls[0][0].where
    const serialized = JSON.stringify(where)
    // Tenant scope survives into the expiring predicate.
    expect(serialized).toContain("fac-1")
    // Date-window predicate, not a page scan.
    expect(serialized).toContain("expirationDate")
    expect(serialized).toContain("expired")
  })

  it("filters expiring-soon to a forward window matching the reported label", async () => {
    const stats = await getContractStats({})
    expect(stats.expiringSoonWindowDays).toBe(30)

    const clauses = countMock.mock.calls[0][0].where.AND as Array<
      Record<string, unknown>
    >
    const dateClause = clauses.find((c) => "expirationDate" in c) as {
      expirationDate: { gt: Date; lte: Date }
      status: { not: string }
    }
    expect(dateClause.status).toEqual({ not: "expired" })
    const spanDays =
      (dateClause.expirationDate.lte.getTime() -
        dateClause.expirationDate.gt.getTime()) /
      (24 * 60 * 60 * 1000)
    expect(Math.round(spanDays)).toBe(stats.expiringSoonWindowDays)
  })

  it("applies the requested facilityScope to every hero number", async () => {
    await getContractStats({ facilityScope: "shared" })
    for (const mock of [groupByMock, aggregateMock]) {
      expect(JSON.stringify(mock.mock.calls[0][0].where)).toContain(
        "isMultiFacility",
      )
    }
    expect(JSON.stringify(countMock.mock.calls[0][0].where)).toContain(
      "isMultiFacility",
    )
  })

  it("sums the YTD rebate ledger over the SAME contracts the counts describe", async () => {
    // The hero prints "Total Contracts" and "Rebates Earned (YTD)" on one
    // row. Under scope "shared" the counts cover multi-facility contracts
    // only; a ledger filtered by facilityId alone would also sum rebates
    // from single-facility contracts the hero never counted.
    await getContractStats({ facilityScope: "shared" })
    const rebateWhere = rebateAggregateMock.mock.calls[0][0].where
    expect(JSON.stringify(rebateWhere.contract)).toBe(
      JSON.stringify(groupByMock.mock.calls[0][0].where),
    )
    // …and the facility clause stays on top, so a shared contract's
    // peer-facility rebate rows never land in this facility's total.
    expect(rebateWhere.facilityId).toBe("fac-1")
  })

  it("floors the rebate window at the calendar year the card's label claims", async () => {
    const stats = await getContractStats({})
    expect(stats.totalRebates).toBe(0)
    const { payPeriodEnd } = rebateAggregateMock.mock.calls[0][0].where as {
      payPeriodEnd: { gte: Date; lte: Date }
    }
    expect(payPeriodEnd.gte.getMonth()).toBe(0)
    expect(payPeriodEnd.gte.getDate()).toBe(1)
    expect(payPeriodEnd.gte.getFullYear()).toBe(payPeriodEnd.lte.getFullYear())
  })

  it("coalesces a null _sum (no rows in scope) instead of leaking null", async () => {
    // Prisma returns `_sum.<col> === null` when nothing matches.
    aggregateMock.mockResolvedValueOnce({
      _sum: { totalValue: null, annualValue: null },
    })
    rebateAggregateMock.mockResolvedValueOnce({ _sum: { rebateEarned: null } })
    const stats = await getContractStats({})
    expect(stats.totalValue).toBe(0)
    expect(stats.totalRebates).toBe(0)
  })

  it("converts Decimal sums to numbers rather than concatenating them", async () => {
    // Prisma Decimal columns arrive as Decimal-like objects; a string-ish
    // sum would make `totalValue` a string and silently break formatCurrency.
    const decimalish = {
      toString: () => "1500.50",
      valueOf: () => 1500.5,
    } as unknown as number
    aggregateMock.mockResolvedValueOnce({
      _sum: { totalValue: decimalish, annualValue: null },
    })
    const stats = await getContractStats({})
    expect(typeof stats.totalValue).toBe("number")
    expect(stats.totalValue).toBeCloseTo(1500.5)
  })

  it("keeps money and counts on the same scope ('all' drops the facility filter everywhere)", async () => {
    aggregateMock.mockResolvedValueOnce({
      _sum: { totalValue: 1234, annualValue: 0 },
    })
    const stats = await getContractStats({ facilityScope: "all" })
    expect(stats.totalValue).toBe(1234)
    for (const mock of [groupByMock, aggregateMock, countMock]) {
      expect(JSON.stringify(mock.mock.calls[0][0].where)).not.toContain(
        '"facilityId":"fac-1"',
      )
    }
  })
})
