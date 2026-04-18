/**
 * Tests for case-costing payor-mix action:
 *   - getFacilityPayorMix
 *
 * Mocks prisma + requireFacility + audit. Verifies that the action scopes
 * to the active facility, wraps the pure helper correctly, and emits an
 * audit log. Note: Case currently has no payorType column in the schema,
 * so every case is classified as casesWithoutPayor until the model grows
 * one; the tests encode that contract explicitly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface CaseRow {
  id: string
  facilityId: string
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
          return caseRows
            .filter((c) => c.facilityId === where.facilityId)
            .map((c) => ({
              totalReimbursement: c.totalReimbursement,
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

import { getFacilityPayorMix } from "@/lib/actions/case-costing/payor-mix"

beforeEach(() => {
  vi.clearAllMocks()
  caseRows = []
  lastSelect = null
  requireFacilityMock.mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })
})

describe("getFacilityPayorMix", () => {
  it("returns an all-zero summary when facility has no cases", async () => {
    const result = await getFacilityPayorMix()
    expect(result.totalCases).toBe(0)
    expect(result.totalReimbursement).toBe(0)
    expect(result.casesWithoutPayor).toBe(0)
    for (const p of Object.values(result.shares)) {
      expect(p).toBe(0)
    }
    for (const v of Object.values(result.reimbursementByPayor)) {
      expect(v).toBe(0)
    }
  })

  it("sums totalReimbursement across the facility's cases", async () => {
    caseRows = [
      { id: "c-1", facilityId: "fac-1", totalReimbursement: 1000 },
      { id: "c-2", facilityId: "fac-1", totalReimbursement: 2500 },
      { id: "c-3", facilityId: "fac-1", totalReimbursement: 500 },
    ]
    const result = await getFacilityPayorMix()
    expect(result.totalCases).toBe(3)
    expect(result.totalReimbursement).toBe(4000)
  })

  it("classifies every case as casesWithoutPayor (no payorType on Case yet)", async () => {
    caseRows = [
      { id: "c-1", facilityId: "fac-1", totalReimbursement: 100 },
      { id: "c-2", facilityId: "fac-1", totalReimbursement: 200 },
    ]
    const result = await getFacilityPayorMix()
    expect(result.casesWithoutPayor).toBe(2)
    // All shares stay 0 because totalClassifiedCases = 0.
    expect(result.shares.commercial).toBe(0)
    expect(result.shares.medicare).toBe(0)
  })

  it("only includes cases for the active facility", async () => {
    caseRows = [
      { id: "c-1", facilityId: "fac-1", totalReimbursement: 100 },
      { id: "c-2", facilityId: "fac-other", totalReimbursement: 999 },
    ]
    const result = await getFacilityPayorMix()
    expect(result.totalCases).toBe(1)
    expect(result.totalReimbursement).toBe(100)
  })

  it("projects only totalReimbursement from Case (no overfetch)", async () => {
    await getFacilityPayorMix()
    expect(lastSelect).toEqual({ totalReimbursement: true })
  })

  it("emits a case_costing.payor_mix_viewed audit log", async () => {
    caseRows = [
      { id: "c-1", facilityId: "fac-1", totalReimbursement: 100 },
    ]
    await getFacilityPayorMix()
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "case_costing.payor_mix_viewed",
        entityType: "facility",
        entityId: "fac-1",
        metadata: expect.objectContaining({
          caseCount: 1,
          casesWithoutPayor: 1,
        }),
      }),
    )
  })
})
