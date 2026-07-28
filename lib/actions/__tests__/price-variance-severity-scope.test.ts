/**
 * SCOPE BUG (2026-07-28), sibling of `price-discrepancy-scope.test.ts`.
 *
 * The Price Discrepancy report's DEFAULT tab
 * (`components/facility/reports/price-variance-dashboard.tsx`) built its
 * severity cards, its severity chart, its per-vendor overcharge /
 * undercharge totals and its major-line drill-down by reducing over
 * `getPriceDiscrepancies()` — which stops at `PRICE_DISCREPANCY_ROW_CAP`
 * (1,500) rows ordered by variance % DESCENDING.
 *
 * Measured against the production snapshot's Lighthouse Surgical Center
 * (44,812 qualifying rows) the reducer showed "Major: 1,500 lines /
 * +$1,295,024" where the truth is 3,346 lines carrying $1,901,307 of
 * overcharge and $4,176,877 of discount, and showed "Moderate: 0 / $0"
 * for a band holding 2,435 real lines — because variance-% DESC keeps
 * only the overcharge tail. The dev seed (1,135 rows, under the cap)
 * agreed with the truth either way, which is why it never reproduced
 * locally.
 *
 * `getPriceVarianceSeverityBreakdown` is the companion aggregate. These
 * tests pin that (1) every band number is computed over the full set,
 * (2) the band predicates are the two-sided |variance %| bands the cards
 * are labelled with, (3) the two dollar directions are never netted,
 * (4) off-contract lines are counted rather than silently dropped,
 * (5) the vendor list is aggregated facility-wide, (6) the drill-down is
 * a two-sided top-N, and (7) every read is tenant-scoped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type NumericFilter = {
  gt?: number
  gte?: number
  lt?: number
  lte?: number
}

type Where = {
  facilityId: string
  matchStatus: { in: string[] }
  savingsAmount?: NumericFilter | null
  variancePercent?: NumericFilter | null
  OR?: { variancePercent: NumericFilter }[]
}

type CountArgs = { where: Where }
type AggregateArgs = { where: Where }
type GroupByArgs = {
  by: string[]
  where: Where
  _sum?: { savingsAmount: boolean }
  _count?: { _all: boolean }
}
type FindManyArgs = {
  where: Where
  take: number
  orderBy: { savingsAmount: "asc" | "desc" }
}

/** Keyed by a stable description of the where clause. */
let counts: Array<number> = []
let aggregates: Array<{ sum: number | null; count: number }> = []
let groups: Array<
  Array<{
    vendorId: string | null
    _sum?: { savingsAmount: number | null }
    _count: { _all: number }
  }>
> = []
let findManyRows: Array<Array<Record<string, unknown>>> = []

