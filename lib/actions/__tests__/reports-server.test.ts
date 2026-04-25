/**
 * Tests for the reports-hub server actions:
 *   - getReportsOverview
 *   - getRebateCalculationAudit
 *   - ReportSchedule CRUD
 *
 * Strategy mirrors `dashboard.test.ts` — hand-rolled prisma mock via
 * module-scoped fixtures, reset in beforeEach. Only the call surface
 * each action actually uses is mocked; anything else stays undefined
 * to catch drift.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.0
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Fixtures (mutable per test) ─────────────────────────────────

type ContractRow = {
  id: string
  vendorId: string
  facilityId: string | null
  name: string
  contractType: string
  status: string
  effectiveDate: Date
  expirationDate: Date
  totalValue: number
}

type CogRow = {
  transactionDate: Date
  extendedPrice: number
}

type RebateRow = {
  payPeriodEnd: Date
  rebateEarned: number
}

type TierRow = {
  tierNumber: number
  tierName: string | null
  spendMin: number
  spendMax: number | null
  // Charles 2026-04-25: in production, ContractTier.rebateValue is
  // stored as a fraction (0.02 = 2%). Test fixtures used to use
  // integer percent (2 = 2%) which silently mis-modeled reality. The
  // audit-trail action now scales fraction → percent at the boundary
  // via toDisplayRebateValue, so fixtures must use fractions.
  rebateValue: number
  rebateType?: string
}

type PricingRow = {
  vendorItemNo: string
  effectiveDate: Date | null
  expirationDate: Date | null
}

type POLineRow = {
  id: string
  vendorItemNo: string | null
  extendedPrice: number
  purchaseOrder: {
    poNumber: string
    orderDate: Date
    facilityId: string
    vendorId: string
  }
}

type ScheduleRow = {
  id: string
  facilityId: string
  reportType: string
  frequency: string
  dayOfWeek: number | null
  dayOfMonth: number | null
  emailRecipients: string[]
  isActive: boolean
  lastSentAt: Date | null
  createdAt: Date
  updatedAt: Date
}

let contractRows: ContractRow[] = []
let cogRows: CogRow[] = []
let rebateRows: RebateRow[] = []
let tierRows: TierRow[] = []
let pricingRows: PricingRow[] = []
let poLineRows: POLineRow[] = []
let scheduleRows: ScheduleRow[] = []

let contractById: ContractRow | null = null
let contractVendorName = "Vendor Co"

// ─── Prisma mock ────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(async () => {
        return contractRows.map((c) => ({
          status: c.status,
          expirationDate: c.expirationDate,
          totalValue: c.totalValue,
        }))
      }),
      findFirstOrThrow: vi.fn(async () => {
        if (!contractById) throw new Error("Contract not found")
        return {
          ...contractById,
          vendor: { id: contractById.vendorId, name: contractVendorName },
          terms: tierRows.length
            ? [
                {
                  id: "term-1",
                  effectiveStart: new Date("2026-01-01"),
                  tiers: tierRows,
                },
              ]
            : [],
          pricingItems: pricingRows,
        }
      }),
    },
    cOGRecord: {
      findMany: vi.fn(async () => cogRows),
    },
    rebate: {
      findMany: vi.fn(async () => rebateRows),
    },
    pOLineItem: {
      findMany: vi.fn(async () => poLineRows),
    },
    reportSchedule: {
      findMany: vi.fn(async () =>
        scheduleRows.filter((s) => s.facilityId === "fac-test"),
      ),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; facilityId: string }
        }) => {
          const row = scheduleRows.find(
            (s) => s.id === where.id && s.facilityId === where.facilityId,
          )
          return row ?? null
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<ScheduleRow, "id" | "createdAt" | "updatedAt" | "dayOfWeek" | "lastSentAt"> & {
            dayOfWeek?: number | null
            dayOfMonth?: number | null
          }
        }) => {
          const row: ScheduleRow = {
            id: `sched-${scheduleRows.length + 1}`,
            facilityId: data.facilityId,
            reportType: data.reportType,
            frequency: data.frequency,
            dayOfWeek: data.dayOfWeek ?? null,
            dayOfMonth: data.dayOfMonth ?? null,
            emailRecipients: data.emailRecipients,
            isActive: data.isActive ?? true,
            lastSentAt: null,
            createdAt: new Date("2026-04-18T00:00:00Z"),
            updatedAt: new Date("2026-04-18T00:00:00Z"),
          }
          scheduleRows.push(row)
          return row
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Partial<ScheduleRow>
        }) => {
          const row = scheduleRows.find((s) => s.id === where.id)
          if (!row) throw new Error("not found")
          Object.assign(row, data, { updatedAt: new Date() })
          return row
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        scheduleRows = scheduleRows.filter((s) => s.id !== where.id)
      }),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

import { getReportsOverview } from "@/lib/actions/reports/overview"
import { getRebateCalculationAudit } from "@/lib/actions/reports/audit-trail"
import {
  listReportSchedules,
  createReportSchedule,
  updateReportSchedule,
  deleteReportSchedule,
} from "@/lib/actions/reports/schedule"

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  cogRows = []
  rebateRows = []
  tierRows = []
  pricingRows = []
  poLineRows = []
  scheduleRows = []
  contractById = null
  contractVendorName = "Vendor Co"
})

// ─── getReportsOverview ──────────────────────────────────────────

describe("getReportsOverview", () => {
  it("returns canonical payload shape (lifecycle + monthlyTrend + stats)", async () => {
    const result = await getReportsOverview()
    expect(result).toHaveProperty("lifecycle")
    expect(result).toHaveProperty("monthlyTrend")
    expect(result).toHaveProperty("stats")
    expect(result.stats).toMatchObject({
      totalContracts: 0,
      totalValue: 0,
      totalRebates: 0,
    })
  })

  it("empty contract list yields zero lifecycle buckets", async () => {
    const result = await getReportsOverview()
    expect(result.lifecycle).toEqual({
      active: 0,
      expiring: 0,
      expired: 0,
      other: 0,
    })
  })

  it("buckets lifecycle from contract statuses + expirationDate", async () => {
    const now = new Date("2026-04-18T00:00:00Z")
    contractRows = [
      {
        id: "c-active",
        vendorId: "v-1",
        facilityId: "fac-test",
        name: "Active",
        contractType: "usage",
        status: "active",
        effectiveDate: new Date("2025-01-01"),
        expirationDate: new Date("2028-01-01"),
        totalValue: 100_000,
      },
      {
        id: "c-expired",
        vendorId: "v-1",
        facilityId: "fac-test",
        name: "Expired",
        contractType: "usage",
        status: "expired",
        effectiveDate: new Date("2023-01-01"),
        expirationDate: new Date("2024-01-01"),
        totalValue: 50_000,
      },
    ]
    const result = await getReportsOverview({ dateTo: now })
    expect(result.lifecycle.active).toBe(1)
    expect(result.lifecycle.expired).toBe(1)
  })

  it("sums totalValue + totalRebates across the window", async () => {
    contractRows = [
      {
        id: "c-1",
        vendorId: "v-1",
        facilityId: "fac-test",
        name: "C1",
        contractType: "usage",
        status: "active",
        effectiveDate: new Date("2025-01-01"),
        expirationDate: new Date("2028-01-01"),
        totalValue: 100_000,
      },
      {
        id: "c-2",
        vendorId: "v-1",
        facilityId: "fac-test",
        name: "C2",
        contractType: "usage",
        status: "active",
        effectiveDate: new Date("2025-01-01"),
        expirationDate: new Date("2028-01-01"),
        totalValue: 250_000,
      },
    ]
    rebateRows = [
      { payPeriodEnd: new Date("2026-01-31"), rebateEarned: 1000 },
      { payPeriodEnd: new Date("2026-02-28"), rebateEarned: 2500 },
    ]
    const result = await getReportsOverview({
      dateFrom: new Date("2025-01-01"),
      dateTo: new Date("2026-12-31"),
    })
    expect(result.stats.totalContracts).toBe(2)
    expect(result.stats.totalValue).toBe(350_000)
    expect(result.stats.totalRebates).toBe(3500)
  })

  it("monthlyTrend returns 12 months with zero fill when no spend/rebates", async () => {
    const result = await getReportsOverview({
      dateTo: new Date("2026-04-18T00:00:00Z"),
    })
    expect(result.monthlyTrend).toHaveLength(12)
    for (const point of result.monthlyTrend) {
      expect(point.spend).toBe(0)
      expect(point.rebate).toBe(0)
    }
  })

  it("monthlyTrend aggregates spend by month", async () => {
    const ref = new Date("2026-04-18T00:00:00Z")
    cogRows = [
      { transactionDate: new Date("2026-04-10"), extendedPrice: 5000 },
      { transactionDate: new Date("2026-04-15"), extendedPrice: 2500 },
      { transactionDate: new Date("2026-03-01"), extendedPrice: 1000 },
    ]
    const result = await getReportsOverview({ dateTo: ref })
    const april = result.monthlyTrend.find((p) => p.month === "2026-04")
    const march = result.monthlyTrend.find((p) => p.month === "2026-03")
    expect(april?.spend).toBe(7500)
    expect(march?.spend).toBe(1000)
  })
})

// ─── getRebateCalculationAudit ───────────────────────────────────

describe("getRebateCalculationAudit", () => {
  const baseContract: ContractRow = {
    id: "c-1",
    vendorId: "v-1",
    facilityId: "fac-test",
    name: "Arthrex Usage",
    contractType: "usage",
    status: "active",
    effectiveDate: new Date("2026-01-01"),
    expirationDate: new Date("2028-12-31"),
    totalValue: 1_000_000,
  }

  it("assembles the audit payload with contract + tier info", async () => {
    contractById = baseContract
    tierRows = [
      {
        tierNumber: 1,
        tierName: "Tier 1",
        spendMin: 0,
        spendMax: 500_000,
        rebateValue: 0.02,
        rebateType: "percent_of_spend",
      },
      {
        tierNumber: 2,
        tierName: "Tier 2",
        spendMin: 500_000,
        spendMax: null,
        rebateValue: 0.04,
        rebateType: "percent_of_spend",
      },
    ]
    const result = await getRebateCalculationAudit("c-1")
    expect(result.contract.id).toBe("c-1")
    expect(result.contract.vendor).toBe("Vendor Co")
    expect(result.tiers).toHaveLength(2)
    expect(result.currentTier).toBe("Tier 1")
  })

  it("partitions PO lines into inclusions vs excluded (off_contract + out_of_scope)", async () => {
    contractById = baseContract
    tierRows = [
      {
        tierNumber: 1,
        tierName: "Tier 1",
        spendMin: 0,
        spendMax: null,
        rebateValue: 0.05,
        rebateType: "percent_of_spend",
      },
    ]
    pricingRows = [
      {
        vendorItemNo: "SKU-ON",
        effectiveDate: new Date("2026-01-01"),
        expirationDate: new Date("2028-12-31"),
      },
    ]
    poLineRows = [
      {
        id: "pl-1",
        vendorItemNo: "SKU-ON",
        extendedPrice: 100_000,
        purchaseOrder: {
          poNumber: "PO-1",
          orderDate: new Date("2026-06-01"),
          facilityId: "fac-test",
          vendorId: "v-1",
        },
      },
      {
        id: "pl-2",
        vendorItemNo: "SKU-OFF",
        extendedPrice: 50_000,
        purchaseOrder: {
          poNumber: "PO-2",
          orderDate: new Date("2026-06-01"),
          facilityId: "fac-test",
          vendorId: "v-1",
        },
      },
      {
        id: "pl-3",
        vendorItemNo: "SKU-ON",
        extendedPrice: 25_000,
        purchaseOrder: {
          poNumber: "PO-3",
          // Out of contract window (contract ends 2028-12-31).
          orderDate: new Date("2030-01-01"),
          facilityId: "fac-test",
          vendorId: "v-1",
        },
      },
    ]
    const result = await getRebateCalculationAudit("c-1")
    expect(result.inclusions).toHaveLength(1)
    expect(result.inclusions[0].poNumber).toBe("PO-1")
    expect(result.excludedPOs).toHaveLength(2)
    expect(result.calc.totalEligibleSpend).toBe(100_000)
    expect(result.calc.grossRebate).toBe(5000) // 100_000 × 5%
  })

  it("returns empty tiers + zero rebate when contract has no terms", async () => {
    contractById = baseContract
    tierRows = []
    const result = await getRebateCalculationAudit("c-1")
    expect(result.tiers).toEqual([])
    expect(result.calc.totalEligibleSpend).toBe(0)
    expect(result.calc.grossRebate).toBe(0)
    expect(result.calc.netRebate).toBe(0)
  })

  it("picks current tier based on cumulative eligible spend", async () => {
    contractById = baseContract
    tierRows = [
      {
        tierNumber: 1,
        tierName: "Tier 1",
        spendMin: 0,
        spendMax: 500_000,
        rebateValue: 0.02,
        rebateType: "percent_of_spend",
      },
      {
        tierNumber: 2,
        tierName: "Tier 2",
        spendMin: 500_000,
        spendMax: null,
        rebateValue: 0.04,
        rebateType: "percent_of_spend",
      },
    ]
    pricingRows = [
      {
        vendorItemNo: "SKU-ON",
        effectiveDate: null,
        expirationDate: null,
      },
    ]
    poLineRows = [
      {
        id: "pl-1",
        vendorItemNo: "SKU-ON",
        extendedPrice: 600_000,
        purchaseOrder: {
          poNumber: "PO-1",
          orderDate: new Date("2026-06-01"),
          facilityId: "fac-test",
          vendorId: "v-1",
        },
      },
    ]
    const result = await getRebateCalculationAudit("c-1")
    expect(result.currentTier).toBe("Tier 2")
    expect(result.calc.currentTierRate).toBe(4)
  })
})

// ─── ReportSchedule CRUD ─────────────────────────────────────────

describe("ReportSchedule CRUD", () => {
  it("listReportSchedules returns only rows for the active facility", async () => {
    scheduleRows = [
      {
        id: "s-1",
        facilityId: "fac-test",
        reportType: "contract_performance",
        frequency: "monthly",
        dayOfWeek: null,
        dayOfMonth: 1,
        emailRecipients: ["a@x.com"],
        isActive: true,
        lastSentAt: null,
        createdAt: new Date("2026-04-01"),
        updatedAt: new Date("2026-04-01"),
      },
      {
        id: "s-2",
        facilityId: "fac-other",
        reportType: "spend_analysis",
        frequency: "weekly",
        dayOfWeek: 1,
        dayOfMonth: null,
        emailRecipients: ["b@x.com"],
        isActive: true,
        lastSentAt: null,
        createdAt: new Date("2026-04-02"),
        updatedAt: new Date("2026-04-02"),
      },
    ]
    const result = await listReportSchedules()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("s-1")
    expect(result[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("createReportSchedule maps spec reportType → DB enum (usage → contract_performance)", async () => {
    const created = await createReportSchedule({
      name: "Monthly Usage",
      reportType: "usage",
      frequency: "monthly",
      recipients: ["ops@x.com"],
    })
    expect(created.reportType).toBe("contract_performance")
    expect(created.frequency).toBe("monthly")
    expect(created.emailRecipients).toEqual(["ops@x.com"])
    expect(created.facilityId).toBe("fac-test")
  })

  it("createReportSchedule maps discrepancy → spend_analysis", async () => {
    const created = await createReportSchedule({
      name: "Price Discrepancy",
      reportType: "discrepancy",
      frequency: "weekly",
      recipients: ["ops@x.com"],
    })
    expect(created.reportType).toBe("spend_analysis")
    expect(created.frequency).toBe("weekly")
  })

  it("createReportSchedule maps quarterly → monthly with dayOfMonth=1", async () => {
    const created = await createReportSchedule({
      name: "Quarterly Usage",
      reportType: "usage",
      frequency: "quarterly",
      recipients: ["ops@x.com"],
    })
    expect(created.frequency).toBe("monthly")
    expect(created.dayOfMonth).toBe(1)
  })

  it("createReportSchedule rejects empty recipients", async () => {
    await expect(
      createReportSchedule({
        name: "Bad",
        reportType: "usage",
        frequency: "monthly",
        recipients: [],
      }),
    ).rejects.toThrow()
  })

  it("createReportSchedule rejects invalid email format", async () => {
    await expect(
      createReportSchedule({
        name: "Bad",
        reportType: "usage",
        frequency: "monthly",
        recipients: ["not-an-email"],
      }),
    ).rejects.toThrow()
  })

  it("updateReportSchedule refuses rows outside the facility", async () => {
    scheduleRows = [
      {
        id: "s-other",
        facilityId: "fac-other",
        reportType: "contract_performance",
        frequency: "monthly",
        dayOfWeek: null,
        dayOfMonth: 1,
        emailRecipients: ["a@x.com"],
        isActive: true,
        lastSentAt: null,
        createdAt: new Date("2026-04-01"),
        updatedAt: new Date("2026-04-01"),
      },
    ]
    await expect(
      updateReportSchedule("s-other", { frequency: "weekly" }),
    ).rejects.toThrow(/not found/)
  })

  it("updateReportSchedule applies frequency mapping", async () => {
    scheduleRows = [
      {
        id: "s-1",
        facilityId: "fac-test",
        reportType: "contract_performance",
        frequency: "monthly",
        dayOfWeek: null,
        dayOfMonth: null,
        emailRecipients: ["a@x.com"],
        isActive: true,
        lastSentAt: null,
        createdAt: new Date("2026-04-01"),
        updatedAt: new Date("2026-04-01"),
      },
    ]
    const updated = await updateReportSchedule("s-1", {
      frequency: "quarterly",
      recipients: ["b@x.com"],
    })
    expect(updated.frequency).toBe("monthly")
    expect(updated.dayOfMonth).toBe(1)
    expect(updated.emailRecipients).toEqual(["b@x.com"])
  })

  it("deleteReportSchedule removes the row when owned", async () => {
    scheduleRows = [
      {
        id: "s-1",
        facilityId: "fac-test",
        reportType: "contract_performance",
        frequency: "monthly",
        dayOfWeek: null,
        dayOfMonth: null,
        emailRecipients: ["a@x.com"],
        isActive: true,
        lastSentAt: null,
        createdAt: new Date("2026-04-01"),
        updatedAt: new Date("2026-04-01"),
      },
    ]
    await deleteReportSchedule("s-1")
    expect(scheduleRows).toHaveLength(0)
  })

  it("deleteReportSchedule refuses rows outside the facility", async () => {
    scheduleRows = [
      {
        id: "s-other",
        facilityId: "fac-other",
        reportType: "contract_performance",
        frequency: "monthly",
        dayOfWeek: null,
        dayOfMonth: null,
        emailRecipients: ["a@x.com"],
        isActive: true,
        lastSentAt: null,
        createdAt: new Date("2026-04-01"),
        updatedAt: new Date("2026-04-01"),
      },
    ]
    await expect(deleteReportSchedule("s-other")).rejects.toThrow(
      /not found/,
    )
    expect(scheduleRows).toHaveLength(1)
  })
})
