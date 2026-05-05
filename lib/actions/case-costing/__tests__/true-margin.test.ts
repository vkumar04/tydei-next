/**
 * Smoke tests for getTrueMarginReport.
 *
 * Mocks Prisma + requireFacility so we can assert the action correctly:
 *   - Builds the per-vendor spend map from CaseSupply.contractId.
 *   - Resolves contractId → vendorId via Prisma.contract.
 *   - Pulls earned rebates per vendor through `sumEarnedRebatesLifetime`.
 *   - Routes per-vendor rebate dollars through
 *     `allocateRebatesToProcedures` so per-procedure allocation is
 *     proportional to spend share.
 *   - Computes standard vs true margin off case totals.
 *
 * The action proxies to the canonical helper in
 * `lib/contracts/true-margin.ts` (allocation by spend share). The
 * pure helper has its own coverage; these tests verify the wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface CaseRow {
  id: string
  caseNumber: string
  facilityId: string
  surgeonName: string | null
  primaryCptCode: string | null
  totalSpend: number
  totalReimbursement: number
  dateOfSurgery: Date
  supplies: SupplyRow[]
}

interface SupplyRow {
  extendedCost: number
  contractId: string | null
  isOnContract: boolean
}

interface ContractRow {
  id: string
  vendorId: string
  vendor: { id: string; name: string }
}

interface RebateRow {
  rebateEarned: number
  payPeriodEnd: Date
  contract: { vendorId: string }
}

let caseRows: CaseRow[] = []
let contractRows: ContractRow[] = []
let rebateRows: RebateRow[] = []

vi.mock("@/lib/db", () => ({
  prisma: {
    case: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { facilityId: string; dateOfSurgery: { gte: Date; lte: Date } }
        }) => {
          return caseRows
            .filter((c) => c.facilityId === where.facilityId)
            .filter(
              (c) =>
                c.dateOfSurgery >= where.dateOfSurgery.gte &&
                c.dateOfSurgery <= where.dateOfSurgery.lte,
            )
            .map((c) => ({
              ...c,
              supplies: c.supplies.map((s) => ({
                extendedCost: s.extendedCost,
                contractId: s.contractId,
                isOnContract: s.isOnContract,
              })),
            }))
        },
      ),
    },
    contract: {
      findMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => {
          return contractRows.filter((c) => where.id.in.includes(c.id))
        },
      ),
    },
    rebate: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            facilityId: string
            contract: { vendorId: { in: string[] } }
            payPeriodEnd: { gte: Date; lte: Date }
          }
        }) => {
          return rebateRows.filter(
            (r) =>
              where.contract.vendorId.in.includes(r.contract.vendorId) &&
              r.payPeriodEnd >= where.payPeriodEnd.gte &&
              r.payPeriodEnd <= where.payPeriodEnd.lte,
          )
        },
      ),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })),
}))

import { getTrueMarginReport } from "@/lib/actions/case-costing/true-margin"

beforeEach(() => {
  vi.clearAllMocks()
  caseRows = []
  contractRows = []
  rebateRows = []
})

// ─── Happy path: 3 procedures, 2 vendors ────────────────────────

describe("getTrueMarginReport — happy path", () => {
  it("allocates each vendor's earned rebate proportionally across procedures", async () => {
    contractRows = [
      {
        id: "ctr-medtronic",
        vendorId: "vnd-medtronic",
        vendor: { id: "vnd-medtronic", name: "Medtronic" },
      },
      {
        id: "ctr-stryker",
        vendorId: "vnd-stryker",
        vendor: { id: "vnd-stryker", name: "Stryker" },
      },
    ]

    // Three cases (procedures from the report's POV):
    //   case-1: $4,000 Medtronic + $1,000 Stryker
    //   case-2: $6,000 Medtronic
    //   case-3: $9,000 Stryker
    // Vendor totals:
    //   Medtronic = $10,000;  Stryker = $10,000
    // Earned rebates (in window):
    //   Medtronic earned = $1,000   Stryker earned = $500
    // Expected allocations:
    //   case-1: Medtronic 4000/10000*1000 = $400 ; Stryker 1000/10000*500 = $50  -> $450
    //   case-2: Medtronic 6000/10000*1000 = $600                                  -> $600
    //   case-3: Stryker 9000/10000*500 = $450                                     -> $450
    caseRows = [
      {
        id: "case-1",
        caseNumber: "C-001",
        facilityId: "fac-1",
        surgeonName: "Dr. A",
        primaryCptCode: "27447",
        totalSpend: 5_000,
        totalReimbursement: 8_000,
        dateOfSurgery: new Date("2026-02-15"),
        supplies: [
          { extendedCost: 4_000, contractId: "ctr-medtronic", isOnContract: true },
          { extendedCost: 1_000, contractId: "ctr-stryker", isOnContract: true },
        ],
      },
      {
        id: "case-2",
        caseNumber: "C-002",
        facilityId: "fac-1",
        surgeonName: "Dr. B",
        primaryCptCode: "27130",
        totalSpend: 6_000,
        totalReimbursement: 9_000,
        dateOfSurgery: new Date("2026-02-20"),
        supplies: [
          { extendedCost: 6_000, contractId: "ctr-medtronic", isOnContract: true },
        ],
      },
      {
        id: "case-3",
        caseNumber: "C-003",
        facilityId: "fac-1",
        surgeonName: "Dr. C",
        primaryCptCode: "29888",
        totalSpend: 9_000,
        totalReimbursement: 12_000,
        dateOfSurgery: new Date("2026-03-01"),
        supplies: [
          { extendedCost: 9_000, contractId: "ctr-stryker", isOnContract: true },
        ],
      },
    ]

    rebateRows = [
      {
        rebateEarned: 1_000,
        payPeriodEnd: new Date("2026-03-31"),
        contract: { vendorId: "vnd-medtronic" },
      },
      {
        rebateEarned: 500,
        payPeriodEnd: new Date("2026-03-31"),
        contract: { vendorId: "vnd-stryker" },
      },
    ]

    const report = await getTrueMarginReport({
      facilityId: "fac-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    })

    // Per-procedure allocations sum correctly.
    const byId = new Map(report.procedures.map((p) => [p.procedureId, p]))
    expect(byId.get("case-1")!.rebateAllocation).toBeCloseTo(450, 6)
    expect(byId.get("case-2")!.rebateAllocation).toBeCloseTo(600, 6)
    expect(byId.get("case-3")!.rebateAllocation).toBeCloseTo(450, 6)

    // Sum of per-procedure allocations == sum of all earned rebate.
    const allocSum = report.procedures.reduce(
      (s, p) => s + p.rebateAllocation,
      0,
    )
    expect(allocSum).toBeCloseTo(1_500, 6)
    expect(report.summary.totalRebateAllocation).toBeCloseTo(1_500, 6)

    // Standard margin = revenue - cost  (case-1: 8000-5000 = 3000)
    expect(byId.get("case-1")!.standardMargin).toBe(3_000)
    // True margin = standard + rebate (3000 + 450 = 3450)
    expect(byId.get("case-1")!.trueMargin).toBeCloseTo(3_450, 6)

    // Effective cost = directCost - rebate  (5000 - 450 = 4550)
    expect(byId.get("case-1")!.effectiveCost).toBeCloseTo(4_550, 6)

    // Summary improvement % = trueMarginPct - standardMarginPct.
    // Sum totalRevenue 29000, directCost 20000, rebate 1500.
    // standard = 9000/29000 = 31.034…%, true = 10500/29000 = 36.207…%
    expect(report.summary.standardMarginPercent).toBeCloseTo(31.0345, 3)
    expect(report.summary.trueMarginPercent).toBeCloseTo(36.2069, 3)
    expect(report.summary.marginImprovementPercent).toBeCloseTo(5.1724, 3)

    // Vendor roll-ups present and sorted by earnedRebate desc.
    expect(report.vendors).toHaveLength(2)
    expect(report.vendors[0]!.vendorName).toBe("Medtronic")
    expect(report.vendors[0]!.earnedRebate).toBeCloseTo(1_000, 6)
    expect(report.vendors[1]!.vendorName).toBe("Stryker")
    expect(report.vendors[1]!.earnedRebate).toBeCloseTo(500, 6)
  })
})

// ─── Edge case: vendor with zero spend → no allocation ──────────

describe("getTrueMarginReport — edge cases", () => {
  it("does not allocate to a vendor with no in-window spend", async () => {
    // Stryker contract exists, has rebate rows in-window, but no
    // CaseSupply rows reference it inside the period — so it should
    // never appear in the per-procedure allocations or vendors[].
    contractRows = [
      {
        id: "ctr-medtronic",
        vendorId: "vnd-medtronic",
        vendor: { id: "vnd-medtronic", name: "Medtronic" },
      },
      // ctr-stryker still exists in the catalog, but no supply
      // references it during the window. Because contractToVendor
      // is only built from contractIds the supplies actually mention,
      // we don't even include Stryker in the contract findMany call
      // here — but having it queryable should be a no-op.
      {
        id: "ctr-stryker",
        vendorId: "vnd-stryker",
        vendor: { id: "vnd-stryker", name: "Stryker" },
      },
    ]

    caseRows = [
      {
        id: "case-1",
        caseNumber: "C-001",
        facilityId: "fac-1",
        surgeonName: "Dr. A",
        primaryCptCode: "27447",
        totalSpend: 1_000,
        totalReimbursement: 2_000,
        dateOfSurgery: new Date("2026-02-15"),
        supplies: [
          { extendedCost: 1_000, contractId: "ctr-medtronic", isOnContract: true },
        ],
      },
    ]

    // Stryker would have $500 of earned rebate, but vendor never
    // appears in the spend map → its rebate row never gets pulled
    // (vendor not in `realVendorIds`) and it must not appear in
    // either the per-procedure allocation or the vendor roll-up.
    rebateRows = [
      {
        rebateEarned: 250,
        payPeriodEnd: new Date("2026-03-31"),
        contract: { vendorId: "vnd-medtronic" },
      },
      {
        rebateEarned: 500,
        payPeriodEnd: new Date("2026-03-31"),
        contract: { vendorId: "vnd-stryker" },
      },
    ]

    const report = await getTrueMarginReport({
      facilityId: "fac-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    })

    // Only Medtronic's rebate ($250) is allocated; Stryker is silent.
    expect(report.summary.totalRebateAllocation).toBeCloseTo(250, 6)
    expect(report.procedures[0]!.rebateAllocation).toBeCloseTo(250, 6)

    // Vendor roll-up only contains Medtronic — Stryker had no spend
    // so it never enters the spend map.
    expect(report.vendors).toHaveLength(1)
    expect(report.vendors[0]!.vendorName).toBe("Medtronic")
  })
})
