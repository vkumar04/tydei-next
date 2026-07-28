/**
 * SCOPE BUG (2026-07-28): `evaluatePurchaseCompliance` capped its COG read
 * at 500 rows ordered `transactionDate desc`, then reported
 * `totalPurchases: cog.length` and `complianceRatePct = compliant / 500`.
 * The Per-Purchase Compliance Audit card therefore read
 * "<n> of 500 purchases" for every facility/date-range with more than 500
 * rows — a compliance RATE over an arbitrary recency-ordered sample,
 * labelled as the facility's audit — and the Critical/Warning counters
 * flat-lined at the cap.
 *
 * These tests pin the split: the counters are computed over EVERY row in
 * the window, `audits` stays a labelled sample, and a rate is never
 * divided by the sample size.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type CogRow = {
  id: string
  vendorId: string | null
  vendorName: string | null
  vendorItemNo: string | null
  unitCost: number
  quantity: number
  transactionDate: Date
}

type ContractRow = {
  id: string
  vendorId: string
  effectiveDate: Date
  expirationDate: Date
  pricingItems: Array<{ vendorItemNo: string; unitPrice: number }>
}

let cogRows: CogRow[] = []
let contractRows: ContractRow[] = []

const cogFindManyMock = vi.fn(
  async (args: {
    where: { facilityId: string; transactionDate: { gte: Date; lte: Date } }
    take: number
    cursor?: { id: string }
    skip?: number
  }): Promise<CogRow[]> => {
    // Emulate Prisma keyset pagination over the fixture in fixture order.
    const start = args.cursor
      ? cogRows.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0)
      : 0
    return cogRows.slice(start, start + args.take)
  },
)

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findMany: vi.fn(async () => contractRows) },
    cOGRecord: { findMany: (args: unknown) => cogFindManyMock(args as never) },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })),
}))

vi.mock("@/lib/actions/analytics/_telemetry", () => ({
  withTelemetry: (_n: string, _ctx: unknown, fn: () => Promise<unknown>) => fn(),
}))

vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { evaluatePurchaseCompliance } from "@/lib/actions/analytics/purchase-compliance"

const WINDOW = { fromDate: "2026-01-01", toDate: "2026-12-31" }

/** `n` purchases from a vendor with no contract → all CRITICAL. */
function offContractRows(n: number, prefix = "cog"): CogRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    vendorId: "v-unknown",
    vendorName: "Rogue Supply",
    vendorItemNo: `SKU-${i}`,
    unitCost: 100,
    quantity: 1,
    transactionDate: new Date("2026-06-01"),
  }))
}

/** `n` purchases from an on-contract vendor at the contract price. */
function compliantRows(n: number, prefix = "ok"): CogRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    vendorId: "v-1",
    vendorName: "Arthrex",
    vendorItemNo: "SKU-ON",
    unitCost: 100,
    quantity: 1,
    transactionDate: new Date("2026-06-02"),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  cogRows = []
  contractRows = [
    {
      id: "c-1",
      vendorId: "v-1",
      effectiveDate: new Date("2026-01-01"),
      expirationDate: new Date("2027-01-01"),
      pricingItems: [{ vendorItemNo: "SKU-ON", unitPrice: 100 }],
    },
  ]
})

describe("evaluatePurchaseCompliance — totals cover the whole window", () => {
  it("counts every purchase in the window, not the audit sample", async () => {
    cogRows = offContractRows(1200)

    const report = await evaluatePurchaseCompliance({ ...WINDOW, limit: 500 })

    expect(report.totalPurchases).toBe(1200)
    expect(report.audits).toHaveLength(500)
    expect(report.auditSampleLimit).toBe(500)
    expect(report.auditSampleTruncated).toBe(true)
    expect(report.scanTruncated).toBe(false)
  })

  it("violation counters keep climbing past the audit-sample cap", async () => {
    cogRows = offContractRows(1200)

    const report = await evaluatePurchaseCompliance({ ...WINDOW, limit: 500 })

    // Every row is a purchase from a vendor with no contract.
    expect(report.criticalCount).toBe(1200)
    expect(report.byType.OFF_CONTRACT_VENDOR).toBe(1200)
    expect(report.compliantPurchases).toBe(0)
    expect(report.complianceRatePct).toBe(0)
  })

  it("the rate's denominator is the window, never the capped sample", async () => {
    // First 500 rows (the whole sample) are clean; the 700 behind them
    // are not. The old code divided 500 by 500 and reported 100%.
    cogRows = [...compliantRows(500), ...offContractRows(700)]

    const report = await evaluatePurchaseCompliance({ ...WINDOW, limit: 500 })

    expect(report.audits).toHaveLength(500)
    expect(report.audits.every((a) => a.isCompliant)).toBe(true)
    expect(report.totalPurchases).toBe(1200)
    expect(report.compliantPurchases).toBe(500)
    // 500 / 1200 = 41.7%, NOT 100%.
    expect(report.complianceRatePct).toBe(41.7)
  })

  it("compliant + violating counts sum to the full window total", async () => {
    cogRows = [...compliantRows(900), ...offContractRows(300)]

    const report = await evaluatePurchaseCompliance({ ...WINDOW, limit: 100 })

    expect(report.compliantPurchases + report.criticalCount).toBe(
      report.totalPurchases,
    )
    expect(report.totalPurchases).toBe(1200)
    expect(report.audits).toHaveLength(100)
  })

  it("never issues a capped COG read (pages until the window is drained)", async () => {
    cogRows = offContractRows(4500)

    await evaluatePurchaseCompliance({ ...WINDOW, limit: 500 })

    const takes = cogFindManyMock.mock.calls.map(
      ([args]) => (args as { take: number }).take,
    )
    // No round trip is bounded by the audit-sample size.
    expect(takes).not.toContain(500)
    // 4500 rows cannot come back in one chunk.
    expect(cogFindManyMock.mock.calls.length).toBeGreaterThan(1)
    const cursors = cogFindManyMock.mock.calls
      .slice(1)
      .map(([args]) => (args as { cursor?: { id: string } }).cursor)
    expect(cursors.every((c) => c != null)).toBe(true)
  })

  it("does not truncate when the window fits inside the sample", async () => {
    cogRows = compliantRows(12)

    const report = await evaluatePurchaseCompliance({ ...WINDOW, limit: 500 })

    expect(report.totalPurchases).toBe(12)
    expect(report.audits).toHaveLength(12)
    expect(report.auditSampleTruncated).toBe(false)
    expect(report.complianceRatePct).toBe(100)
  })

  it("empty window reports zero purchases at 100%", async () => {
    const report = await evaluatePurchaseCompliance(WINDOW)

    expect(report.totalPurchases).toBe(0)
    expect(report.audits).toEqual([])
    expect(report.auditSampleTruncated).toBe(false)
    expect(report.complianceRatePct).toBe(100)
  })

  it("scopes the COG read to the caller's facility on every chunk", async () => {
    cogRows = offContractRows(3000)

    await evaluatePurchaseCompliance(WINDOW)

    expect(cogFindManyMock.mock.calls.length).toBeGreaterThan(1)
    for (const [args] of cogFindManyMock.mock.calls) {
      expect((args as { where: { facilityId: string } }).where.facilityId).toBe(
        "fac-1",
      )
    }
  })
})