const countMock = vi.fn(async (_args: CountArgs) => counts.shift() ?? 0)
const aggregateMock = vi.fn(async (_args: AggregateArgs) => {
  const next = aggregates.shift() ?? { sum: null, count: 0 }
  return { _sum: { savingsAmount: next.sum }, _count: { _all: next.count } }
})
const groupByMock = vi.fn(async (_args: GroupByArgs) => groups.shift() ?? [])
const findManyMock = vi.fn(async (_args: FindManyArgs) => findManyRows.shift() ?? [])
const vendorFindManyMock = vi.fn(
  async (_args: { where: { id: { in: string[] } } }) => [
    { id: "v-1", name: "Arthrex" },
    { id: "v-2", name: "Stryker" },
  ],
)

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      count: (args: unknown) => countMock(args as CountArgs),
      aggregate: (args: unknown) => aggregateMock(args as AggregateArgs),
      groupBy: (args: unknown) => groupByMock(args as GroupByArgs),
      findMany: (args: unknown) => findManyMock(args as FindManyArgs),
    },
    vendor: {
      findMany: (args: unknown) =>
        vendorFindManyMock(args as { where: { id: { in: string[] } } }),
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

import { getPriceVarianceSeverityBreakdown } from "@/lib/actions/reports"
import { PRICE_VARIANCE_THRESHOLD } from "@/lib/contracts/match"

/**
 * The production snapshot's Lighthouse Surgical Center, in the exact
 * order the action issues its reads: total, minor/moderate/major counts,
 * then six sign-split aggregates (minor over, minor under, moderate
 * over, moderate under, major over, major under).
 *
 * savingsAmount is (contractPrice − unitCost) × quantity, so the
 * OVERCHARGE sums are negative in the DB and positive on the card.
 */
function seedProductionSnapshot() {
  counts = [44_812, 0, 2_435, 3_346]
  aggregates = [
    { sum: null, count: 0 }, // minor overcharge
    { sum: null, count: 0 }, // minor undercharge
    { sum: -5_684.33, count: 23 }, // moderate overcharge
    { sum: 65_662.18, count: 2_412 }, // moderate undercharge
    { sum: -1_901_306.94, count: 2_392 }, // major overcharge
    { sum: 4_176_877.37, count: 755 }, // major undercharge
  ]
  // The vendor groups are the SAME facility-wide dollars re-partitioned:
  // overcharge sums to −$1,906,991.27 (= moderate + major overcharge) and
  // undercharge to +$4,242,539.55, with 2,415 / 3,167 / 44,812 / 3,346
  // lines. The parity test below leans on that.
  groups = [
    // overcharge by vendor
    [
      { vendorId: "v-1", _sum: { savingsAmount: -1_500_000 }, _count: { _all: 1_800 } },
      { vendorId: "v-2", _sum: { savingsAmount: -406_991.27 }, _count: { _all: 615 } },
    ],
    // undercharge by vendor
    [
      { vendorId: "v-1", _sum: { savingsAmount: 3_000_000 }, _count: { _all: 2_000 } },
      { vendorId: "v-2", _sum: { savingsAmount: 1_242_539.55 }, _count: { _all: 1_167 } },
    ],
    // all discrepancy lines by vendor (includes the off-contract tail)
    [
      { vendorId: "v-1", _count: { _all: 30_000 } },
      { vendorId: "v-2", _count: { _all: 14_812 } },
    ],
    // major lines by vendor
    [
      { vendorId: "v-1", _count: { _all: 2_000 } },
      { vendorId: "v-2", _count: { _all: 1_346 } },
    ],
  ]
  findManyRows = [[], []]
}

beforeEach(() => {
  vi.clearAllMocks()
  counts = []
  aggregates = []
  groups = []
  findManyRows = []
})

describe("getPriceVarianceSeverityBreakdown — full-scope severity bands", () => {
  it("reports every banded line, not the 1,500 the row sample would have held", async () => {
    seedProductionSnapshot()

    const breakdown = await getPriceVarianceSeverityBreakdown("current")

    // The capped reducer showed Major: 1,500 (exactly the cap) and
    // Moderate: 0. Both come from Postgres now.
    expect(breakdown.bands.major.lines).toBe(3_346)
    expect(breakdown.bands.moderate.lines).toBe(2_435)
    expect(breakdown.bands.minor.lines).toBe(0)
    expect(breakdown.totalLines).toBe(44_812)
    // Never a row read: the sample array plays no part in these numbers.
    expect(findManyMock.mock.calls.every(([args]) => args.take === 25)).toBe(true)
  })

  it("splits each band by direction and never nets the two", async () => {
    seedProductionSnapshot()

    const { bands } = await getPriceVarianceSeverityBreakdown()

    // Netting the major band gives −$2,275,570 — a number that hides
    // every recoverable dollar behind the discounts that outweigh them.
    expect(bands.major.overchargeTotal).toBeCloseTo(1_901_306.94, 2)
    expect(bands.major.underchargeTotal).toBeCloseTo(4_176_877.37, 2)
    expect(bands.major.overchargeLines).toBe(2_392)
    expect(bands.major.underchargeLines).toBe(755)
    expect(bands.moderate.overchargeTotal).toBeCloseTo(5_684.33, 2)
    expect(bands.moderate.underchargeTotal).toBeCloseTo(65_662.18, 2)
  })

  it("reconciles each band's two dollar buckets against its line count", async () => {
    seedProductionSnapshot()

    const { bands } = await getPriceVarianceSeverityBreakdown()

    // 3,346 major = 2,392 overcharge + 755 undercharge + 199 whose
    // savingsAmount enrichment suppressed as untrustworthy.
    expect(bands.major.withoutDollarImpact).toBe(199)
    expect(
      bands.major.overchargeLines +
        bands.major.underchargeLines +
        bands.major.withoutDollarImpact,
    ).toBe(bands.major.lines)
  })

  it("counts off-contract lines rather than letting them vanish", async () => {
    seedProductionSnapshot()

    const breakdown = await getPriceVarianceSeverityBreakdown()

    // 44,812 − (0 + 2,435 + 3,346): lines with no contract price, so no
    // variance % and no band. 87% of the report's rows.
    expect(breakdown.unbandedLines).toBe(39_031)
    expect(
      breakdown.bands.minor.lines +
        breakdown.bands.moderate.lines +
        breakdown.bands.major.lines +
        breakdown.unbandedLines,
    ).toBe(breakdown.totalLines)
  })

  it("coalesces a null _sum (empty band) to zero dollars, never NaN or -0", async () => {
    counts = [3, 3, 0, 0]
    aggregates = Array.from({ length: 6 }, () => ({ sum: null, count: 0 }))
    groups = [[], [], [], []]
    findManyRows = [[], []]

    const { bands } = await getPriceVarianceSeverityBreakdown()

    expect(bands.minor.overchargeTotal).toBe(0)
    expect(Object.is(bands.minor.overchargeTotal, -0)).toBe(false)
    expect(bands.minor.underchargeTotal).toBe(0)
    expect(bands.major.withoutDollarImpact).toBe(0)
  })

  it("never reports a negative leftover if the reads race", async () => {
    // The band count and its two sign aggregates are separate round
    // trips; a concurrent import between them must not print "−12 with
    // no dollar figure".
    counts = [100, 0, 0, 40]
    aggregates = [
      { sum: null, count: 0 },
      { sum: null, count: 0 },
      { sum: null, count: 0 },
      { sum: null, count: 0 },
      { sum: -1, count: 30 },
      { sum: 1, count: 25 },
    ]
    groups = [[], [], [], []]
    findManyRows = [[], []]

    const { bands, unbandedLines } = await getPriceVarianceSeverityBreakdown()

    expect(bands.major.withoutDollarImpact).toBe(0)
    expect(unbandedLines).toBe(60)
  })
})

describe("getPriceVarianceSeverityBreakdown — band predicates", () => {
  /** The band `where` clauses, in issue order: minor, moderate, major. */
  async function bandWheres() {
    counts = [0, 0, 0, 0]
    aggregates = Array.from({ length: 6 }, () => ({ sum: null, count: 0 }))
    groups = [[], [], [], []]
    findManyRows = [[], []]
    await getPriceVarianceSeverityBreakdown()
    // call 0 is the unfiltered total.
    return countMock.mock.calls.slice(1).map(([args]) => args.where)
  }

  it("bands on ABSOLUTE variance, so a −12% discount is as major as +12%", async () => {
    const [, , major] = await bandWheres()
    // A single `gte: 10` range would classify every deep discount as
    // unbanded and quietly drop it off all three cards.
    expect(major.OR).toEqual([
      { variancePercent: { gte: 10 } },
      { variancePercent: { lte: -10 } },
    ])
  })

  it("puts the minor edge exactly where the matcher puts on-contract", async () => {
    const [minor] = await bandWheres()
    // The matcher stamps |variance| <= PRICE_VARIANCE_THRESHOLD as
    // `on_contract`, and this report's set is price_variance +
    // off_contract_item only — so the minor band is structurally empty
    // (0 lines in the dev seed AND in the production snapshot). The
    // dashboard's Minor card says so in its scope line; if this
    // threshold ever moves, both the band and that card's "±2%" copy
    // have to move with it.
    expect(PRICE_VARIANCE_THRESHOLD).toBe(2)
    expect(minor.variancePercent).toEqual({
      gt: -PRICE_VARIANCE_THRESHOLD,
      lt: PRICE_VARIANCE_THRESHOLD,
    })
  })

  it("matches the thresholds the cards are labelled with", async () => {
    const [minor, moderate, major] = await bandWheres()
    // "Minor (<2%)" — strictly inside ±2.
    expect(minor.variancePercent).toEqual({ gt: -2, lt: 2 })
    // "Moderate (2–10%)" — 2 inclusive, 10 exclusive, both signs.
    expect(moderate.OR).toEqual([
      { variancePercent: { gte: 2, lt: 10 } },
      { variancePercent: { gt: -10, lte: -2 } },
    ])
    // "Major (≥10%)" — 10 inclusive. The bands must tile without gaps
    // or overlap: 2 belongs to moderate only, 10 to major only.
    expect(major.OR?.[0]).toEqual({ variancePercent: { gte: 10 } })
  })
})

describe("getPriceVarianceSeverityBreakdown — vendor totals + drill-down", () => {
  it("aggregates vendors over the full set, and never nets a vendor's two directions", async () => {
    seedProductionSnapshot()

    const { vendors } = await getPriceVarianceSeverityBreakdown()

    expect(vendors).toHaveLength(2)
    const [first] = vendors
    expect(first.vendorName).toBe("Arthrex")
    expect(first.overchargeTotal).toBe(1_500_000)
    expect(first.underchargeTotal).toBe(3_000_000)
    // "Lines" is every qualifying line for the vendor, including the
    // off-contract tail — not just the ones that survived a cap.
    expect(first.lines).toBe(30_000)
    expect(first.majorLines).toBe(2_000)
    // Sorted by overcharge, biggest first, so the table's top-N slice is
    // the money slice.
    expect(vendors.map((v) => v.vendorName)).toEqual(["Arthrex", "Stryker"])
  })

  it("the vendor buckets and the band buckets are two partitions of the same dollars", async () => {
    seedProductionSnapshot()

    const { vendors, bands } = await getPriceVarianceSeverityBreakdown()

    const vendorOver = vendors.reduce((s, v) => s + v.overchargeTotal, 0)
    const vendorUnder = vendors.reduce((s, v) => s + v.underchargeTotal, 0)
    const bandOver =
      bands.minor.overchargeTotal +
      bands.moderate.overchargeTotal +
      bands.major.overchargeTotal
    const bandUnder =
      bands.minor.underchargeTotal +
      bands.moderate.underchargeTotal +
      bands.major.underchargeTotal
    // Off-contract lines carry no savingsAmount, so they contribute $0
    // to both partitions — the two must land on the same dollars.
    expect(vendorOver).toBeCloseTo(bandOver, 2)
    expect(vendorUnder).toBeCloseTo(bandUnder, 2)
  })

  it("keeps unlinked-vendor rows in one bucket instead of dropping them", async () => {
    counts = [5, 0, 0, 5]
    aggregates = Array.from({ length: 6 }, () => ({ sum: null, count: 0 }))
    groups = [
      [{ vendorId: null, _sum: { savingsAmount: -900 }, _count: { _all: 5 } }],
      [],
      [{ vendorId: null, _count: { _all: 5 } }],
      [{ vendorId: null, _count: { _all: 5 } }],
    ]
    findManyRows = [[], []]

    const { vendors } = await getPriceVarianceSeverityBreakdown()

    expect(vendors).toHaveLength(1)
    expect(vendors[0].vendorName).toBe("Unknown vendor")
    expect(vendors[0].overchargeTotal).toBe(900)
    // No vendorIds to resolve — don't issue the name lookup at all.
    expect(vendorFindManyMock).not.toHaveBeenCalled()
  })

  it("ranks the drill-down by ABSOLUTE impact across both directions", async () => {
    counts = [4, 0, 0, 4]
    aggregates = Array.from({ length: 6 }, () => ({ sum: null, count: 0 }))
    groups = [[], [], [], []]
    findManyRows = [
      // biggest overcharges (savingsAmount ASC)
      [
        {
          id: "over-1",
          poNumber: "PO-1",
          vendorId: "v-1",
          vendorName: "Arthrex",
          inventoryDescription: "Screw",
          vendorItemNo: "SKU-1",
          variancePercent: 40,
          savingsAmount: -12_000,
        },
      ],
      // biggest discounts (savingsAmount DESC)
      [
        {
          id: "under-1",
          poNumber: "PO-2",
          vendorId: "v-2",
          vendorName: "Stryker",
          inventoryDescription: "Plate",
          vendorItemNo: null,
          variancePercent: -55,
          savingsAmount: 90_000,
        },
      ],
    ]

    const { majorLineSample, majorLineSampleSize } =
      await getPriceVarianceSeverityBreakdown()

    // A −$90k discount outranks a +$12k overcharge on magnitude. Taking
    // only the variance-% DESC tail would never have surfaced it.
    expect(majorLineSample.map((r) => r.id)).toEqual(["under-1", "over-1"])
    // dollarImpact is POSITIVE when the facility overpaid, matching
    // variancePercent's sign — never a double negation.
    expect(majorLineSample[0].dollarImpact).toBe(-90_000)
    expect(majorLineSample[1].dollarImpact).toBe(12_000)
    expect(majorLineSampleSize).toBe(25)

    // Both ends are read, each capped at the sample size.
    const orders = findManyMock.mock.calls.map(([args]) => args.orderBy)
    expect(orders).toEqual([
      { savingsAmount: "asc" },
      { savingsAmount: "desc" },
    ])
    for (const [args] of findManyMock.mock.calls) {
      expect(args.take).toBe(majorLineSampleSize)
    }
  })
})

describe("getPriceVarianceSeverityBreakdown — tenant + filter scope", () => {
  it("scopes every read to the session facility and the discrepancy filter", async () => {
    seedProductionSnapshot()

    await getPriceVarianceSeverityBreakdown("some-other-facility-id")

    const wheres: Where[] = [
      ...countMock.mock.calls.map(([args]) => args.where),
      ...aggregateMock.mock.calls.map(([args]) => args.where),
      ...groupByMock.mock.calls.map(([args]) => args.where),
      ...findManyMock.mock.calls.map(([args]) => args.where),
    ]
    // 4 counts + 6 aggregates + 4 groupBys + 2 findManys.
    expect(wheres).toHaveLength(16)
    for (const where of wheres) {
      // The client-supplied facilityId argument is ignored.
      expect(where.facilityId).toBe("fac-test")
      expect(where.matchStatus.in).toEqual([
        "price_variance",
        "off_contract_item",
      ])
    }
  })

  it("issues one parallel batch, not a query per band-and-vendor", async () => {
    seedProductionSnapshot()

    await getPriceVarianceSeverityBreakdown()

    expect(countMock).toHaveBeenCalledTimes(4)
    expect(aggregateMock).toHaveBeenCalledTimes(6)
    expect(groupByMock).toHaveBeenCalledTimes(4)
    expect(findManyMock).toHaveBeenCalledTimes(2)
    // Vendor names resolve in ONE lookup for every group, not per row.
    expect(vendorFindManyMock).toHaveBeenCalledTimes(1)
    expect(vendorFindManyMock.mock.calls[0][0].where.id.in).toEqual([
      "v-1",
      "v-2",
    ])
  })

  it("groups vendors by id alone — a vendor spelled two ways stays one row", async () => {
    seedProductionSnapshot()

    await getPriceVarianceSeverityBreakdown()

    for (const [args] of groupByMock.mock.calls) {
      // `COGRecord.vendorName` is free text off the import and the
      // production snapshot already has one vendorId carrying two
      // spellings — including it in the key would split that vendor.
      expect(args.by).toEqual(["vendorId"])
    }
  })
})
