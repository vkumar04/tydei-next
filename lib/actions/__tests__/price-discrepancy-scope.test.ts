/**
 * SCOPE BUG (2026-07-28): `getPriceDiscrepancies` caps its read at 1,500
 * rows and returned a NAKED ARRAY — no companion count — so the Price
 * Discrepancy report's four summary cards (Total Discrepancies, Total
 * Overcharges $, Total Undercharges $, Est. Savings $) reduced over the
 * capped sample and presented it as the facility's total. The local seed
 * already puts Lighthouse Surgical Center at 1,135 qualifying rows.
 *
 * `getPriceDiscrepancySummary` is the companion aggregate: same facility,
 * same `matchStatus` filter, no cap. These tests pin that (1) the totals
 * are computed over the full set, (2) the two directions are never
 * netted, (3) both reads are tenant-scoped to the session facility, and
 * (4) the row cap the UI labels is the cap the row read actually applies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type Where = {
  facilityId: string
  matchStatus: { in: string[] }
  savingsAmount?: { lt?: number; gt?: number }
}

let totalCount = 0
let overchargeAgg: { sum: number | null; count: number } = { sum: null, count: 0 }
let underchargeAgg: { sum: number | null; count: number } = { sum: null, count: 0 }
let rowFixtures: Array<Record<string, unknown>> = []

const countMock = vi.fn(async (_args: { where: Where }) => totalCount)

const aggregateMock = vi.fn(async (args: { where: Where }) => {
  const agg = args.where.savingsAmount?.lt != null ? overchargeAgg : underchargeAgg
  return { _sum: { savingsAmount: agg.sum }, _count: { _all: agg.count } }
})

const findManyMock = vi.fn(async (_args: { where: Where; take: number }) =>
  rowFixtures.slice(0, _args.take),
)

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      count: (args: unknown) => countMock(args as never),
      aggregate: (args: unknown) => aggregateMock(args as never),
      findMany: (args: unknown) => findManyMock(args as never),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test", name: "Lighthouse Surgical Center" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import {
  getPriceDiscrepancies,
  getPriceDiscrepancySummary,
} from "@/lib/actions/reports"

function cogRow(id: string) {
  return {
    id,
    poNumber: "PO-1",
    vendorName: "Arthrex",
    vendorId: "v-1",
    vendor: { id: "v-1", name: "Arthrex" },
    inventoryDescription: "Screw",
    vendorItemNo: "SKU-1",
    unitCost: 120,
    contractPrice: 100,
    variancePercent: 20,
    quantity: 2,
    extendedPrice: 240,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  totalCount = 0
  overchargeAgg = { sum: null, count: 0 }
  underchargeAgg = { sum: null, count: 0 }
  rowFixtures = []
})

describe("getPriceDiscrepancySummary — full-scope totals", () => {
  it("counts every qualifying row, not the 1,500-row sample", async () => {
    totalCount = 4182
    rowFixtures = Array.from({ length: 4182 }, (_, i) => cogRow(`r-${i}`))

    const rows = await getPriceDiscrepancies("current")
    const summary = await getPriceDiscrepancySummary("current")

    expect(rows).toHaveLength(1500)
    expect(summary.totalDiscrepancies).toBe(4182)
    // The cap the UI labels is the cap the row read applies.
    expect(summary.rowCap).toBe(1500)
    expect(findManyMock.mock.calls[0][0].take).toBe(summary.rowCap)
  })

  it("splits overcharge/undercharge by sign and never nets them", async () => {
    totalCount = 900
    // savingsAmount is (contractPrice - unitCost) × quantity: NEGATIVE
    // when the facility overpaid. Equal and opposite dollars must NOT
    // collapse to $0.
    overchargeAgg = { sum: -50_000, count: 400 }
    underchargeAgg = { sum: 50_000, count: 300 }

    const summary = await getPriceDiscrepancySummary()

    expect(summary.overcharges).toEqual({ count: 400, amount: 50_000 })
    expect(summary.undercharges).toEqual({ count: 300, amount: 50_000 })
    // Est. Savings is the recoverable overcharge, at the same scope as
    // the count printed beside it.
    expect(summary.estimatedSavings).toBe(50_000)
    // 900 - 400 - 300 = rows with no dollar impact (off-contract items).
    expect(summary.withoutDollarImpact).toBe(200)
  })

  it("coalesces a null _sum (no matching rows) to zero dollars", async () => {
    totalCount = 3
    overchargeAgg = { sum: null, count: 0 }
    underchargeAgg = { sum: null, count: 0 }

    const summary = await getPriceDiscrepancySummary()

    expect(summary.overcharges).toEqual({ count: 0, amount: 0 })
    expect(summary.undercharges).toEqual({ count: 0, amount: 0 })
    expect(summary.estimatedSavings).toBe(0)
    expect(summary.totalDiscrepancies).toBe(3)
  })

  it("aggregates in one parallel round trip, not N counts", async () => {
    await getPriceDiscrepancySummary()

    expect(countMock).toHaveBeenCalledTimes(1)
    expect(aggregateMock).toHaveBeenCalledTimes(2)
  })

  it("the three facility-wide buckets reconcile to the total count", async () => {
    // The card row shows all three: a reader who adds the two dollar
    // buckets and compares to "Total Discrepancies" must land exactly on
    // the leftover the card names, not on an unexplained remainder.
    totalCount = 4182
    overchargeAgg = { sum: -472_173, count: 973 }
    underchargeAgg = { sum: 88_400, count: 209 }

    const summary = await getPriceDiscrepancySummary()

    expect(
      summary.overcharges.count +
        summary.undercharges.count +
        summary.withoutDollarImpact,
    ).toBe(summary.totalDiscrepancies)
    expect(summary.withoutDollarImpact).toBe(3000)
  })

  it("never reports a negative leftover if the three reads race", async () => {
    // count / overcharge-agg / undercharge-agg are three separate round
    // trips; a concurrent import between them could make the buckets
    // out-total the count. Clamp rather than print "-12 with no dollar
    // impact" on the card.
    totalCount = 100
    overchargeAgg = { sum: -1, count: 80 }
    underchargeAgg = { sum: 1, count: 32 }

    const summary = await getPriceDiscrepancySummary()

    expect(summary.withoutDollarImpact).toBe(0)
  })
})

describe("price-discrepancy reads — tenant + filter scope parity", () => {
  it("scopes the count, both aggregates and the row read to the session facility", async () => {
    rowFixtures = [cogRow("r-1")]

    await getPriceDiscrepancies("some-other-facility-id")
    await getPriceDiscrepancySummary("some-other-facility-id")

    const wheres: Where[] = [
      findManyMock.mock.calls[0][0].where,
      countMock.mock.calls[0][0].where,
      ...aggregateMock.mock.calls.map(([args]) => args.where),
    ]
    expect(wheres).toHaveLength(4)
    for (const where of wheres) {
      // The client-supplied facilityId argument is ignored: the session's
      // facility is the only scope.
      expect(where.facilityId).toBe("fac-test")
      expect(where.matchStatus.in).toEqual([
        "price_variance",
        "off_contract_item",
      ])
    }
  })

  it("the summary's dollar buckets carry the same filter as the total count", async () => {
    await getPriceDiscrepancySummary()

    const countWhere = countMock.mock.calls[0][0].where
    for (const [args] of aggregateMock.mock.calls) {
      expect(args.where.facilityId).toBe(countWhere.facilityId)
      expect(args.where.matchStatus).toEqual(countWhere.matchStatus)
      // ...differing ONLY by the sign predicate that splits the buckets.
      expect(args.where.savingsAmount).toBeDefined()
    }
    expect(countWhere.savingsAmount).toBeUndefined()
  })
})
