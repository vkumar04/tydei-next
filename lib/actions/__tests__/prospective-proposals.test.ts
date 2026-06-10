/**
 * Tests for the proposal-feed split (2026-06-09):
 *
 *   - createProposal persists a draft PendingContract row (NOT a
 *     masquerade Alert) and fans out a real in-app notification.
 *   - getVendorProposals reads the real source (draft PendingContract
 *     rows) plus a tolerant legacy read of pre-split Alert rows.
 *   - deleteProposal deletes the PendingContract row, falling back to
 *     legacy alert cleanup for historic proposals.
 *   - getVendorAlerts excludes legacy masquerade rows from both the
 *     list and the hero counts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { excludeVendorProposalAlerts } from "@/lib/alerts/vendor-proposal-filter"

const mocks = vi.hoisted(() => ({
  pendingCreate: vi.fn(),
  pendingFindMany: vi.fn(),
  pendingFindFirst: vi.fn(),
  pendingDelete: vi.fn(),
  alertCreate: vi.fn(),
  alertFindMany: vi.fn(),
  alertFindFirst: vi.fn(),
  alertDelete: vi.fn(),
  alertCount: vi.fn(),
  alertGroupBy: vi.fn(),
  vendorFindUnique: vi.fn(),
  notificationCreateMany: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    pendingContract: {
      create: mocks.pendingCreate,
      findMany: mocks.pendingFindMany,
      findFirst: mocks.pendingFindFirst,
      delete: mocks.pendingDelete,
    },
    alert: {
      create: mocks.alertCreate,
      findMany: mocks.alertFindMany,
      findFirst: mocks.alertFindFirst,
      delete: mocks.alertDelete,
      count: mocks.alertCount,
      groupBy: mocks.alertGroupBy,
    },
    vendor: { findUnique: mocks.vendorFindUnique },
    notification: { createMany: mocks.notificationCreateMany },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: vi.fn(async () => ({
    vendor: { id: "vend-1", name: "Acme" },
    user: { id: "u-vendor" },
  })),
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "u-facility" },
  })),
}))

import {
  createProposal,
  deleteProposal,
  getVendorProposals,
} from "@/lib/actions/prospective"
import { getVendorAlerts } from "@/lib/actions/vendor-alerts"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pendingFindMany.mockResolvedValue([])
  mocks.alertFindMany.mockResolvedValue([])
  mocks.alertCount.mockResolvedValue(0)
  mocks.alertGroupBy.mockResolvedValue([])
  mocks.vendorFindUnique.mockResolvedValue(null)
  mocks.notificationCreateMany.mockResolvedValue({ count: 0 })
})

// Flush the fire-and-forget notification promise.
const flush = () => new Promise((r) => setTimeout(r, 0))

describe("createProposal", () => {
  const input = {
    vendorId: "vend-1",
    facilityIds: ["f-1", "f-2"],
    pricingItems: [
      { vendorItemNo: "SKU-1", proposedPrice: 100, quantity: 2 },
      { vendorItemNo: "SKU-2", proposedPrice: 50 },
    ],
    terms: { contractLength: 24, startDate: "2026-06-01" },
  }

  it("persists a draft PendingContract with the kind discriminator — no Alert write", async () => {
    mocks.pendingCreate.mockResolvedValue({
      id: "pc-1",
      submittedAt: new Date("2026-06-01T00:00:00.000Z"),
    })

    const result = await createProposal(input)

    expect(mocks.pendingCreate).toHaveBeenCalledTimes(1)
    const data = mocks.pendingCreate.mock.calls[0][0].data
    expect(data.status).toBe("draft")
    expect(data.facilityId).toBeNull()
    expect(data.vendorId).toBe("vend-1")
    expect(data.pricingData.kind).toBe("vendor_proposal")
    expect(data.pricingData.facilityIds).toEqual(["f-1", "f-2"])
    // The masquerade Alert write is GONE.
    expect(mocks.alertCreate).not.toHaveBeenCalled()

    expect(result.id).toBe("pc-1")
    expect(result.itemCount).toBe(2)
    expect(result.totalProposedCost).toBe(250) // 100*2 + 50*1
  })

  it("fans out a real in-app notification to vendor org members", async () => {
    mocks.pendingCreate.mockResolvedValue({
      id: "pc-1",
      submittedAt: new Date("2026-06-01T00:00:00.000Z"),
    })
    mocks.vendorFindUnique.mockResolvedValue({
      organization: {
        members: [{ user: { id: "u-1" } }, { user: { id: "u-2" } }],
      },
    })
    mocks.notificationCreateMany.mockResolvedValue({ count: 2 })

    await createProposal(input)
    await flush()

    expect(mocks.notificationCreateMany).toHaveBeenCalledTimes(1)
    const rows = mocks.notificationCreateMany.mock.calls[0][0].data
    expect(rows.map((r: { userId: string }) => r.userId).sort()).toEqual([
      "u-1",
      "u-2",
    ])
    expect(rows[0].type).toBe("vendor_proposal_created")
    expect(rows[0].actionUrl).toBe("/vendor/prospective")
  })
})

describe("getVendorProposals", () => {
  it("merges draft PendingContract rows with legacy alert rows, newest first", async () => {
    mocks.pendingFindMany.mockResolvedValue([
      {
        id: "pc-1",
        submittedAt: new Date("2026-06-02T00:00:00.000Z"),
        pricingData: {
          kind: "vendor_proposal",
          facilityIds: ["f-1"],
          pricingItems: [{}],
          totalCost: 500,
          terms: { contractLength: 12 },
        },
      },
    ])
    mocks.alertFindMany.mockResolvedValue([
      {
        id: "al-1",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        metadata: {
          type: "vendor_proposal",
          facilityIds: ["f-2", "f-3"],
          pricingItems: [{}, {}],
          totalCost: 900,
        },
      },
    ])

    const rows = await getVendorProposals()

    expect(rows.map((r) => r.id)).toEqual(["pc-1", "al-1"])
    expect(rows[0].totalProposedCost).toBe(500)
    expect(rows[0].contractLengthMonths).toBe(12)
    expect(rows[1].itemCount).toBe(2)
    expect(rows[1].facilityIds).toEqual(["f-2", "f-3"])

    // Real source: vendor-scoped draft rows with the discriminator.
    const pendingWhere = mocks.pendingFindMany.mock.calls[0][0].where
    expect(pendingWhere.vendorId).toBe("vend-1")
    expect(pendingWhere.status).toBe("draft")
    expect(pendingWhere.pricingData).toEqual({
      path: ["kind"],
      equals: "vendor_proposal",
    })
    // Legacy read carries the metadata discriminator (so a stray
    // compliance alert without it can never masquerade as a proposal).
    const alertWhere = mocks.alertFindMany.mock.calls[0][0].where
    expect(alertWhere.metadata).toEqual({
      path: ["type"],
      equals: "vendor_proposal",
    })
  })
})

describe("deleteProposal", () => {
  it("deletes the draft PendingContract row when present", async () => {
    mocks.pendingFindFirst.mockResolvedValue({ id: "pc-1" })

    await deleteProposal("pc-1")

    expect(mocks.pendingDelete).toHaveBeenCalledWith({ where: { id: "pc-1" } })
    expect(mocks.alertDelete).not.toHaveBeenCalled()
    // Lookup was vendor-scoped + discriminated.
    const where = mocks.pendingFindFirst.mock.calls[0][0].where
    expect(where.vendorId).toBe("vend-1")
    expect(where.status).toBe("draft")
  })

  it("falls back to legacy alert cleanup for pre-split proposals", async () => {
    mocks.pendingFindFirst.mockResolvedValue(null)
    mocks.alertFindFirst.mockResolvedValue({ id: "al-1" })

    await deleteProposal("al-1")

    expect(mocks.pendingDelete).not.toHaveBeenCalled()
    expect(mocks.alertDelete).toHaveBeenCalledWith({ where: { id: "al-1" } })
    // Legacy lookup is vendor-scoped + discriminated, so deleteProposal
    // can never delete a REAL alert by id.
    const where = mocks.alertFindFirst.mock.calls[0][0].where
    expect(where.vendorId).toBe("vend-1")
    expect(where.metadata).toEqual({
      path: ["type"],
      equals: "vendor_proposal",
    })
  })

  it("throws when neither storage has the row", async () => {
    mocks.pendingFindFirst.mockResolvedValue(null)
    mocks.alertFindFirst.mockResolvedValue(null)

    await expect(deleteProposal("nope")).rejects.toThrow("Proposal not found")
    expect(mocks.pendingDelete).not.toHaveBeenCalled()
    expect(mocks.alertDelete).not.toHaveBeenCalled()
  })
})

describe("getVendorAlerts", () => {
  it("excludes legacy masquerade proposal rows from list AND counts", async () => {
    await getVendorAlerts({})

    const listWhere = mocks.alertFindMany.mock.calls[0][0].where
    expect(listWhere.AND).toEqual(
      expect.arrayContaining([excludeVendorProposalAlerts()]),
    )
    const groupWhere = mocks.alertGroupBy.mock.calls[0][0].where
    expect(groupWhere.AND).toEqual(
      expect.arrayContaining([excludeVendorProposalAlerts()]),
    )
    const countWhere = mocks.alertCount.mock.calls[0][0].where
    expect(countWhere.AND).toEqual(
      expect.arrayContaining([excludeVendorProposalAlerts()]),
    )
  })
})
