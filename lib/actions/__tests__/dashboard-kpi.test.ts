/**
 * Tests for `getDashboardKPISummary` — the composite server action that
 * wires `computeDashboardKPIs`, `projectAnnualSpend`, `summarizeAlerts`,
 * and `rankAlerts` onto Prisma-backed facility data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Fixtures ────────────────────────────────────────────────────

type ContractRow = {
  status: string
  totalValue: number
  expirationDate: Date | null
  marketShareCommitment: number | null
  currentMarketShare: number | null
}

type CogRow = {
  transactionDate: Date
  extendedPrice: number
}

type AlertRow = {
  id: string
  status: "new_alert" | "read" | "resolved" | "dismissed"
  severity: "low" | "medium" | "high"
  alertType: string
  metadata: Record<string, unknown>
  createdAt: Date
}

let contractRows: ContractRow[] = []
let cogRows: CogRow[] = []
let alertRows: AlertRow[] = []
let rebateAgg = { earned: 0, collected: 0 }

// ─── Prisma mock ─────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(async () => contractRows),
    },
    cOGRecord: {
      aggregate: vi.fn(
        async ({
          where,
        }: {
          where: { transactionDate?: { gte?: Date; lte?: Date } }
        }) => {
          // Sum extendedPrice across cogRows whose date falls within the
          // given window. Both gte and lte are treated inclusively.
          const gte = where.transactionDate?.gte
          const lte = where.transactionDate?.lte
          const total = cogRows
            .filter((r) => (gte ? r.transactionDate >= gte : true))
            .filter((r) => (lte ? r.transactionDate <= lte : true))
            .reduce((s, r) => s + r.extendedPrice, 0)
          return { _sum: { extendedPrice: total } }
        },
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { transactionDate?: { gte?: Date; lte?: Date } }
        }) => {
          const gte = where.transactionDate?.gte
          const lte = where.transactionDate?.lte
          return cogRows
            .filter((r) => (gte ? r.transactionDate >= gte : true))
            .filter((r) => (lte ? r.transactionDate <= lte : true))
        },
      ),
    },
    rebate: {
      aggregate: vi.fn(
        async ({
          _sum,
        }: {
          _sum?: { rebateEarned?: boolean; rebateCollected?: boolean }
        } = {}) => {
          // Two calls: one for earned (payPeriodEnd <= today), one for
          // collected (collectionDate not null). Route by which _sum
          // field the caller asked for.
          if (_sum?.rebateEarned) {
            return { _sum: { rebateEarned: rebateAgg.earned } }
          }
          if (_sum?.rebateCollected) {
            return { _sum: { rebateCollected: rebateAgg.collected } }
          }
          return {
            _sum: {
              rebateEarned: rebateAgg.earned,
              rebateCollected: rebateAgg.collected,
            },
          }
        },
      ),
    },
    alert: {
      findMany: vi.fn(async () => alertRows),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })),
}))

// ─── Imports under test ──────────────────────────────────────────

import { getDashboardKPISummary } from "@/lib/actions/dashboard/kpi"

// ─── Helpers ─────────────────────────────────────────────────────

function mkContract(overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    status: "active",
    totalValue: 100_000,
    expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    marketShareCommitment: null,
    currentMarketShare: null,
    ...overrides,
  }
}

function mkAlert(overrides: Partial<AlertRow> = {}): AlertRow {
  return {
    id: "a-1",
    status: "new_alert",
    severity: "medium",
    alertType: "off_contract",
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  cogRows = []
  alertRows = []
  rebateAgg = { earned: 0, collected: 0 }
})

// ─── getDashboardKPISummary ─────────────────────────────────────

describe("getDashboardKPISummary", () => {
  it("returns the full composite payload shape", async () => {
    const result = await getDashboardKPISummary()

    // KPI block fields
    expect(result).toHaveProperty("totalContractValue")
    expect(result).toHaveProperty("totalSpendYTD")
    expect(result).toHaveProperty("spendProgress")
    expect(result).toHaveProperty("totalRebatesEarned")
    expect(result).toHaveProperty("totalRebatesCollected")
    expect(result).toHaveProperty("rebateCollectionRate")
    expect(result).toHaveProperty("activeContractsCount")
    expect(result).toHaveProperty("expiringContractsCount")
    expect(result).toHaveProperty("pendingAlerts")

    // Composite additions
    expect(result).toHaveProperty("spendProjection")
    expect(result.spendProjection).toHaveProperty("projectedAnnualSpend")
    expect(result.spendProjection).toHaveProperty("trailing3MonthAvg")
    expect(result.spendProjection).toHaveProperty("trend")
    expect(result).toHaveProperty("alertSummary")
    expect(result.alertSummary).toHaveProperty("totalUnresolved")
    expect(result).toHaveProperty("topAlerts")
    expect(Array.isArray(result.topAlerts)).toBe(true)
  })

  it("sums totalContractValue across the full portfolio — Charles R5.37", async () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    contractRows = [
      mkContract({
        status: "active",
        totalValue: 100_000,
        expirationDate: farFuture,
      }),
      mkContract({
        status: "active",
        totalValue: 250_000,
        expirationDate: farFuture,
      }),
      // draft contracts DO count toward portfolio Total Value.
      mkContract({
        status: "draft",
        totalValue: 500_000,
        expirationDate: null,
      }),
      mkContract({
        status: "pending",
        totalValue: 75_000,
        expirationDate: null,
      }),
    ]
    const result = await getDashboardKPISummary()
    // 100k + 250k + 500k + 75k = 925k (all portfolio statuses)
    expect(result.totalContractValue).toBe(925_000)
    expect(result.activeContractsCount).toBe(2)
  })

  it("aggregates rebates earned from the Rebate table (payPeriodEnd ≤ today), not ContractPeriod — Charles R5.37", async () => {
    // The dashboard contract row doesn't drive rebates, but we seed one
    // so the action's contract query returns something benign.
    contractRows = [mkContract({ status: "draft", totalValue: 0 })]
    rebateAgg = { earned: 71_603.49, collected: 51_198 }
    const result = await getDashboardKPISummary()
    expect(result.totalRebatesEarned).toBe(71_603.49)
    expect(result.totalRebatesCollected).toBe(51_198)
    expect(result.rebateCollectionRate).toBeCloseTo(51_198 / 71_603.49, 4)
  })

  it("counts contracts expiring within 90 days as pendingAlerts", async () => {
    const soon = new Date()
    soon.setDate(soon.getDate() + 30)
    const far = new Date()
    far.setDate(far.getDate() + 365)
    contractRows = [
      mkContract({ status: "active", expirationDate: soon }),
      mkContract({ status: "active", expirationDate: far }),
    ]
    const result = await getDashboardKPISummary()
    expect(result.pendingAlerts).toBe(1)
  })

  it("counts active contracts with commitment progress < 80% as pendingAlerts", async () => {
    const far = new Date()
    far.setDate(far.getDate() + 365)
    contractRows = [
      mkContract({
        status: "active",
        expirationDate: far,
        marketShareCommitment: 100,
        currentMarketShare: 50,
      }),
      mkContract({
        status: "active",
        expirationDate: far,
        marketShareCommitment: 100,
        currentMarketShare: 90,
      }),
    ]
    const result = await getDashboardKPISummary()
    expect(result.pendingAlerts).toBe(1)
  })

  it("aggregates rebate totals from the Rebate table", async () => {
    rebateAgg = { earned: 50_000, collected: 35_000 }
    const result = await getDashboardKPISummary()
    expect(result.totalRebatesEarned).toBe(50_000)
    expect(result.totalRebatesCollected).toBe(35_000)
    expect(result.rebateCollectionRate).toBeCloseTo(0.7, 4)
  })

  it("summarizes alerts (unresolved-only, split by severity + by type)", async () => {
    alertRows = [
      mkAlert({
        id: "a-1",
        status: "new_alert",
        severity: "high",
        alertType: "off_contract",
      }),
      mkAlert({
        id: "a-2",
        status: "read",
        severity: "medium",
        alertType: "expiring_contract",
      }),
      mkAlert({
        id: "a-3",
        status: "resolved", // excluded
        severity: "high",
        alertType: "off_contract",
      }),
      mkAlert({
        id: "a-4",
        status: "dismissed", // excluded
        severity: "low",
        alertType: "rebate_due",
      }),
    ]
    const result = await getDashboardKPISummary()
    expect(result.alertSummary.totalUnresolved).toBe(2)
    expect(result.alertSummary.highPriority).toBe(1)
    expect(result.alertSummary.mediumPriority).toBe(1)
    expect(result.alertSummary.lowPriority).toBe(0)
    expect(result.alertSummary.byType).toEqual({
      off_contract: 1,
      expiring_contract: 1,
    })
  })

  it("ranks top 5 alerts by priority — excludes resolved/dismissed", async () => {
    const now = new Date()
    alertRows = [
      mkAlert({
        id: "a-high",
        severity: "high",
        alertType: "off_contract",
        metadata: { total_amount: 200_000 },
        createdAt: now,
      }),
      mkAlert({
        id: "a-med",
        severity: "medium",
        alertType: "rebate_due",
        metadata: { amount: 5_000 },
        createdAt: now,
      }),
      mkAlert({
        id: "a-low",
        severity: "low",
        alertType: "tier_threshold",
        metadata: { amount_needed: 100 },
        createdAt: now,
      }),
      mkAlert({
        id: "a-resolved",
        severity: "high",
        alertType: "off_contract",
        status: "resolved",
      }),
    ]
    const result = await getDashboardKPISummary()
    expect(result.topAlerts.map((a) => a.id)).toEqual([
      "a-high",
      "a-med",
      "a-low",
    ])
    // a-high comes first with the biggest dollar-impact tier.
    expect(result.topAlerts[0].dollarImpact).toBe(200_000)
  })

  it("limits topAlerts to 5 entries", async () => {
    alertRows = Array.from({ length: 10 }, (_, i) =>
      mkAlert({
        id: `a-${i}`,
        severity: "high",
        alertType: "off_contract",
      }),
    )
    const result = await getDashboardKPISummary()
    expect(result.topAlerts).toHaveLength(5)
  })

  it("computes a spend projection from historical cog records", async () => {
    const now = new Date()
    const mkMonth = (offset: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 15))
    cogRows = [
      // Prior 3-month avg = 1000, last 3-month avg = 2000 → UP trend
      { transactionDate: mkMonth(6), extendedPrice: 1000 },
      { transactionDate: mkMonth(5), extendedPrice: 1000 },
      { transactionDate: mkMonth(4), extendedPrice: 1000 },
      { transactionDate: mkMonth(3), extendedPrice: 2000 },
      { transactionDate: mkMonth(2), extendedPrice: 2000 },
      { transactionDate: mkMonth(1), extendedPrice: 2000 },
    ]
    const result = await getDashboardKPISummary()
    expect(result.spendProjection.trailing3MonthAvg).toBe(2000)
    expect(result.spendProjection.trend).toBe("UP")
  })
})
