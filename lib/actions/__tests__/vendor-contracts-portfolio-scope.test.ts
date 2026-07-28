import { describe, it, expect, vi, beforeEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"

/**
 * Charles 2026-07-27 — vendor Contracts hero understated Total Value.
 *
 * The hero ("Total Contracts / Active / Facilities Served / Total Value —
 * Lifetime commitment") was reduced client-side over whatever
 * `getVendorContracts` returned, which was a 20-row first page ordered
 * `updatedAt desc`. A vendor with 60 contracts averaging $500k saw a
 * headline roughly $20M short, and a facility filter missing every
 * facility whose contracts hadn't been touched recently — with nothing
 * on screen saying a cap had been applied.
 *
 * These tests pin the fix: every portfolio number is computed SERVER-SIDE
 * over the vendor-ownership predicate, in one batched round trip, and is
 * therefore independent of the page window and of the status filter.
 */

const PAGE_ROWS = [
  { id: "c-1", status: "active", totalValue: 1, facility: { id: "f-1", name: "Lighthouse Surgical Center" } },
  { id: "c-2", status: "active", totalValue: 1, facility: { id: "f-1", name: "Lighthouse Surgical Center" } },
]

const {
  findManyMock,
  countMock,
  aggregateMock,
  groupByMock,
  facilityFindManyMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn().mockResolvedValue([]),
  // The action issues two counts: the filtered pagination total, and the
  // expiring-soon count. Discriminate on the where-clause rather than on
  // call order so the test doesn't depend on Promise.all ordering.
  countMock: vi.fn(async (args: { where?: unknown }) => {
    const where = JSON.stringify(args?.where ?? {})
    return where.includes("expirationDate") ? 4 : 60
  }),
  aggregateMock: vi
    .fn()
    .mockResolvedValue({ _count: { id: 60 }, _sum: { totalValue: 30_000_000 } }),
  groupByMock: vi.fn().mockResolvedValue([
    { status: "active", _count: 41 },
    { status: "expired", _count: 15 },
    { status: "draft", _count: 4 },
  ]),
  facilityFindManyMock: vi.fn().mockResolvedValue([
    { id: "f-1", name: "Lighthouse Surgical Center" },
    { id: "f-2", name: "Lighthouse Community Hospital" },
    { id: "f-3", name: "Harbor Ambulatory" },
  ]),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: findManyMock,
      count: countMock,
      aggregate: aggregateMock,
      groupBy: groupByMock,
    },
    facility: { findMany: facilityFindManyMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireVendor: vi.fn().mockResolvedValue({
    vendor: { id: "ven-1" },
    user: { id: "u-1" },
  }),
}))

import { getVendorContracts } from "@/lib/actions/vendor-contracts"

beforeEach(() => {
  vi.clearAllMocks()
  findManyMock.mockResolvedValue(PAGE_ROWS)
})

