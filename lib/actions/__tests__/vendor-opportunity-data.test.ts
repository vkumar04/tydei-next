import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Charles round-3 (2026-07-04) — mode-gate coverage for
 * `getVendorOpportunityData` (lib/actions/vendor-opportunity-data.ts).
 *
 * The addressable-market / competitor block reads facility COG across ALL
 * vendors — that is FACILITY-side data, so it flows only for facilities with
 * an accepted `mode: "two_way"` Connection (the one mode gate, mirroring
 * `getFacilityActualsForVendor`). Charles: "Where is it getting the
 * competitive threat from? I entered usage from one company only. Is it in
 * 2 way mode for some things?"
 *
 * The vendor's OWN sales rows (COGRecord where vendorId = self) are the
 * vendor's own data and are read regardless of mode.
 */

const {
  cogFindManyMock,
  contractFindManyMock,
  rebateFindManyMock,
  benchmarkFindManyMock,
  connectionFindManyMock,
} = vi.hoisted(() => ({
  cogFindManyMock: vi.fn(),
  contractFindManyMock: vi.fn(),
  rebateFindManyMock: vi.fn(),
  benchmarkFindManyMock: vi.fn(),
  connectionFindManyMock: vi.fn(),
}))

const { requireVendorMock } = vi.hoisted(() => ({
  requireVendorMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: { findMany: cogFindManyMock },
    contract: { findMany: contractFindManyMock },
    rebate: { findMany: rebateFindManyMock },
    productBenchmark: { findMany: benchmarkFindManyMock },
    connection: { findMany: connectionFindManyMock },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: requireVendorMock,
}))

// Enterprise caller (divisionIds undefined) → divisionCategoryKeySet returns
// null without touching prisma, so the real category-scope module is used.
vi.mock("@/lib/actions/division-auth", () => ({
  callerVendorDivisionIds: vi.fn().mockResolvedValue(undefined),
  divisionScopeWhere: vi.fn().mockResolvedValue({}),
}))

import { getVendorOpportunityData } from "@/lib/actions/vendor-opportunity-data"

/** The vendor's own trailing-12mo sales rows at facility fac-1. */
const OWN_ROWS = [
  {
    extendedPrice: 1000,
    quantity: 10,
    category: "Joint Replacement",
    facilityId: "fac-1",
  },
  {
    extendedPrice: 500,
    quantity: 5,
    category: "Joint Replacement",
    facilityId: "fac-1",
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  requireVendorMock.mockResolvedValue({
    vendor: { id: "vendor-1" },
    user: { id: "user-1" },
  })
  contractFindManyMock.mockResolvedValue([])
  rebateFindManyMock.mockResolvedValue([])
  benchmarkFindManyMock.mockResolvedValue([])
})

describe("getVendorOpportunityData — two-way mode gate on the market/competitor block", () => {
  it("one-way only: keeps the vendor's OWN rows but never runs the all-vendor market query", async () => {
    cogFindManyMock.mockResolvedValue(OWN_ROWS)
    // No accepted two_way connections → the facility-side market/competitor
    // read is gated off entirely.
    connectionFindManyMock.mockResolvedValue([])

    const res = await getVendorOpportunityData()

    // Own-data figures still computed (the vendor's own sales are its data).
    expect(res.currentRevenue).toBe(1500)
    expect(res.currentAsp).toBe(100)
    expect(res.hasData).toBe(true)

    // Facility-derived pieces are absent — no fabricated competitor, and
    // addressable falls back exactly as when hasData is false for them.
    expect(res.competitiveThreat).toBeNull()
    expect(res.topCompetitorSharePct).toBeNull()
    expect(res.addressableSpend).toBe(0)
    expect(res.currentShare).toBe(0)

    // EXACTLY ONE COGRecord read: the vendor-scoped own-rows query. The
    // all-vendor market query (no vendorId in its where) never ran.
    expect(cogFindManyMock).toHaveBeenCalledTimes(1)
    expect(cogFindManyMock.mock.calls[0][0].where.vendorId).toBe("vendor-1")
  })

  it("gates the connection lookup on accepted+two_way for the caller's own vendor and facilities", async () => {
    cogFindManyMock.mockResolvedValue(OWN_ROWS)
    connectionFindManyMock.mockResolvedValue([])

    await getVendorOpportunityData()

    expect(connectionFindManyMock.mock.calls[0][0].where).toEqual({
      vendorId: "vendor-1",
      status: "accepted",
      mode: "two_way",
      facilityId: { in: ["fac-1"] },
    })
  })

  it("two-way path unchanged: market query runs on the two-way facilities only and derives the real competitor", async () => {
    // First COG read = own rows; second = the all-vendor market rows.
    cogFindManyMock
      .mockResolvedValueOnce(OWN_ROWS)
      .mockResolvedValueOnce([
        // The caller's own spend counts toward addressable, not competitors.
        {
          extendedPrice: 1500,
          category: "Joint Replacement",
          vendorId: "vendor-1",
          vendor: { name: "Us", displayName: null },
        },
        {
          extendedPrice: 4500,
          category: "Joint replacement", // canonical-match drift on purpose
          vendorId: "vendor-2",
          vendor: { name: "Smith & Nephew", displayName: null },
        },
        // Different category → excluded from the addressable market.
        {
          extendedPrice: 99_999,
          category: "Spine",
          vendorId: "vendor-3",
          vendor: { name: "Other", displayName: null },
        },
      ])
    connectionFindManyMock.mockResolvedValue([{ facilityId: "fac-1" }])

    const res = await getVendorOpportunityData()

    // Market query scoped to the two-way facility set — and to ALL vendors
    // there (no vendorId), which is exactly what the grant permits.
    const marketWhere = cogFindManyMock.mock.calls[1][0].where
    expect(marketWhere.facilityId).toEqual({ in: ["fac-1"] })
    expect(marketWhere.vendorId).toBeUndefined()

    expect(res.addressableSpend).toBe(6000)
    expect(res.currentShare).toBe(0.25) // 1500 ÷ 6000
    expect(res.competitiveThreat).toBe("Smith & Nephew")
    expect(res.topCompetitorSharePct).toBe(0.75) // 4500 ÷ 6000
  })

  it("returns null competitor fields (not 0 / a placeholder) when two-way market rows name no competitor", async () => {
    cogFindManyMock
      .mockResolvedValueOnce(OWN_ROWS)
      // Market read returns only the caller's own rows — no competitor.
      .mockResolvedValueOnce([
        {
          extendedPrice: 1500,
          category: "Joint Replacement",
          vendorId: "vendor-1",
          vendor: { name: "Us", displayName: null },
        },
      ])
    connectionFindManyMock.mockResolvedValue([{ facilityId: "fac-1" }])

    const res = await getVendorOpportunityData()

    expect(res.competitiveThreat).toBeNull()
    expect(res.topCompetitorSharePct).toBeNull()
    expect(res.addressableSpend).toBe(1500)
  })

  it("skips even the connection lookup when the vendor has no sales (nothing to gate)", async () => {
    cogFindManyMock.mockResolvedValue([])

    const res = await getVendorOpportunityData()

    expect(res.hasData).toBe(false)
    expect(res.competitiveThreat).toBeNull()
    expect(res.topCompetitorSharePct).toBeNull()
    expect(connectionFindManyMock).not.toHaveBeenCalled()
    expect(cogFindManyMock).toHaveBeenCalledTimes(1)
  })
})
