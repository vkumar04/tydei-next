import { describe, it, expect, vi, beforeEach } from "vitest"
import { backfillCOGEnrichment } from "@/lib/actions/cog-import/backfill"

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findMany: vi.fn() },
    cOGRecord: { count: vi.fn() },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
const recomputeMock = vi.fn()
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: (...args: unknown[]) => recomputeMock(...args),
}))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))

import { prisma } from "@/lib/db"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("backfillCOGEnrichment", () => {
  it("calls recomputeMatchStatusesForVendor once per distinct vendor on facility's active contracts", async () => {
    ;(prisma.contract.findMany as any).mockResolvedValue([
      { id: "c1", vendorId: "v1" },
      { id: "c2", vendorId: "v1" },
      { id: "c3", vendorId: "v2" },
    ])
    ;(prisma.cOGRecord.count as any)
      .mockResolvedValueOnce(571) // before
      .mockResolvedValueOnce(420) // after — fewer pending
    recomputeMock.mockResolvedValue(undefined)

    const result = await backfillCOGEnrichment()

    expect(recomputeMock).toHaveBeenCalledTimes(2) // distinct vendors
    expect(recomputeMock).toHaveBeenCalledWith("v1", "fac-1")
    expect(recomputeMock).toHaveBeenCalledWith("v2", "fac-1")
    expect(result).toEqual({
      vendorsProcessed: 2,
      pendingBefore: 571,
      pendingAfter: 420,
      enriched: 151,
    })
  })

  it("returns zero counts when no active contracts exist", async () => {
    ;(prisma.contract.findMany as any).mockResolvedValue([])
    ;(prisma.cOGRecord.count as any).mockResolvedValue(0)

    const result = await backfillCOGEnrichment()
    expect(result).toEqual({
      vendorsProcessed: 0,
      pendingBefore: 0,
      pendingAfter: 0,
      enriched: 0,
    })
    expect(recomputeMock).not.toHaveBeenCalled()
  })
})