describe("getVendorContracts — portfolio rollup is not the page", () => {
  it("Total Value comes from the server _sum, not a reduce over the page", async () => {
    const res = await getVendorContracts({})
    // The page carries $2 of totalValue; the portfolio is $30M.
    expect(res.contracts).toHaveLength(2)
    expect(res.portfolio.totalValue).toBe(30_000_000)
  })

  it("Total Contracts comes from the server _count, not contracts.length", async () => {
    const res = await getVendorContracts({})
    expect(res.portfolio.contractCount).toBe(60)
    expect(res.portfolio.contractCount).not.toBe(res.contracts.length)
  })

  it("count and money are aggregated in ONE query, so they share a scope", async () => {
    await getVendorContracts({})
    expect(aggregateMock).toHaveBeenCalledTimes(1)
    const args = aggregateMock.mock.calls[0][0]
    expect(args._count).toEqual({ id: true })
    expect(args._sum).toEqual({ totalValue: true })
    // Same `where` object drives both halves of the aggregate.
    expect(JSON.stringify(args.where)).toContain("ven-1")
  })

  it("status splits come from ONE groupBy, not N counts", async () => {
    const res = await getVendorContracts({})
    expect(groupByMock).toHaveBeenCalledTimes(1)
    expect(groupByMock.mock.calls[0][0].by).toEqual(["status"])
    expect(res.portfolio.activeCount).toBe(41)
    expect(res.portfolio.statusCounts.expired).toBe(15)
    // Statuses absent from the groupBy result read as 0, never undefined.
    expect(res.portfolio.statusCounts.expiring).toBe(0)
    expect(res.portfolio.statusCounts.pending).toBe(0)
    // Two counts is the pagination total + expiring-soon; the five status
    // splits must NOT each be their own count() call.
    expect(countMock).toHaveBeenCalledTimes(2)
  })

  it("facilities served is the distinct portfolio list, not the page's facilities", async () => {
    const res = await getVendorContracts({})
    // The page only ever mentions f-1.
    expect(res.portfolio.facilitiesServed).toBe(3)
    expect(res.portfolio.facilities.map((f) => f.id)).toEqual([
      "f-1",
      "f-2",
      "f-3",
    ])
  })

  it("expiring-soon is counted server-side over the whole portfolio", async () => {
    const res = await getVendorContracts({})
    expect(res.portfolio.expiringSoonCount).toBe(4)
    expect(res.portfolio.expiringSoonWindowDays).toBe(30)
    const expiringCall = countMock.mock.calls.find((c) =>
      JSON.stringify(c[0].where).includes("expirationDate"),
    )
    expect(expiringCall).toBeDefined()
    expect(JSON.stringify(expiringCall?.[0].where)).toContain("ven-1")
  })

  it("expiring-soon counts every non-expired contract in the window, including status `expiring`", async () => {
    await getVendorContracts({})
    const expiringWhere = countMock.mock.calls.find((c) =>
      JSON.stringify(c[0].where).includes("expirationDate"),
    )?.[0].where as { AND: Record<string, unknown>[] }
    const predicate = expiringWhere.AND.find((clause) => "status" in clause) as {
      status: { not: string }
      expirationDate: { gt: Date; lte: Date }
    }
    // The badge says "expiring in 30 days"; a contract already flagged
    // `expiring` is exactly that, so the count must not require `active`
    // (parity with getContractStats' predicate on the facility side).
    expect(predicate.status).toEqual({ not: "expired" })
    expect(JSON.stringify(expiringWhere)).not.toContain('"status":"active"')
    // …and the window it filters by is the window the label echoes.
    const spanDays =
      (predicate.expirationDate.lte.getTime() -
        predicate.expirationDate.gt.getTime()) /
      (24 * 60 * 60 * 1000)
    expect(Math.round(spanDays)).toBe(30)
  })

  it("_sum null (vendor with no contracts) coalesces to 0", async () => {
    aggregateMock.mockResolvedValueOnce({
      _count: { id: 0 },
      _sum: { totalValue: null },
    })
    const res = await getVendorContracts({})
    expect(res.portfolio.totalValue).toBe(0)
  })
})

describe("getVendorContracts — portfolio scope vs page scope", () => {
  it("every portfolio query is vendor-scoped (tenant isolation)", async () => {
    await getVendorContracts({ status: "active" })
    for (const call of [
      aggregateMock.mock.calls[0][0].where,
      groupByMock.mock.calls[0][0].where,
      facilityFindManyMock.mock.calls[0][0].where,
    ]) {
      const where = JSON.stringify(call)
      expect(where).toContain("ven-1")
      // Grouped contracts (vendor only in additionalVendorIds) stay in scope.
      expect(where).toContain("additionalVendorIds")
    }
  })

  it("the status filter narrows the page but NOT the portfolio rollup", async () => {
    await getVendorContracts({ status: "draft" })
    expect(JSON.stringify(findManyMock.mock.calls[0][0].where)).toContain(
      '"status":"draft"',
    )
    expect(JSON.stringify(aggregateMock.mock.calls[0][0].where)).not.toContain(
      '"status":"draft"',
    )
    expect(JSON.stringify(groupByMock.mock.calls[0][0].where)).not.toContain(
      '"status":"draft"',
    )
    expect(
      JSON.stringify(facilityFindManyMock.mock.calls[0][0].where),
    ).not.toContain('"status":"draft"')
  })

  it("the facility filter narrows the page SERVER-side, not the rollup", async () => {
    // The dropdown is built from `portfolio.facilities` — the whole
    // portfolio — so the pick has to reach the query. Filtered in the
    // client over a capped page, a facility whose contracts fell outside
    // the loaded rows would be selectable and then render nothing.
    await getVendorContracts({ facilityId: "f-3", pageSize: 200 })
    expect(JSON.stringify(findManyMock.mock.calls[0][0].where)).toContain(
      '"facilityId":"f-3"',
    )
    // `total` / `hasMore` are counted over the same narrowed set as the
    // rows (pick the pagination count, not the expiring-soon one).
    const pageCount = countMock.mock.calls.find(
      (c) => !JSON.stringify(c[0].where).includes("expirationDate"),
    )
    expect(JSON.stringify(pageCount?.[0].where)).toContain('"facilityId":"f-3"')
    for (const where of [
      aggregateMock.mock.calls[0][0].where,
      groupByMock.mock.calls[0][0].where,
      facilityFindManyMock.mock.calls[0][0].where,
    ]) {
      expect(JSON.stringify(where)).not.toContain("f-3")
    }
  })

  it("the `all` facility sentinel does not narrow anything", async () => {
    await getVendorContracts({ facilityId: "all" })
    expect(JSON.stringify(findManyMock.mock.calls[0][0].where)).not.toContain(
      "facilityId",
    )
  })

  it("the search filter narrows the page but NOT the portfolio rollup", async () => {
    await getVendorContracts({ search: "stryker" })
    expect(JSON.stringify(findManyMock.mock.calls[0][0].where)).toContain(
      "stryker",
    )
    expect(JSON.stringify(aggregateMock.mock.calls[0][0].where)).not.toContain(
      "stryker",
    )
  })
})

