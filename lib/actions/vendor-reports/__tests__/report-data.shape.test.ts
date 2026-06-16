/**
 * Shape test for the vendor-scoped report-data mirror.
 *
 * `getVendorReportData` is the vendor-side mirror of `getReportData`
 * (`lib/actions/reports.ts`). The shared presentational components depend
 * on a BYTE-IDENTICAL payload shape, so this test asserts:
 *   1. the export exists and is an async function,
 *   2. the top-level payload keys match the facility original
 *      (facilityName + contracts + reportType + dateFrom + dateTo),
 *   3. `facilityName` is the vendor-report sentinel "All Facilities",
 *   4. each per-contract row carries the exact key set the facility
 *      original returns (including canonical rebate totals), and
 *   5. contracts are scoped via `contractsOwnedByVendor(vendor.id)` —
 *      i.e. the Prisma `where` carries the grouped-membership OR so a
 *      vendor that only appears in `additionalVendorIds` is covered.
 *
 * Strategy mirrors `lib/actions/__tests__/reports-server.test.ts`:
 * hand-rolled prisma + auth mocks via module-scoped fixtures.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Fixtures (mutable per test) ─────────────────────────────────

let findManyWhere: unknown = null

const contractFixture = {
  id: "c-1",
  name: "Arthrex Usage",
  contractNumber: "ARX-001",
  contractType: "usage",
  facilityId: "fac-1",
  vendorId: "v-1",
  additionalVendorIds: [] as string[],
  effectiveDate: new Date("2026-01-01T00:00:00Z"),
  expirationDate: new Date("2028-12-31T00:00:00Z"),
  totalValue: 1_000_000,
  vendor: { id: "v-1", name: "Arthrex" },
  terms: [] as unknown[],
  periods: [
    {
      id: "p-1",
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-01-31T00:00:00Z"),
      totalSpend: 50_000,
      totalVolume: 10,
      rebateEarned: 1_000,
      rebateCollected: 500,
      paymentExpected: 0,
      paymentActual: 0,
      tierAchieved: 1,
    },
  ],
  rebates: [
    {
      payPeriodEnd: new Date("2026-01-31T00:00:00Z"),
      rebateEarned: 1_000,
      collectionDate: new Date("2026-02-15T00:00:00Z"),
      rebateCollected: 500,
    },
  ],
}

// ─── Prisma + auth mocks ─────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        findManyWhere = where
        return [contractFixture]
      }),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: vi.fn(async () => ({
    vendor: { id: "v-1", name: "Arthrex" },
    user: { id: "user-test" },
  })),
}))

import { getVendorReportData } from "@/lib/actions/vendor-reports/report-data"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"

beforeEach(() => {
  vi.clearAllMocks()
  findManyWhere = null
})

// The exact per-contract key set the facility original returns.
const EXPECTED_CONTRACT_KEYS = [
  "id",
  "name",
  "contractNumber",
  "vendor",
  "vendorId",
  "contractType",
  "effectiveDate",
  "expirationDate",
  "totalValue",
  "rebateEarnedCanonical",
  "rebateCollectedCanonical",
  "marginCanonical",
  "periods",
].sort()

const EXPECTED_PERIOD_KEYS = [
  "id",
  "periodStart",
  "periodEnd",
  "totalSpend",
  "totalVolume",
  "rebateEarned",
  "rebateCollected",
  "paymentExpected",
  "paymentActual",
  "tierAchieved",
].sort()

describe("getVendorReportData", () => {
  it("exports an async function", () => {
    expect(typeof getVendorReportData).toBe("function")
    expect(getVendorReportData.constructor.name).toBe("AsyncFunction")
  })

  it("returns the byte-identical top-level payload shape", async () => {
    const result = await getVendorReportData({
      reportType: "usage",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    })
    expect(Object.keys(result).sort()).toEqual(
      ["facilityName", "contracts", "reportType", "dateFrom", "dateTo"].sort(),
    )
    expect(result.facilityName).toBe("All Facilities")
    expect(result.reportType).toBe("usage")
    expect(result.dateFrom).toBe("2026-01-01")
    expect(result.dateTo).toBe("2026-12-31")
    expect(Array.isArray(result.contracts)).toBe(true)
  })

  it("each contract row carries the exact key set + canonical totals", async () => {
    const result = await getVendorReportData({
      reportType: "usage",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    })
    const row = result.contracts[0]
    expect(Object.keys(row).sort()).toEqual(EXPECTED_CONTRACT_KEYS)
    // Canonical totals come from the Rebate table (sumEarnedRebatesLifetime
    // / sumCollectedRebates), not raw ContractPeriod.
    expect(row.rebateEarnedCanonical).toBe(1_000)
    expect(row.rebateCollectedCanonical).toBe(500)
    expect(row.marginCanonical).toBe(1_000) // earned − 0 payments
    expect(row.vendor).toBe("Arthrex")
    expect(row.vendorId).toBe("v-1")
    // Dates serialized to ISO strings.
    expect(typeof row.effectiveDate).toBe("string")
    expect(typeof row.expirationDate).toBe("string")
  })

  it("maps persisted ContractPeriod rows into the ReportPeriodRow shape", async () => {
    const result = await getVendorReportData({
      reportType: "usage",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    })
    const period = result.contracts[0].periods[0]
    expect(Object.keys(period).sort()).toEqual(EXPECTED_PERIOD_KEYS)
    expect(period.totalSpend).toBe(50_000)
    expect(period.tierAchieved).toBe(1)
  })

  it("scopes contracts via contractsOwnedByVendor (grouped additionalVendorIds covered)", async () => {
    await getVendorReportData({
      reportType: "usage",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    })
    const where = findManyWhere as Record<string, unknown>
    // The OR membership predicate from contractsOwnedByVendor must be
    // present, so a vendor appearing only in additionalVendorIds is
    // included — not just the primary vendorId.
    expect(where.OR).toEqual(contractsOwnedByVendor("v-1").OR)
    expect(where.OR).toContainEqual({
      additionalVendorIds: { has: "v-1" },
    })
    // Same contractType + status filters as the facility original.
    expect(where.contractType).toBe("usage")
    expect(where.status).toEqual({ in: ["active", "expiring"] })
  })

  it("maps grouped reportType to the 'grouped' contractType", async () => {
    await getVendorReportData({
      reportType: "grouped",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
    })
    const where = findManyWhere as Record<string, unknown>
    expect(where.contractType).toBe("grouped")
  })
})
