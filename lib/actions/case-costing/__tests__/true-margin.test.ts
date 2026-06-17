/**
 * Smoke tests for getTrueMarginReport.
 *
 * The Rebate Allocation column is the PER-SUPPLY contributed rebate:
 * each on-contract supply is matched to its contract and that contract's
 * rebate rule (derived by the shared `buildSupplyRebateRuleMap`) is
 * applied to the supply (Vick 2026-06-16 "Rebate allocation should be
 * taking the products the surgeons used … checking the product numbers
 * with the contracts"). These tests mock Prisma + requireFacility and
 * assert the per-supply allocation, the Revenue reimbursement backfill,
 * and the standard/true-margin math.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface SupplyRow {
  extendedCost: number
  contractId: string | null
  isOnContract: boolean
  quantity: number
}

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
  procedures?: { cptCode: string | null }[]
}

interface TermTierRow {
  tierNumber: number
  spendMin: number | null
  spendMax: number | null
  volumeMin: number | null
  volumeMax: number | null
  rebateValue: number
  rebateType: string
}

interface ContractRow {
  id: string
  vendorId: string
  vendor: { id: string; name: string }
  terms: { termType: string; tiers: TermTierRow[] }[]
}

let caseRows: CaseRow[] = []
let contractRows: ContractRow[] = []
let payorContractRows: { cptRates: unknown }[] = []
// contractId -> on-contract COG spend / units (drive the rule's tier pick).
let cogSpendByContract: Record<string, number> = {}
let unitsByContract: Record<string, number> = {}

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
                quantity: s.quantity,
              })),
              procedures: c.procedures ?? [],
            }))
        },
      ),
    },
    payorContract: {
      findMany: vi.fn(async () => payorContractRows),
    },
    contract: {
      // Serves BOTH the contractToVendor lookup (id/vendorId/vendor) and
      // buildSupplyRebateRuleMap (id/terms) — both query `where:{id:{in}}`.
      findMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => {
          return contractRows.filter((c) => where.id.in.includes(c.id))
        },
      ),
    },
    cOGRecord: {
      groupBy: vi.fn(
        async ({ where }: { where: { contractId: { in: string[] } } }) =>
          where.contractId.in
            .filter((id) => cogSpendByContract[id] !== undefined)
            .map((id) => ({
              contractId: id,
              _sum: { extendedPrice: cogSpendByContract[id] },
            })),
      ),
    },
    caseSupply: {
      groupBy: vi.fn(
        async ({ where }: { where: { contractId: { in: string[] } } }) =>
          where.contractId.in
            .filter((id) => unitsByContract[id] !== undefined)
            .map((id) => ({
              contractId: id,
              _sum: { quantity: unitsByContract[id] },
            })),
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
  payorContractRows = []
  cogSpendByContract = {}
  unitsByContract = {}
})

// A volume_rebate ($/unit) contract — the simplest rule path: per-supply
// rebate = quantity × perUnitRate, clamped to the line's extendedCost.
function volumeContract(
  id: string,
  vendorId: string,
  vendorName: string,
  perUnitRate: number,
): ContractRow {
  return {
    id,
    vendorId,
    vendor: { id: vendorId, name: vendorName },
    terms: [
      {
        termType: "volume_rebate",
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            spendMax: null,
            volumeMin: 0,
            volumeMax: null,
            rebateValue: perUnitRate,
            rebateType: "fixed_rebate_per_unit",
          },
        ],
      },
    ],
  }
}

// ─── Per-supply allocation ──────────────────────────────────────

describe("getTrueMarginReport — per-supply rebate allocation", () => {
  it("allocates each procedure's rebate from the supplies' own contract rules", async () => {
    // Two $/unit contracts: Medtronic $10/unit, Stryker $25/unit.
    contractRows = [
      volumeContract("ctr-medtronic", "vnd-medtronic", "Medtronic", 10),
      volumeContract("ctr-stryker", "vnd-stryker", "Stryker", 25),
    ]
    // Realized on-contract totals so the rule's tier (volumeMin 0) qualifies
    // and the representative line cost stays above the per-unit rate.
    cogSpendByContract = { "ctr-medtronic": 10_000, "ctr-stryker": 9_000 }
    unitsByContract = { "ctr-medtronic": 100, "ctr-stryker": 90 }

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
          // 4 Medtronic units → 4×$10 = $40 ; 2 Stryker units → 2×$25 = $50
          { extendedCost: 4_000, contractId: "ctr-medtronic", isOnContract: true, quantity: 4 },
          { extendedCost: 1_000, contractId: "ctr-stryker", isOnContract: true, quantity: 2 },
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
          // 6 Medtronic units → 6×$10 = $60
          { extendedCost: 6_000, contractId: "ctr-medtronic", isOnContract: true, quantity: 6 },
        ],
      },
    ]

    const report = await getTrueMarginReport({
      facilityId: "fac-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    })

    const byId = new Map(report.procedures.map((p) => [p.procedureId, p]))
    expect(byId.get("case-1")!.rebateAllocation).toBeCloseTo(90, 6) // 40 + 50
    expect(byId.get("case-2")!.rebateAllocation).toBeCloseTo(60, 6)

    // Summary rolls up from the per-procedure allocations.
    expect(report.summary.totalRebateAllocation).toBeCloseTo(150, 6)

    // Standard margin = revenue - cost (case-1: 8000-5000 = 3000).
    expect(byId.get("case-1")!.standardMargin).toBe(3_000)
    // True margin = standard + rebate (3000 + 90).
    expect(byId.get("case-1")!.trueMargin).toBeCloseTo(3_090, 6)
    // Effective cost = directCost - rebate (5000 - 90).
    expect(byId.get("case-1")!.effectiveCost).toBeCloseTo(4_910, 6)

    // Vendor roll-up = Σ per-supply rebate by vendor (coherent w/ procedures).
    const vById = new Map(report.vendors.map((v) => [v.vendorId, v]))
    expect(vById.get("vnd-medtronic")!.earnedRebate).toBeCloseTo(100, 6) // 40+60
    expect(vById.get("vnd-stryker")!.earnedRebate).toBeCloseTo(50, 6)
  })

  it("off-contract supplies contribute no rebate", async () => {
    contractRows = [volumeContract("ctr-medtronic", "vnd-medtronic", "Medtronic", 10)]
    cogSpendByContract = { "ctr-medtronic": 1_000 }
    unitsByContract = { "ctr-medtronic": 10 }

    caseRows = [
      {
        id: "case-1",
        caseNumber: "C-001",
        facilityId: "fac-1",
        surgeonName: "Dr. A",
        primaryCptCode: "27447",
        totalSpend: 2_000,
        totalReimbursement: 5_000,
        dateOfSurgery: new Date("2026-02-15"),
        supplies: [
          // On-contract: 5 units × $10 = $50.
          { extendedCost: 1_000, contractId: "ctr-medtronic", isOnContract: true, quantity: 5 },
          // Off-contract: contributes nothing even though it has spend.
          { extendedCost: 1_000, contractId: null, isOnContract: false, quantity: 3 },
        ],
      },
    ]

    const report = await getTrueMarginReport({
      facilityId: "fac-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    })

    expect(report.procedures[0]!.rebateAllocation).toBeCloseTo(50, 6)
    expect(report.summary.totalRebateAllocation).toBeCloseTo(50, 6)
    // Only the on-contract vendor appears in the roll-up.
    expect(report.vendors).toHaveLength(1)
    expect(report.vendors[0]!.vendorName).toBe("Medtronic")
  })
})

// ─── Reimbursement (Revenue) backfill ───────────────────────────
//
// Regression guard for "Revenue is reimbursement" (Vick 2026-06-16):
// the prod demo cases carry `totalReimbursement = 0`, so the action used
// to render Revenue = $0 for every row. Revenue must backfill from the
// canonical CPT-rate map (`resolveCaseReimbursement`) like the cases
// list / hero card / report do — CLAUDE.md "Case reimbursement backfill".

describe("getTrueMarginReport — Revenue backfill", () => {
  it("fills Revenue from the payor CPT-rate map when totalReimbursement is 0", async () => {
    contractRows = [volumeContract("ctr-medtronic", "vnd-medtronic", "Medtronic", 0)]
    caseRows = [
      {
        id: "case-1",
        caseNumber: "C-1",
        facilityId: "fac-1",
        surgeonName: "Dr. A",
        primaryCptCode: "27447",
        totalSpend: 1000,
        // Prod state: no stored reimbursement.
        totalReimbursement: 0,
        dateOfSurgery: new Date("2026-02-01"),
        supplies: [
          { extendedCost: 1000, contractId: "ctr-medtronic", isOnContract: true, quantity: 1 },
        ],
        procedures: [{ cptCode: "27447" }],
      },
    ]
    // Payor contract prices CPT 27447 at $12,000.
    payorContractRows = [{ cptRates: [{ cpt: "27447", rate: 12000 }] }]

    const report = await getTrueMarginReport({
      facilityId: "fac-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-02-28",
    })

    expect(report.procedures[0]!.totalRevenue).toBe(12000)
    expect(report.summary.totalRevenue).toBe(12000)
    // Standard margin = revenue - direct cost = 12000 - 1000.
    expect(report.summary.standardMargin).toBe(11000)
  })

  it("keeps the stored reimbursement when it is already set (> 0)", async () => {
    contractRows = []
    caseRows = [
      {
        id: "case-2",
        caseNumber: "C-2",
        facilityId: "fac-1",
        surgeonName: "Dr. B",
        primaryCptCode: "27447",
        totalSpend: 500,
        totalReimbursement: 9000,
        dateOfSurgery: new Date("2026-02-02"),
        supplies: [{ extendedCost: 500, contractId: null, isOnContract: false, quantity: 1 }],
        procedures: [{ cptCode: "27447" }],
      },
    ]
    // A rate map exists but must NOT override an explicit stored value.
    payorContractRows = [{ cptRates: [{ cpt: "27447", rate: 12000 }] }]

    const report = await getTrueMarginReport({
      facilityId: "fac-1",
      periodStart: "2026-01-01",
      periodEnd: "2026-02-28",
    })

    expect(report.summary.totalRevenue).toBe(9000)
  })
})