describe("getVendorContracts — the page cap is reported, never silent", () => {
  it("defaults to 20 rows and reports hasMore when the page truncates", async () => {
    const res = await getVendorContracts({})
    expect(findManyMock.mock.calls[0][0].take).toBe(20)
    expect(res.pageSize).toBe(20)
    // 2 rows returned of 60 matching → the caller must be able to say so.
    expect(res.total).toBe(60)
    expect(res.hasMore).toBe(true)
  })

  it("hasMore is false once the page covers the matching set", async () => {
    findManyMock.mockResolvedValueOnce(
      Array.from({ length: 60 }, (_, i) => ({ ...PAGE_ROWS[0], id: `c-${i}` })),
    )
    const res = await getVendorContracts({ pageSize: 200 })
    expect(res.hasMore).toBe(false)
  })

  it("honours a caller-supplied pageSize but clamps it", async () => {
    await getVendorContracts({ pageSize: 200 })
    expect(findManyMock.mock.calls[0][0].take).toBe(200)

    findManyMock.mockClear()
    const res = await getVendorContracts({ pageSize: 100_000 })
    expect(findManyMock.mock.calls[0][0].take).toBe(500)
    expect(res.pageSize).toBe(500)

    findManyMock.mockClear()
    await getVendorContracts({ pageSize: 0 })
    expect(findManyMock.mock.calls[0][0].take).toBe(1)
  })

  it("skip follows the clamped page size", async () => {
    await getVendorContracts({ page: 3, pageSize: 50 })
    expect(findManyMock.mock.calls[0][0].skip).toBe(100)
  })
})

describe("vendor-contract-list.tsx reads the rollup, not the page", () => {
  const componentPath = path.resolve(
    __dirname,
    "../../..",
    "components/vendor/contracts/vendor-contract-list.tsx",
  )

  it("hero money and counts are read from `portfolio`", async () => {
    const src = await fs.readFile(componentPath, "utf8")
    expect(src).toContain("portfolio?.totalValue")
    expect(src).toContain("portfolio?.contractCount")
    expect(src).toContain("portfolio?.activeCount")
    expect(src).toContain("portfolio?.expiringSoonCount")
    // The removed page-scoped array must not come back.
    expect(src).not.toContain("allContracts")
  })

  it("the facility filter is built from the portfolio's facility list", async () => {
    const src = await fs.readFile(componentPath, "utf8")
    expect(src).toContain("portfolio?.facilities")
  })

  it("hands the chosen facility to the server instead of filtering a page", async () => {
    const src = await fs.readFile(componentPath, "utf8")
    // Options come from the whole portfolio, so the query must be narrowed
    // by the pick — otherwise an offered facility can render an empty table.
    expect(src).toContain("facilityId: facilityFilter")
  })

  it("the hero waits for BOTH populations before rendering a total", async () => {
    const src = await fs.readFile(componentPath, "utf8")
    // Hero numbers = server rollup + in-flight submissions. Gating on
    // `isLoading && !portfolio` rendered the rollup half alone the moment
    // it landed, i.e. a total missing every submission.
    expect(src).not.toContain("isLoading={isLoading && !portfolio}")
    expect(src).toContain("isLoading={isLoading}")
  })

  it("asks for more than the 20-row default and labels the cap", async () => {
    const src = await fs.readFile(componentPath, "utf8")
    expect(src).toContain("pageSize: CONTRACT_LIST_PAGE_SIZE")
    // A truncated result set must be named on screen.
    expect(src).toContain("data?.hasMore")
  })
})
