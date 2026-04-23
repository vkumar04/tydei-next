import { describe, it, expect, vi, beforeEach } from "vitest"

// W2.A.1 H-G — createCOGRecord single-row insert must invoke
// recomputeMatchStatusesForVendor for the inserted row's vendor +
// facility. Without it, every manually-added row sits at
// matchStatus=pending until a separate import/backfill runs, which
// defeats the whole point of inline manual entry.

const { createMock, recomputeMock, logAuditMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  recomputeMock: vi.fn(),
  logAuditMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      create: createMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: (...args: unknown[]) => recomputeMock(...args),
}))

vi.mock("@/lib/audit", () => ({
  logAudit: logAuditMock,
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(v: T) => v,
}))

import { createCOGRecord } from "@/lib/actions/cog-records"

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({
    id: "cog-1",
    facilityId: "fac-1",
    vendorId: "v-arthrex",
    matchStatus: "pending",
  })
  recomputeMock.mockResolvedValue({
    total: 1,
    updated: 1,
    onContract: 1,
    priceVariance: 0,
    offContract: 0,
    outOfScope: 0,
    unknownVendor: 0,
  })
})

describe("createCOGRecord — post-insert recompute (W2.A.1 H-G)", () => {
  it("invokes recomputeMatchStatusesForVendor for the inserted row's (vendorId, facilityId)", async () => {
    await createCOGRecord({
      facilityId: "fac-1",
      vendorId: "v-arthrex",
      vendorName: "Arthrex",
      inventoryNumber: "INV-TEST",
      inventoryDescription: "FiberWire #2 Suture Pack",
      vendorItemNo: "ART-FW2-001",
      poNumber: "PO-2026-00001",
      unitCost: 85,
      extendedPrice: 850,
      quantity: 10,
      transactionDate: "2026-04-01",
      category: "Arthroscopy",
    })

    expect(recomputeMock).toHaveBeenCalledTimes(1)
    const [, arg] = recomputeMock.mock.calls[0] as [
      unknown,
      { vendorId: string; facilityId: string },
    ]
    expect(arg.vendorId).toBe("v-arthrex")
    expect(arg.facilityId).toBe("fac-1")
  })

  it("does not invoke recompute when vendorId is missing (no vendor → nothing to recompute)", async () => {
    createMock.mockResolvedValueOnce({
      id: "cog-no-vendor",
      facilityId: "fac-1",
      vendorId: null,
      matchStatus: "pending",
    })
    await createCOGRecord({
      facilityId: "fac-1",
      vendorName: "Unknown",
      inventoryNumber: "INV-TEST",
      inventoryDescription: "Misc",
      unitCost: 10,
      extendedPrice: 10,
      quantity: 1,
      transactionDate: "2026-04-01",
    })
    expect(recomputeMock).not.toHaveBeenCalled()
  })
})
