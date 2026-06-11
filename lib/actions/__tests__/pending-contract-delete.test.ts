/**
 * deletePendingContract (bugs.rtfd 2026-06-11 B2).
 *
 * Vendors couldn't remove a submitted / rejected / revision-requested
 * submission from "My Contracts". The action must:
 *  - delete non-approved submissions owned by the calling vendor
 *  - REFUSE approved submissions (they back a real, possibly active,
 *    Contract row — active contracts are NEVER deletable)
 *  - REFUSE another vendor's submission (requireVendor scoping: the
 *    lookup is id + vendorId, so a foreign id is simply not found)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  pendingFindFirstMock,
  pendingDeleteMock,
  requireVendorMock,
  logAuditMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  pendingFindFirstMock: vi.fn(),
  pendingDeleteMock: vi.fn(),
  requireVendorMock: vi.fn(),
  logAuditMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    pendingContract: {
      findFirst: pendingFindFirstMock,
      delete: pendingDeleteMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: requireVendorMock,
  requireFacility: vi.fn(),
}))

vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }))
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: vi.fn(),
}))
vi.mock("@/lib/actions/notifications", () => ({
  notifyFacilityOfPendingContract: vi.fn(),
  notifyVendorOfPendingDecision: vi.fn(),
}))

import { deletePendingContract } from "@/lib/actions/pending-contracts"

describe("deletePendingContract (bugs.rtfd 2026-06-11 B2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireVendorMock.mockResolvedValue({
      vendor: { id: "ven-1" },
      user: { id: "user-1" },
    })
    pendingDeleteMock.mockResolvedValue({ id: "pend-1" })
  })

  it("deletes a rejected submission owned by the vendor", async () => {
    pendingFindFirstMock.mockResolvedValue({
      status: "rejected",
      contractName: "Ortho Rebate FY26",
    })

    await deletePendingContract("pend-1")

    // Scoped lookup: id AND the session vendor's id, never trust the client.
    expect(pendingFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "pend-1", vendorId: "ven-1" }),
      }),
    )
    expect(pendingDeleteMock).toHaveBeenCalledWith({
      where: { id: "pend-1", vendorId: "ven-1" },
    })
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "pending_contract.deleted",
        entityId: "pend-1",
      }),
    )
    expect(revalidatePathMock).toHaveBeenCalledWith("/vendor/contracts")
  })

  it.each(["submitted", "revision_requested"] as const)(
    "deletes a %s submission",
    async (status) => {
      pendingFindFirstMock.mockResolvedValue({
        status,
        contractName: "Spine Carve-out",
      })

      await deletePendingContract("pend-2")

      expect(pendingDeleteMock).toHaveBeenCalledWith({
        where: { id: "pend-2", vendorId: "ven-1" },
      })
    },
  )

  it("REFUSES an approved submission (status guard — active contracts are never deletable)", async () => {
    pendingFindFirstMock.mockResolvedValue({
      status: "approved",
      contractName: "Approved Deal",
    })

    await expect(deletePendingContract("pend-3")).rejects.toThrow(
      /approved/i,
    )
    expect(pendingDeleteMock).not.toHaveBeenCalled()
    expect(logAuditMock).not.toHaveBeenCalled()
  })

  it("REFUSES another vendor's submission (vendor-scoped lookup finds nothing)", async () => {
    // The where clause includes vendorId: ven-1, so a row owned by ven-2
    // is simply not found.
    pendingFindFirstMock.mockResolvedValue(null)

    await expect(deletePendingContract("pend-foreign")).rejects.toThrow(
      /not found/i,
    )
    expect(pendingDeleteMock).not.toHaveBeenCalled()
  })
})
