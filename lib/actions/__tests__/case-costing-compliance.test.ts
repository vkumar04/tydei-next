/**
 * Tests for case-costing compliance action:
 *   - getFacilityCaseCompliance
 *
 * Mocks prisma + requireFacility + audit. Verifies per-case and summary
 * rollup, facility scoping, and audit emission.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface SupplyRow {
  vendorItemNo: string | null
  isOnContract: boolean
  extendedCost: number
}

interface CaseRow {
  id: string
  facilityId: string
  supplies: SupplyRow[]
}

let caseRows: CaseRow[] = []
let lastSelect: Record<string, unknown> | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    case: {
      findMany: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { facilityId: string }
          select: Record<string, unknown>
        }) => {
          lastSelect = select
          return caseRows
            .filter((c) => c.facilityId === where.facilityId)
            .map((c) => ({
              id: c.id,
              supplies: c.supplies,
            }))
        },
      ),
    },
  },
}))

const requireFacilityMock = vi.fn(async () => ({
  facility: { id: "fac-1" },
  user: { id: "user-1" },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: () => requireFacilityMock(),
}))

const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})
vi.mock("@/lib/audit", () => ({
  logAudit: (args: Record<string, unknown>) => logAuditMock(args),
}))

import { getFacilityCaseCompliance } from "@/lib/actions/case-costing/compliance"

beforeEach(() => {
  vi.clearAllMocks()
  caseRows = []
  lastSelect = null
  requireFacilityMock.mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })
})

describe("getFacilityCaseCompliance", () => {
  it("returns empty perCase + zero summary when facility has no cases", async () => {
    const result = await getFacilityCaseCompliance()
    expect(result.perCase).toEqual([])
    expect(result.summary).toEqual({
      totalSupplySpend: 0,
      onContractSpend: 0,
      offContractSpend: 0,
      compliancePercent: 0,
      casesWithLowCompliance: 0,
    })
  })

  it("computes per-case compliance from supplies' isOnContract flag", async () => {
    caseRows = [
      {
        id: "c-1",
        facilityId: "fac-1",
        supplies: [
          { vendorItemNo: "X", isOnContract: true, extendedCost: 800 },
          { vendorItemNo: "Y", isOnContract: false, extendedCost: 200 },
        ],
      },
    ]
    const result = await getFacilityCaseCompliance()
    expect(result.perCase).toHaveLength(1)
    const c = result.perCase[0]!
    expect(c.caseId).toBe("c-1")
    expect(c.totalSupplySpend).toBe(1000)
    expect(c.onContractSpend).toBe(800)
    expect(c.offContractSpend).toBe(200)
    expect(c.compliancePercent).toBe(80)
    expect(c.suppliesTotal).toBe(2)
    expect(c.suppliesOnContract).toBe(1)
  })

  it("summarizes facility-level totals + flags low-compliance cases", async () => {
    caseRows = [
      // Low compliance — 50% on-contract.
      {
        id: "c-low",
        facilityId: "fac-1",
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 500 },
          { vendorItemNo: "B", isOnContract: false, extendedCost: 500 },
        ],
      },
      // High compliance — 100% on-contract.
      {
        id: "c-high",
        facilityId: "fac-1",
        supplies: [
          { vendorItemNo: "C", isOnContract: true, extendedCost: 1000 },
        ],
      },
    ]
    const result = await getFacilityCaseCompliance()
    expect(result.summary.totalSupplySpend).toBe(2000)
    expect(result.summary.onContractSpend).toBe(1500)
    expect(result.summary.offContractSpend).toBe(500)
    expect(result.summary.compliancePercent).toBe(75)
    expect(result.summary.casesWithLowCompliance).toBe(1)
  })

  it("only includes cases for the active facility", async () => {
    caseRows = [
      {
        id: "c-mine",
        facilityId: "fac-1",
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 100 },
        ],
      },
      {
        id: "c-other",
        facilityId: "fac-other",
        supplies: [
          { vendorItemNo: "B", isOnContract: false, extendedCost: 999 },
        ],
      },
    ]
    const result = await getFacilityCaseCompliance()
    expect(result.perCase.map((c) => c.caseId)).toEqual(["c-mine"])
    expect(result.summary.totalSupplySpend).toBe(100)
  })

  it("handles zero-supply cases without NaN", async () => {
    caseRows = [
      { id: "c-empty", facilityId: "fac-1", supplies: [] },
    ]
    const result = await getFacilityCaseCompliance()
    expect(result.perCase[0]!.compliancePercent).toBe(0)
    expect(result.perCase[0]!.totalSupplySpend).toBe(0)
    // Zero-supply case counts as low-compliance (0 < 80).
    expect(result.summary.casesWithLowCompliance).toBe(1)
  })

  it("projects only the columns the pure helper needs", async () => {
    await getFacilityCaseCompliance()
    expect(lastSelect).toMatchObject({
      id: true,
      supplies: expect.objectContaining({
        select: {
          vendorItemNo: true,
          isOnContract: true,
          extendedCost: true,
        },
      }),
    })
  })

  it("emits a case_costing.compliance_viewed audit log", async () => {
    caseRows = [
      {
        id: "c-1",
        facilityId: "fac-1",
        supplies: [
          { vendorItemNo: "A", isOnContract: true, extendedCost: 100 },
        ],
      },
    ]
    await getFacilityCaseCompliance()
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "case_costing.compliance_viewed",
        entityType: "facility",
        entityId: "fac-1",
        metadata: expect.objectContaining({ caseCount: 1 }),
      }),
    )
  })
})
