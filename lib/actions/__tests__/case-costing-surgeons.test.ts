/**
 * Tests for case-costing surgeon actions:
 *   - getSurgeonScorecardsForFacility
 *   - getFacilityAveragesForFacility
 *
 * Mocks prisma + requireFacility + audit; exercises the thin mapping layer
 * between Prisma rows and the pure helpers in `lib/case-costing/`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface CaseRow {
  id: string
  facilityId: string
  surgeonName: string | null
  primaryCptCode: string | null
  totalSpend: number
  totalReimbursement: number
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
          const rows = caseRows.filter((c) => c.facilityId === where.facilityId)
          // Project to requested columns — caller asks for either
          // {surgeonName, primaryCptCode, totalSpend, totalReimbursement} or
          // {totalSpend, totalReimbursement}.
          return rows.map((r) => {
            const projection: Record<string, unknown> = {}
            if ("surgeonName" in select) projection.surgeonName = r.surgeonName
            if ("primaryCptCode" in select)
              projection.primaryCptCode = r.primaryCptCode
            if ("totalSpend" in select) projection.totalSpend = r.totalSpend
            if ("totalReimbursement" in select)
              projection.totalReimbursement = r.totalReimbursement
            return projection
          })
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

import {
  getSurgeonScorecardsForFacility,
  getFacilityAveragesForFacility,
} from "@/lib/actions/case-costing/surgeons"

beforeEach(() => {
  vi.clearAllMocks()
  caseRows = []
  lastSelect = null
  requireFacilityMock.mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })
})

// ─── getSurgeonScorecardsForFacility ─────────────────────────────

describe("getSurgeonScorecardsForFacility", () => {
  it("returns [] when the facility has no cases", async () => {
    const result = await getSurgeonScorecardsForFacility()
    expect(result).toEqual([])
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "case_costing.surgeons_viewed",
        entityType: "facility",
        entityId: "fac-1",
      }),
    )
  })

  it("skips cases with null surgeonName", async () => {
    caseRows = [
      {
        id: "c-1",
        facilityId: "fac-1",
        surgeonName: null,
        primaryCptCode: "27447",
        totalSpend: 1000,
        totalReimbursement: 2000,
      },
      {
        id: "c-2",
        facilityId: "fac-1",
        surgeonName: "Dr. A",
        primaryCptCode: "27447",
        totalSpend: 500,
        totalReimbursement: 1200,
      },
    ]
    const result = await getSurgeonScorecardsForFacility()
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("Dr. A")
  })

  it("aggregates cases per surgeon and returns sorted by overallScore desc", async () => {
    caseRows = [
      {
        id: "c-1",
        facilityId: "fac-1",
        surgeonName: "Dr. High",
        primaryCptCode: "27447",
        totalSpend: 500,
        totalReimbursement: 2000,
      },
      {
        id: "c-2",
        facilityId: "fac-1",
        surgeonName: "Dr. High",
        primaryCptCode: "27447",
        totalSpend: 700,
        totalReimbursement: 2200,
      },
      {
        id: "c-3",
        facilityId: "fac-1",
        surgeonName: "Dr. Low",
        primaryCptCode: "27130",
        totalSpend: 50_000,
        totalReimbursement: 60_000,
      },
    ]
    const result = await getSurgeonScorecardsForFacility()
    expect(result).toHaveLength(2)
    // High-spend surgeon has a lower spendScore → sort puts the cheaper
    // surgeon first.
    expect(result[0]!.name).toBe("Dr. High")
    expect(result[1]!.name).toBe("Dr. Low")
    expect(result[0]!.caseCount).toBe(2)
    expect(result[0]!.totalSpend).toBe(1200)
    expect(result[0]!.overallScore).toBeGreaterThanOrEqual(
      result[1]!.overallScore,
    )
  })

  it("only loads cases for the active facility", async () => {
    caseRows = [
      {
        id: "c-1",
        facilityId: "fac-1",
        surgeonName: "Dr. A",
        primaryCptCode: null,
        totalSpend: 0,
        totalReimbursement: 0,
      },
      {
        id: "c-2",
        facilityId: "fac-other",
        surgeonName: "Dr. B",
        primaryCptCode: null,
        totalSpend: 0,
        totalReimbursement: 0,
      },
    ]
    const result = await getSurgeonScorecardsForFacility()
    expect(result.map((s) => s.name)).toEqual(["Dr. A"])
  })

  it("projects only the columns the pure helper needs (no overfetch)", async () => {
    caseRows = []
    await getSurgeonScorecardsForFacility()
    expect(lastSelect).toEqual({
      surgeonName: true,
      primaryCptCode: true,
      totalSpend: true,
      totalReimbursement: true,
    })
  })

  it("emits a case_costing.surgeons_viewed audit log with counts", async () => {
    caseRows = [
      {
        id: "c-1",
        facilityId: "fac-1",
        surgeonName: "Dr. A",
        primaryCptCode: "27447",
        totalSpend: 500,
        totalReimbursement: 1200,
      },
    ]
    await getSurgeonScorecardsForFacility()
    expect(logAuditMock).toHaveBeenCalledTimes(1)
    const call = logAuditMock.mock.calls[0] as unknown as [
      {
        action: string
        metadata: { caseCount: number; surgeonCount: number }
      },
    ]
    expect(call[0].action).toBe("case_costing.surgeons_viewed")
    expect(call[0].metadata.caseCount).toBe(1)
    expect(call[0].metadata.surgeonCount).toBe(1)
  })
})

// ─── getFacilityAveragesForFacility ──────────────────────────────

describe("getFacilityAveragesForFacility", () => {
  it("returns zeros + null time when no cases exist", async () => {
    const result = await getFacilityAveragesForFacility()
    expect(result).toEqual({
      avgCaseCost: 0,
      avgReimbursementPerCase: 0,
      avgMarginPct: 0,
      avgTimeInOrMinutes: null,
    })
  })

  it("computes simple averages across cases", async () => {
    caseRows = [
      {
        id: "c-1",
        facilityId: "fac-1",
        surgeonName: null,
        primaryCptCode: null,
        totalSpend: 1000,
        totalReimbursement: 2000,
      },
      {
        id: "c-2",
        facilityId: "fac-1",
        surgeonName: null,
        primaryCptCode: null,
        totalSpend: 3000,
        totalReimbursement: 4000,
      },
    ]
    const result = await getFacilityAveragesForFacility()
    expect(result.avgCaseCost).toBe(2000)
    expect(result.avgReimbursementPerCase).toBe(3000)
    // avgMarginPct = ((6000 - 4000) / 6000) * 100 = 33.33…
    expect(result.avgMarginPct).toBeCloseTo(33.3333, 3)
    // timeInOrMinutes is always null from the action (schema limitation).
    expect(result.avgTimeInOrMinutes).toBeNull()
  })

  it("only includes cases for the active facility", async () => {
    caseRows = [
      {
        id: "c-1",
        facilityId: "fac-1",
        surgeonName: null,
        primaryCptCode: null,
        totalSpend: 1000,
        totalReimbursement: 2000,
      },
      {
        id: "c-2",
        facilityId: "fac-other",
        surgeonName: null,
        primaryCptCode: null,
        totalSpend: 999_999,
        totalReimbursement: 999_999,
      },
    ]
    const result = await getFacilityAveragesForFacility()
    expect(result.avgCaseCost).toBe(1000)
  })

  it("projects only totalSpend + totalReimbursement", async () => {
    await getFacilityAveragesForFacility()
    expect(lastSelect).toEqual({
      totalSpend: true,
      totalReimbursement: true,
    })
  })

  it("emits a case_costing.facility_averages_viewed audit log", async () => {
    caseRows = [
      {
        id: "c-1",
        facilityId: "fac-1",
        surgeonName: null,
        primaryCptCode: null,
        totalSpend: 1000,
        totalReimbursement: 2000,
      },
    ]
    await getFacilityAveragesForFacility()
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "case_costing.facility_averages_viewed",
        entityType: "facility",
        entityId: "fac-1",
        metadata: { caseCount: 1 },
      }),
    )
  })
})
