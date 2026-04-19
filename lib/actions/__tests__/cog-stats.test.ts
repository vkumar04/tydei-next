/**
 * Tests for `getCOGStats` — specifically the Total Savings behavior
 * (Charles W1.M). The old implementation multiplied totalSpend × 0.05
 * on the client, which rendered a synthetic savings figure even when
 * zero COG records had been matched. The new contract is:
 *
 *   - `totalSavings` = real `SUM(savingsAmount)` across matched rows
 *     (matchStatus in [on_contract, price_variance]). Zero if no rows
 *     are matched.
 *   - `matchedCount` lets the UI distinguish "truly zero savings" from
 *     "nothing to compute against".
 *   - `potentialEstimate` = `totalSpend × 0.05` is exposed only as an
 *     illustrative benchmark (muted secondary line), never the headline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type CogRow = {
  id: string
  facilityId: string
  vendorId: string | null
  vendorName: string | null
  extendedPrice: number
  savingsAmount: number | null
  matchStatus:
    | "pending"
    | "on_contract"
    | "price_variance"
    | "off_contract_item"
    | "out_of_scope"
    | "unknown_vendor"
  transactionDate: Date | null
}

let cogRows: CogRow[] = []
let onContractRawCount = 0

const applyFacility = (
  where: { facilityId?: string } | undefined,
): CogRow[] => {
  if (!where?.facilityId) return cogRows
  return cogRows.filter((r) => r.facilityId === where.facilityId)
}

const aggregate = vi.fn(
  async ({
    where,
    _sum,
    _min,
    _max,
    _count,
  }: {
    where: {
      facilityId: string
      matchStatus?: { in: string[] }
    }
    _sum?: { extendedPrice?: boolean; savingsAmount?: boolean }
    _min?: { transactionDate?: boolean }
    _max?: { transactionDate?: boolean }
    _count?: { _all?: boolean }
  }) => {
    let rows = applyFacility(where)
    if (where.matchStatus?.in) {
      const set = new Set(where.matchStatus.in)
      rows = rows.filter((r) => set.has(r.matchStatus))
    }
    const extendedPrice = rows.reduce((s, r) => s + r.extendedPrice, 0)
    const savingsAmount = rows.reduce(
      (s, r) => s + (r.savingsAmount ?? 0),
      0,
    )
    const dates = rows
      .map((r) => r.transactionDate)
      .filter((d): d is Date => d instanceof Date)
    return {
      _sum: {
        ...(_sum?.extendedPrice !== undefined ? { extendedPrice } : {}),
        ...(_sum?.savingsAmount !== undefined ? { savingsAmount } : {}),
      },
      _count: _count?._all !== undefined ? { _all: rows.length } : undefined,
      _min: _min?.transactionDate
        ? {
            transactionDate: dates.length
              ? new Date(Math.min(...dates.map((d) => d.getTime())))
              : null,
          }
        : undefined,
      _max: _max?.transactionDate
        ? {
            transactionDate: dates.length
              ? new Date(Math.max(...dates.map((d) => d.getTime())))
              : null,
          }
        : undefined,
    }
  },
)

const count = vi.fn(
  async ({ where }: { where: { facilityId: string } }) =>
    applyFacility(where).length,
)

const groupBy = vi.fn(
  async ({
    where,
  }: {
    where: { facilityId: string; vendorName?: unknown }
  }) => {
    const rows = applyFacility(where).filter(
      (r) => r.vendorName && r.vendorName !== "",
    )
    const byName = new Map<string, number>()
    for (const r of rows) {
      byName.set(r.vendorName ?? "", (byName.get(r.vendorName ?? "") ?? 0) + 1)
    }
    return Array.from(byName.entries()).map(([name, n]) => ({
      vendorName: name,
      _count: { id: n },
    }))
  },
)

const queryRaw = vi.fn(async () => [{ count: BigInt(onContractRawCount) }])

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      aggregate: (args: Parameters<typeof aggregate>[0]) => aggregate(args),
      count: (args: Parameters<typeof count>[0]) => count(args),
      groupBy: (args: Parameters<typeof groupBy>[0]) => groupBy(args),
    },
    $queryRaw: () => queryRaw(),
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  }),
}))

vi.mock("@/lib/audit", () => ({
  logAudit: async () => {},
}))

vi.mock("@/lib/serialize", () => ({
  // Passthrough — getCOGStats returns plain numbers already.
  serialize: <T,>(v: T) => v,
}))

import { getCOGStats } from "@/lib/actions/cog-records"

beforeEach(() => {
  vi.clearAllMocks()
  cogRows = []
  onContractRawCount = 0
})

describe("getCOGStats — Total Savings (Charles W1.M)", () => {
  it("returns totalSavings=0 and matchedCount=0 when no rows are matched", async () => {
    // Reproduces Charles's screenshot: 21k rows, $30M spend, zero
    // matched. The old code would return $1.53M as "savings". We must
    // return $0 and expose potentialEstimate separately.
    cogRows = Array.from({ length: 100 }).map((_, i) => ({
      id: `r-${i}`,
      facilityId: "fac-1",
      vendorId: null,
      vendorName: `Vendor ${i % 3}`,
      extendedPrice: 306_184.04, // 100 × this ≈ $30.6M
      savingsAmount: null,
      matchStatus: "off_contract_item" as const,
      transactionDate: new Date("2026-01-15"),
    }))

    const stats = await getCOGStats("fac-1")

    expect(stats.totalItems).toBe(100)
    expect(stats.totalSpend).toBeCloseTo(30_618_404, 0)
    expect(stats.matchedCount).toBe(0)
    expect(stats.totalSavings).toBe(0)
    // The benchmark is exposed, but it's a separate field — callers
    // choose whether to render it as muted secondary type.
    expect(stats.potentialEstimate).toBeCloseTo(30_618_404 * 0.05, 0)
  })

  it("returns the real SUM(savingsAmount) when rows are matched", async () => {
    cogRows = [
      {
        id: "r-1",
        facilityId: "fac-1",
        vendorId: "v-1",
        vendorName: "Medtronic",
        extendedPrice: 10_000,
        savingsAmount: 250,
        matchStatus: "on_contract",
        transactionDate: new Date("2026-02-01"),
      },
      {
        id: "r-2",
        facilityId: "fac-1",
        vendorId: "v-1",
        vendorName: "Medtronic",
        extendedPrice: 5_000,
        savingsAmount: -120, // facility overpaid on a variance row
        matchStatus: "price_variance",
        transactionDate: new Date("2026-02-02"),
      },
      {
        id: "r-3",
        facilityId: "fac-1",
        vendorId: "v-2",
        vendorName: "Stryker",
        extendedPrice: 2_000,
        savingsAmount: null, // off-contract, no savings to sum
        matchStatus: "off_contract_item",
        transactionDate: new Date("2026-02-03"),
      },
    ]

    const stats = await getCOGStats("fac-1")

    expect(stats.matchedCount).toBe(2)
    // 250 + (-120) = 130 — sign convention preserved, no multiplier.
    expect(stats.totalSavings).toBe(130)
    expect(stats.totalSpend).toBe(17_000)
    // Benchmark still computed for display; it's not the headline.
    expect(stats.potentialEstimate).toBeCloseTo(17_000 * 0.05, 5)
  })

  it("never returns totalSpend × 0.05 as totalSavings", async () => {
    // Regression guard: the old bug silently conflated these two
    // numbers. Keep them structurally distinct.
    cogRows = [
      {
        id: "r-1",
        facilityId: "fac-1",
        vendorId: null,
        vendorName: null,
        extendedPrice: 1_000_000,
        savingsAmount: null,
        matchStatus: "pending",
        transactionDate: null,
      },
    ]

    const stats = await getCOGStats("fac-1")

    expect(stats.totalSavings).toBe(0)
    expect(stats.totalSavings).not.toBe(stats.potentialEstimate)
  })
})
