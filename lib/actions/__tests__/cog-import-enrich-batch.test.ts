/**
 * Tests for `recomputeAllCOGEnrichments` — subsystem 3 of the COG data
 * rewrite. The action walks every distinct vendorId in the facility's
 * COG rows, calls `recomputeMatchStatusesForVendor` on each, and
 * accumulates the totals. All external deps (prisma, requireFacility,
 * logAudit, recompute helper) are mocked so the tests exercise the
 * action's own control flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type CogRow = { vendorId: string | null; facilityId: string }

let cogRows: CogRow[] = []
const recomputeMock = vi.fn(
  async (
    _db: unknown,
    input: { vendorId: string; facilityId: string },
  ): Promise<{
    total: number
    updated: number
    onContract: number
    priceVariance: number
    offContract: number
    outOfScope: number
    unknownVendor: number
  }> => {
    const matching = cogRows.filter(
      (r) => r.vendorId === input.vendorId && r.facilityId === input.facilityId,
    )
    return {
      total: matching.length,
      updated: matching.length,
      onContract: 0,
      priceVariance: 0,
      offContract: 0,
      outOfScope: 0,
      unknownVendor: 0,
    }
  },
)

const cogFindMany = vi.fn(
  async ({
    where,
  }: {
    where: { facilityId: string; vendorId?: { not: null } }
    select: unknown
  }) => {
    return cogRows
      .filter((r) => r.facilityId === where.facilityId)
      .filter((r) => (where.vendorId ? r.vendorId !== null : true))
      .map((r) => ({ vendorId: r.vendorId }))
  },
)

const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      findMany: (args: {
        where: { facilityId: string; vendorId?: { not: null } }
        select: unknown
      }) => cogFindMany(args),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  }),
}))

vi.mock("@/lib/audit", () => ({
  logAudit: (args: Record<string, unknown>) => logAuditMock(args),
}))

vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: (
    db: unknown,
    input: { vendorId: string; facilityId: string },
  ) => recomputeMock(db, input),
}))

import { recomputeAllCOGEnrichments } from "@/lib/actions/cog-import/enrich-batch"

beforeEach(() => {
  vi.clearAllMocks()
  cogRows = []
})

describe("recomputeAllCOGEnrichments", () => {
  it("iterates every distinct vendorId once and sums the updated counts", async () => {
    cogRows = [
      { vendorId: "vnd-1", facilityId: "fac-1" },
      { vendorId: "vnd-1", facilityId: "fac-1" },
      { vendorId: "vnd-2", facilityId: "fac-1" },
      { vendorId: "vnd-2", facilityId: "fac-1" },
      { vendorId: "vnd-2", facilityId: "fac-1" },
      { vendorId: "vnd-3", facilityId: "fac-1" },
    ]

    const result = await recomputeAllCOGEnrichments()

    expect(result.vendorsProcessed).toBe(3)
    expect(result.totalRecordsUpdated).toBe(6)
    expect(recomputeMock).toHaveBeenCalledTimes(3)
    const calledVendorIds = recomputeMock.mock.calls
      .map(([, input]) => input.vendorId)
      .sort()
    expect(calledVendorIds).toEqual(["vnd-1", "vnd-2", "vnd-3"])
  })

  it("skips COG rows from other facilities", async () => {
    cogRows = [
      { vendorId: "vnd-own", facilityId: "fac-1" },
      { vendorId: "vnd-other", facilityId: "fac-2" },
    ]

    const result = await recomputeAllCOGEnrichments()

    expect(result.vendorsProcessed).toBe(1)
    expect(recomputeMock).toHaveBeenCalledTimes(1)
    expect(recomputeMock).toHaveBeenCalledWith(
      expect.anything(),
      { vendorId: "vnd-own", facilityId: "fac-1" },
    )
  })

  it("returns zero when the facility has no COG rows", async () => {
    cogRows = []

    const result = await recomputeAllCOGEnrichments()

    expect(result).toEqual({
      vendorsProcessed: 0,
      totalRecordsUpdated: 0,
    })
    expect(recomputeMock).not.toHaveBeenCalled()
  })

  it("skips rows with null vendorId (caller excluded via where clause)", async () => {
    cogRows = [
      { vendorId: null, facilityId: "fac-1" },
      { vendorId: "vnd-1", facilityId: "fac-1" },
    ]

    const result = await recomputeAllCOGEnrichments()

    expect(result.vendorsProcessed).toBe(1)
    expect(recomputeMock).toHaveBeenCalledTimes(1)
    expect(recomputeMock.mock.calls[0]?.[1]).toEqual({
      vendorId: "vnd-1",
      facilityId: "fac-1",
    })
  })

  it("swallows per-vendor recompute errors and continues with the remaining vendors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    cogRows = [
      { vendorId: "vnd-fail", facilityId: "fac-1" },
      { vendorId: "vnd-ok", facilityId: "fac-1" },
    ]
    recomputeMock.mockImplementationOnce(async () => {
      throw new Error("recompute boom")
    })

    const result = await recomputeAllCOGEnrichments()

    // The failing vendor didn't count; the surviving one did.
    expect(result.vendorsProcessed).toBe(1)
    expect(result.totalRecordsUpdated).toBe(1)
    expect(recomputeMock).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("always logs a `cog.all_enrichments_recomputed` audit entry with the totals", async () => {
    cogRows = [
      { vendorId: "vnd-1", facilityId: "fac-1" },
      { vendorId: "vnd-2", facilityId: "fac-1" },
    ]

    const result = await recomputeAllCOGEnrichments()

    expect(logAuditMock).toHaveBeenCalledTimes(1)
    const auditArgs = logAuditMock.mock.calls[0]?.[0] as unknown
    const audit = auditArgs as {
      userId: string
      action: string
      entityType: string
      metadata: { vendorsProcessed: number; totalRecordsUpdated: number }
    }
    expect(audit.userId).toBe("user-1")
    expect(audit.action).toBe("cog.all_enrichments_recomputed")
    expect(audit.entityType).toBe("cogRecord")
    expect(audit.metadata.vendorsProcessed).toBe(result.vendorsProcessed)
    expect(audit.metadata.totalRecordsUpdated).toBe(result.totalRecordsUpdated)
  })
})
