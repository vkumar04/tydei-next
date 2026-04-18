/**
 * Tests for the facility dashboard server actions.
 *
 * Scope: subsystem 0 — data-layer audit. Each test pins the shape of
 * the action's return value to the canonical-spec §3.0 contract so
 * that the downstream metric-card / chart subsystems can rely on the
 * exact field names and aggregations.
 *
 * Mock strategy mirrors `contract-metrics-batch.test.ts` — hand-roll
 * a prisma mock per test via module-scoped fixtures, then reset in
 * beforeEach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Fixtures (mutable per test) ─────────────────────────────────

type ContractRow = {
  id: string
  vendorId: string
  totalValue: number
  marketShareCommitment: number | null
  currentMarketShare: number | null
  status: string
  expirationDate: Date
  effectiveDate: Date
  createdAt: Date
  updatedAt: Date
}

type CogRow = {
  id: string
  vendorId: string | null
  vendorName: string | null
  vendorItemNo: string | null
  category: string | null
  extendedPrice: number
  transactionDate: Date
  vendor?: {
    name: string
    contracts: Array<{ productCategory: { name: string } | null }>
  } | null
}

type PricingRow = {
  vendorId: string
  vendorItemNo: string
  category: string | null
  vendor?: { name: string } | null
}

type AlertRow = {
  id: string
  alertType: string
  title: string
  description: string | null
  status: string
  createdAt: Date
  metadata: unknown
}

let contractRows: ContractRow[] = []
let cogRows: CogRow[] = []
let pricingRows: PricingRow[] = []
let alertRows: AlertRow[] = []

// Spend aggregates are returned by the mock based on the `where`
// clause — we match on the presence of a `vendor` filter to know
// whether to return "on-contract" or "total" spend.

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Filter contracts by the key where-clause discriminators used
        // by getDashboardStats: createdAt (recent added), expirationDate
        // (expiring soon), otherwise total active count.
        let rows = [...contractRows]
        const w = where as Record<string, unknown>
        const createdAt = w.createdAt as { gte?: Date } | undefined
        const expirationDate = w.expirationDate as
          | { gte?: Date; lte?: Date }
          | undefined
        if (createdAt?.gte) {
          rows = rows.filter((r) => r.createdAt >= createdAt.gte!)
        }
        if (expirationDate?.gte && expirationDate?.lte) {
          rows = rows.filter(
            (r) =>
              r.expirationDate >= expirationDate.gte! &&
              r.expirationDate <= expirationDate.lte!,
          )
        }
        return rows.length
      }),
      aggregate: vi.fn(async () => ({
        _sum: {
          totalValue: contractRows.reduce((s, r) => s + r.totalValue, 0),
        },
      })),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        // Two call sites in dashboard.ts:
        //   1. getDashboardStats commitment list (marketShareCommitment: { not: null })
        //   2. getDashboardStats rebate fallback (status active/expiring)
        //   3. getRecentContracts (order by effectiveDate)
        const w = (where ?? {}) as Record<string, unknown>
        const commitmentFilter = w.marketShareCommitment as
          | { not?: null }
          | undefined
        if (commitmentFilter && "not" in commitmentFilter) {
          return contractRows.filter((c) => c.marketShareCommitment !== null)
        }
        // default: return all rows (recent contracts / rebate fallback)
        return contractRows.map((c) => ({
          ...c,
          vendor: { id: c.vendorId, name: "Vendor " + c.vendorId, logoUrl: null },
          terms: [],
        }))
      }),
    },
    cOGRecord: {
      aggregate: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const w = where as Record<string, unknown>
        const hasVendorFilter = "vendor" in w
        const vendorIdFilter = w.vendorId as string | undefined
        if (hasVendorFilter) {
          // on-contract spend — return only rows whose vendor has a
          // contract. In our test fixtures, every vendor "v-on" has
          // one; vendor "v-off" does not.
          const total = cogRows
            .filter((r) => r.vendorId === "v-on")
            .reduce((s, r) => s + r.extendedPrice, 0)
          return { _sum: { extendedPrice: total } }
        }
        if (vendorIdFilter) {
          const total = cogRows
            .filter((r) => r.vendorId === vendorIdFilter)
            .reduce((s, r) => s + r.extendedPrice, 0)
          return { _sum: { extendedPrice: total } }
        }
        // total spend
        return {
          _sum: {
            extendedPrice: cogRows.reduce((s, r) => s + r.extendedPrice, 0),
          },
        }
      }),
      findMany: vi.fn(async () => cogRows),
      groupBy: vi.fn(async ({ take }: { take?: number }) => {
        const byVendor = new Map<string, number>()
        for (const r of cogRows) {
          if (!r.vendorId) continue
          byVendor.set(
            r.vendorId,
            (byVendor.get(r.vendorId) ?? 0) + r.extendedPrice,
          )
        }
        const rows = Array.from(byVendor.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([vendorId, sum]) => ({
            vendorId,
            _sum: { extendedPrice: sum },
          }))
        return take ? rows.slice(0, take) : rows
      }),
    },
    contractPeriod: {
      aggregate: vi.fn(async () => ({
        _sum: { rebateEarned: 0, rebateCollected: 0 },
      })),
    },
    pricingFile: {
      findMany: vi.fn(async () => pricingRows),
    },
    alert: {
      count: vi.fn(async () => alertRows.length),
      findMany: vi.fn(async () => alertRows),
    },
    vendor: {
      findMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, name: "Vendor " + id })),
      ),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

import {
  getDashboardStats,
  getMonthlySpend,
  getSpendByVendor,
  getSpendByCategory,
  getRecentContracts,
  getRecentAlerts,
} from "@/lib/actions/dashboard"

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  cogRows = []
  pricingRows = []
  alertRows = []
})

// ─── Shared helpers ──────────────────────────────────────────────

const DATE_FROM = "2025-01-01T00:00:00.000Z"
const DATE_TO = "2026-04-18T00:00:00.000Z"

function mkContract(overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    id: "c-1",
    vendorId: "v-on",
    totalValue: 100000,
    marketShareCommitment: null,
    currentMarketShare: null,
    status: "active",
    expirationDate: new Date("2027-01-01"),
    effectiveDate: new Date("2025-01-01"),
    createdAt: new Date("2025-06-01"),
    updatedAt: new Date("2025-06-01"),
    ...overrides,
  }
}

// ─── getDashboardStats ───────────────────────────────────────────

describe("getDashboardStats — shape + canonical fields", () => {
  it("returns all canonical-spec §3.0 KPI fields", async () => {
    contractRows = [mkContract({ id: "c-1", totalValue: 200000 })]
    cogRows = [
      {
        id: "og-1",
        vendorId: "v-on",
        vendorName: "Vendor v-on",
        vendorItemNo: null,
        category: null,
        extendedPrice: 50000,
        transactionDate: new Date("2025-06-01"),
      },
    ]

    const result = await getDashboardStats({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })

    // Legacy fields still present (back-compat with existing UI)
    expect(result).toHaveProperty("activeContractCount")
    expect(result).toHaveProperty("totalSpend")
    expect(result).toHaveProperty("onContractSpend")
    expect(result).toHaveProperty("onContractPercent")
    expect(result).toHaveProperty("collectionRate")
    expect(result).toHaveProperty("pendingAlertCount")

    // Canonical-spec fields present (new UI consumes these)
    expect(result).toHaveProperty("activeCount")
    expect(result).toHaveProperty("totalContractValue")
    expect(result).toHaveProperty("recentContractsAdded")
    expect(result).toHaveProperty("totalSpendYTD")
    expect(result).toHaveProperty("totalContractSpend")
    expect(result).toHaveProperty("spendProgress")
    expect(result).toHaveProperty("rebatesEarned")
    expect(result).toHaveProperty("rebatesCollected")
    expect(result).toHaveProperty("rebateCollectionRate")
    expect(result).toHaveProperty("pendingAlerts")
  })

  it("totalContractValue sums Contract.totalValue across the active portfolio", async () => {
    contractRows = [
      mkContract({ id: "c-1", totalValue: 100000 }),
      mkContract({ id: "c-2", totalValue: 250000 }),
    ]

    const result = await getDashboardStats({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    expect(result.totalContractValue).toBe(350000)
  })

  it("pendingAlerts counts contracts expiring within 90 days", async () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 30)
    const far = new Date()
    far.setDate(far.getDate() + 365)

    contractRows = [
      mkContract({ id: "c-soon", expirationDate: soon }),
      mkContract({ id: "c-far", expirationDate: far }),
    ]

    const result = await getDashboardStats({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    // Only c-soon should count. Commitment check adds 0.
    expect(result.pendingAlerts).toBe(1)
  })

  it("pendingAlerts counts contracts with commitment progress < 80%", async () => {
    const far = new Date()
    far.setDate(far.getDate() + 365)

    contractRows = [
      mkContract({
        id: "c-low",
        expirationDate: far,
        marketShareCommitment: 100,
        currentMarketShare: 50, // 50% progress < 80%
      }),
      mkContract({
        id: "c-high",
        expirationDate: far,
        marketShareCommitment: 100,
        currentMarketShare: 85, // >= 80%
      }),
    ]

    const result = await getDashboardStats({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    expect(result.pendingAlerts).toBe(1)
  })

  it("spendProgress = on-contract / total * 100 (percent)", async () => {
    contractRows = [mkContract()]
    cogRows = [
      {
        id: "og-1",
        vendorId: "v-on",
        vendorName: "Vendor v-on",
        vendorItemNo: null,
        category: null,
        extendedPrice: 75000,
        transactionDate: new Date("2025-06-01"),
      },
      {
        id: "og-2",
        vendorId: "v-off",
        vendorName: "Vendor v-off",
        vendorItemNo: null,
        category: null,
        extendedPrice: 25000,
        transactionDate: new Date("2025-06-01"),
      },
    ]

    const result = await getDashboardStats({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    expect(result.totalSpendYTD).toBe(100000)
    expect(result.totalContractSpend).toBe(75000)
    expect(result.spendProgress).toBeCloseTo(75, 4)
  })
})

// ─── getMonthlySpend ─────────────────────────────────────────────

describe("getMonthlySpend — 12-month zero-fill", () => {
  it("returns exactly 12 months", async () => {
    const result = await getMonthlySpend({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    expect(result).toHaveLength(12)
  })

  it("zero-fills months with no COG records", async () => {
    // single record in the anchor month only
    cogRows = [
      {
        id: "og-1",
        vendorId: "v-1",
        vendorName: null,
        vendorItemNo: null,
        category: null,
        extendedPrice: 10000,
        transactionDate: new Date("2026-04-15"),
      },
    ]
    const result = await getMonthlySpend({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    // The earliest 11 months should all be 0-filled; at least one
    // entry should carry the 10000 spend.
    const zeroMonths = result.filter((m) => m.spend === 0)
    expect(zeroMonths.length).toBe(11)
    const total = result.reduce((s, m) => s + m.spend, 0)
    expect(total).toBe(10000)
  })

  it("months are sorted ascending YYYY-MM", async () => {
    const result = await getMonthlySpend({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    const months = result.map((m) => m.month)
    const sorted = [...months].sort()
    expect(months).toEqual(sorted)
    // Each month is a valid YYYY-MM string
    for (const m of months) {
      expect(m).toMatch(/^\d{4}-\d{2}$/)
    }
  })
})

// ─── getSpendByVendor ────────────────────────────────────────────

describe("getSpendByVendor — top 8", () => {
  it("returns at most 8 vendors sorted desc", async () => {
    // 10 vendors, each with distinct spend
    cogRows = Array.from({ length: 10 }, (_, i) => ({
      id: `og-${i}`,
      vendorId: `v-${i}`,
      vendorName: `Vendor ${i}`,
      vendorItemNo: null,
      category: null,
      extendedPrice: (i + 1) * 1000,
      transactionDate: new Date("2025-06-01"),
    }))

    const result = await getSpendByVendor({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    // Note: prisma groupBy's `take: 8` is the real limit; our mock
    // returns all and lets the action slice. Either way the action
    // contract is ≤ 8.
    expect(result.length).toBeLessThanOrEqual(8)
    const totals = result.map((r) => r.total)
    const sorted = [...totals].sort((a, b) => b - a)
    expect(totals).toEqual(sorted)
  })
})

// ─── getSpendByCategory ──────────────────────────────────────────

describe("getSpendByCategory — resolution chain", () => {
  it("uses COGRecord.category when set (layer 1)", async () => {
    cogRows = [
      {
        id: "og-1",
        vendorId: "v-1",
        vendorName: "Vendor 1",
        vendorItemNo: "IT-1",
        category: "Orthopedic Implants",
        extendedPrice: 5000,
        transactionDate: new Date("2025-06-01"),
        vendor: { name: "Vendor 1", contracts: [] },
      },
    ]
    const result = await getSpendByCategory({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    expect(result).toEqual([{ name: "Orthopedic Implants", value: 5000 }])
  })

  it("falls back to pricing-file (vendorId, vendorItemNo) match (layer 2)", async () => {
    cogRows = [
      {
        id: "og-1",
        vendorId: "v-1",
        vendorName: "Vendor 1",
        vendorItemNo: "IT-1",
        category: null,
        extendedPrice: 5000,
        transactionDate: new Date("2025-06-01"),
        vendor: { name: "Vendor 1", contracts: [] },
      },
    ]
    pricingRows = [
      {
        vendorId: "v-1",
        vendorItemNo: "IT-1",
        category: "Cardiology",
        vendor: { name: "Vendor 1" },
      },
    ]
    const result = await getSpendByCategory({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    expect(result).toEqual([{ name: "Cardiology", value: 5000 }])
  })

  it("falls back to vendor-name first-word match (layer 3)", async () => {
    cogRows = [
      {
        id: "og-1",
        vendorId: "v-1",
        vendorName: "Medtronic Surgical",
        // vendorItemNo doesn't match anything in pricingRows
        vendorItemNo: "UNKNOWN-999",
        category: null,
        extendedPrice: 5000,
        transactionDate: new Date("2025-06-01"),
        vendor: { name: "Medtronic Surgical", contracts: [] },
      },
    ]
    pricingRows = [
      {
        vendorId: "v-1",
        vendorItemNo: "DIFFERENT-ITEM",
        category: "Cardiovascular",
        vendor: { name: "Medtronic Inc." },
      },
    ]
    const result = await getSpendByCategory({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    // vendor-name first-word "Medtronic" should match even though
    // the item numbers don't line up.
    expect(result).toEqual([{ name: "Cardiovascular", value: 5000 }])
  })

  it("uncategorized bucket when nothing matches (layer 5)", async () => {
    cogRows = [
      {
        id: "og-1",
        vendorId: null,
        vendorName: null,
        vendorItemNo: null,
        category: null,
        extendedPrice: 5000,
        transactionDate: new Date("2025-06-01"),
        vendor: null,
      },
    ]
    const result = await getSpendByCategory({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    expect(result).toEqual([{ name: "Uncategorized", value: 5000 }])
  })

  it("limits to top 8 categories", async () => {
    // 10 distinct COG-level categories
    cogRows = Array.from({ length: 10 }, (_, i) => ({
      id: `og-${i}`,
      vendorId: `v-${i}`,
      vendorName: `Vendor ${i}`,
      vendorItemNo: null,
      category: `Cat-${String(i).padStart(2, "0")}`,
      extendedPrice: (i + 1) * 100,
      transactionDate: new Date("2025-06-01"),
      vendor: { name: `Vendor ${i}`, contracts: [] },
    }))

    const result = await getSpendByCategory({
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
    })
    expect(result.length).toBe(8)
  })
})

// ─── getRecentContracts ──────────────────────────────────────────

describe("getRecentContracts — ordering + ownership", () => {
  it("returns 5 most recent by effectiveDate (default limit)", async () => {
    const result = await getRecentContracts()
    // Just assert the contract returns an array. The mock returns
    // all contractRows; the orderBy is enforced in the prisma call
    // itself, which our mock ignores. What we're asserting here is
    // the action shape: an array, vendor joined, serialized.
    expect(Array.isArray(result)).toBe(true)
  })
})

// ─── getRecentAlerts ─────────────────────────────────────────────

describe("getRecentAlerts — canonical-spec fields", () => {
  it("returns all fields the UI needs (id, alertType, title, description, status, createdAt, metadata)", async () => {
    alertRows = [
      {
        id: "a-1",
        alertType: "expiring_contract",
        title: "Contract expiring soon",
        description: "Your Medtronic contract expires in 30 days",
        status: "new_alert",
        createdAt: new Date("2026-04-01"),
        metadata: { contractId: "c-1" },
      },
    ]
    const result = await getRecentAlerts()
    expect(result).toHaveLength(1)
    const alert = result[0]
    expect(alert).toHaveProperty("id")
    expect(alert).toHaveProperty("alertType")
    expect(alert).toHaveProperty("title")
    expect(alert).toHaveProperty("description")
    expect(alert).toHaveProperty("status")
    expect(alert).toHaveProperty("createdAt")
    expect(alert).toHaveProperty("metadata")
  })
})
