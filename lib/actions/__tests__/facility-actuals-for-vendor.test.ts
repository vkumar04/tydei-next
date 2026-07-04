import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Wave-2 (2026-07-03 prospective-structural-six) coverage for
 * `lib/actions/vendor-prospective.ts`:
 *
 *  E — `getFacilityActualsForVendor` (two-way sync auto-pull):
 *   - two_way gate: data flows ONLY over an accepted `mode: "two_way"`
 *     Connection row (the ONE mode gate in the codebase);
 *     anything else → bare `{ mode: "one_way" }` with NO COG reads.
 *   - tenant/IDOR: an unrelated facility throws (vendorRelatedFacilityWhere).
 *   - SKU matching goes through `normalizeSku` on BOTH sides (case +
 *     whitespace drift folds; meaningful separators preserved).
 *   - share denominator = facility spend in the VENDOR'S canonical
 *     categories (getVendorCOGPatterns post-#129 mirror).
 *
 *  D — consolidation round-trip: `runAnalysis`'s persist block writes
 *   `dealAssumptions` in UI units (WHOLE percents — 0.4 → 40), zod-validated.
 */

const {
  facilityFindFirstMock,
  connectionFindFirstMock,
  cogFindManyMock,
  cogGroupByMock,
  cogAggregateMock,
  pendingFindFirstMock,
  pendingUpdateMock,
  benchmarkFindManyMock,
  caseFindManyMock,
  payorContractFindManyMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  connectionFindFirstMock: vi.fn(),
  cogFindManyMock: vi.fn(),
  cogGroupByMock: vi.fn(),
  cogAggregateMock: vi.fn(),
  pendingFindFirstMock: vi.fn(),
  pendingUpdateMock: vi.fn(),
  benchmarkFindManyMock: vi.fn(),
  caseFindManyMock: vi.fn(),
  payorContractFindManyMock: vi.fn(),
}))

const { requireVendorMock, requireCanMutateMock } = vi.hoisted(() => ({
  requireVendorMock: vi.fn(),
  requireCanMutateMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    facility: { findFirst: facilityFindFirstMock },
    connection: { findFirst: connectionFindFirstMock },
    cOGRecord: {
      findMany: cogFindManyMock,
      groupBy: cogGroupByMock,
      aggregate: cogAggregateMock,
    },
    pendingContract: {
      findFirst: pendingFindFirstMock,
      update: pendingUpdateMock,
    },
    productBenchmark: { findMany: benchmarkFindManyMock },
    case: { findMany: caseFindManyMock },
    payorContract: { findMany: payorContractFindManyMock },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: requireVendorMock,
}))

vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: requireCanMutateMock,
}))

// Enterprise caller (divisionIds undefined) → divisionCategoryKeySet returns
// null without touching prisma, so the real category-scope module is used.
vi.mock("@/lib/actions/division-auth", () => ({
  callerVendorDivisionIds: vi.fn().mockResolvedValue(undefined),
  divisionScopeWhere: vi.fn().mockResolvedValue({}),
}))

import {
  getFacilityActualsForVendor,
  getFacilityCurrentStateForVendor,
  getVendorProspectiveAnalysis,
} from "@/lib/actions/vendor-prospective"

beforeEach(() => {
  vi.clearAllMocks()
  requireVendorMock.mockResolvedValue({
    vendor: { id: "vendor-1" },
    user: { id: "user-1" },
  })
  requireCanMutateMock.mockResolvedValue(undefined)
})

describe("getFacilityActualsForVendor — two-way sync auto-pull (Wave-2 E)", () => {
  it("returns items + share + categorySpend over an accepted two_way connection", async () => {
    facilityFindFirstMock.mockResolvedValue({ id: "fac-1" })
    connectionFindFirstMock.mockResolvedValue({ id: "conn-1" })
    cogFindManyMock.mockResolvedValue([
      // Same SKU with case + whitespace drift → both fold to "stk123".
      {
        vendorItemNo: "STK 123",
        extendedPrice: 1000,
        quantity: 10,
        category: "Joint replacement",
      },
      {
        vendorItemNo: "stk123",
        extendedPrice: 500,
        quantity: 5,
        category: "Joint Replacement",
      },
      // Requested but qty 0 → excluded from items (qty>0 guard), still
      // counts toward vendor spend + categories.
      {
        vendorItemNo: "OTHER-9",
        extendedPrice: 250,
        quantity: 0,
        category: "Trauma",
      },
    ])
    cogGroupByMock.mockResolvedValue([
      { category: "Joint Replacement", _sum: { extendedPrice: 5000 } },
      { category: "Trauma", _sum: { extendedPrice: 2000 } },
      // NOT one of the vendor's categories → excluded from the denominator.
      { category: "Spine", _sum: { extendedPrice: 99999 } },
    ])

    const res = await getFacilityActualsForVendor("fac-1", [
      "STK123",
      "OTHER-9",
    ])

    expect(res.mode).toBe("two_way")
    if (res.mode !== "two_way") throw new Error("unreachable")
    // Both drifted rows aggregate under the one normalizeSku key:
    // (1000 + 500) ÷ (10 + 5) = $100 avg; qty-0 row dropped.
    expect(res.items).toEqual([
      { sku: "stk123", avgUnitPrice: 100, annualQty: 15 },
    ])
    // Denominator = facility spend in the vendor's canonical categories
    // (Joint Replacement 5000 + Trauma 2000 — Spine excluded) = 7000;
    // share = 1750 ÷ 7000 = 25.0% (whole percent, UI units).
    expect(res.categorySpend).toBe(7000)
    expect(res.currentSharePct).toBe(25)
  })

  it("gates on status:accepted AND mode:two_way for the caller's own vendor", async () => {
    facilityFindFirstMock.mockResolvedValue({ id: "fac-1" })
    connectionFindFirstMock.mockResolvedValue({ id: "conn-1" })
    cogFindManyMock.mockResolvedValue([])
    cogGroupByMock.mockResolvedValue([])

    await getFacilityActualsForVendor("fac-1", [])

    const where = connectionFindFirstMock.mock.calls[0][0].where as Record<
      string,
      unknown
    >
    expect(where).toEqual({
      facilityId: "fac-1",
      vendorId: "vendor-1",
      status: "accepted",
      mode: "two_way",
    })
  })

  it("returns the bare one_way shape (no COG reads) when no two-way connection exists", async () => {
    facilityFindFirstMock.mockResolvedValue({ id: "fac-1" })
    // No accepted two_way row — covers no-connection, pending/declined, and
    // mode one_way alike (all filtered by the gated where). Also the
    // standalone-vendor case: Vendor.defaultMode never substitutes for a
    // real accepted two_way Connection row.
    connectionFindFirstMock.mockResolvedValue(null)

    const res = await getFacilityActualsForVendor("fac-1", ["STK123"])

    expect(res).toEqual({ mode: "one_way" })
    expect(cogFindManyMock).not.toHaveBeenCalled()
    expect(cogGroupByMock).not.toHaveBeenCalled()
  })

  it("throws for a facility without a vendor relationship (IDOR) before any connection read", async () => {
    facilityFindFirstMock.mockResolvedValue(null)

    await expect(
      getFacilityActualsForVendor("fac-foreign", ["STK123"]),
    ).rejects.toThrow(/not related to your organization/)

    expect(connectionFindFirstMock).not.toHaveBeenCalled()
    expect(cogFindManyMock).not.toHaveBeenCalled()
  })

  it("matches SKUs via normalizeSku — folds case/whitespace, preserves separators", async () => {
    facilityFindFirstMock.mockResolvedValue({ id: "fac-1" })
    connectionFindFirstMock.mockResolvedValue({ id: "conn-1" })
    cogFindManyMock.mockResolvedValue([
      // " ab - 12 " folds to "ab-12" → matches requested "AB-12".
      {
        vendorItemNo: " AB - 12 ",
        extendedPrice: 300,
        quantity: 3,
        category: "Trauma",
      },
      // "AB1-2" is a DIFFERENT catalog number (separator position matters —
      // normalizeSku is conservative on purpose) → must NOT match.
      {
        vendorItemNo: "AB1-2",
        extendedPrice: 900,
        quantity: 9,
        category: "Trauma",
      },
    ])
    cogGroupByMock.mockResolvedValue([
      { category: "Trauma", _sum: { extendedPrice: 2400 } },
    ])

    const res = await getFacilityActualsForVendor("fac-1", ["AB-12"])

    if (res.mode !== "two_way") throw new Error("expected two_way")
    expect(res.items).toEqual([
      { sku: "ab-12", avgUnitPrice: 100, annualQty: 3 },
    ])
    // Share numerator still counts ALL vendor rows (1200 ÷ 2400 = 50%).
    expect(res.currentSharePct).toBe(50)
  })
})

describe("getFacilityCurrentStateForVendor — mode gate (Charles round-3)", () => {
  it("returns the zeroed one_way variant with NO facility reads when no two-way connection exists", async () => {
    facilityFindFirstMock.mockResolvedValue({
      id: "fac-1",
      name: "Lighthouse Surgical Center",
    })
    // No accepted two_way row — covers no-connection, pending/declined, and
    // mode one_way alike. Vendor.defaultMode never substitutes (same rule as
    // the actuals gate).
    connectionFindFirstMock.mockResolvedValue(null)

    const res = await getFacilityCurrentStateForVendor("fac-1")

    expect(res).toEqual({
      facilityId: "fac-1",
      facilityName: "Lighthouse Surgical Center",
      mode: "one_way",
      currentVendorSpend: 0,
      annualCaseVolume: 0,
      measuredReimbursement: 0,
      reimbursementCoverage: { withRate: 0, totalCases: 0 },
      hasData: false,
    })
    // The facility's COG / case-costing / payor data was never touched.
    expect(cogFindManyMock).not.toHaveBeenCalled()
    expect(caseFindManyMock).not.toHaveBeenCalled()
    expect(payorContractFindManyMock).not.toHaveBeenCalled()
  })

  it("gates on the exact accepted+two_way where for the caller's own vendor", async () => {
    facilityFindFirstMock.mockResolvedValue({ id: "fac-1", name: "F" })
    connectionFindFirstMock.mockResolvedValue(null)

    await getFacilityCurrentStateForVendor("fac-1")

    expect(connectionFindFirstMock.mock.calls[0][0].where).toEqual({
      facilityId: "fac-1",
      vendorId: "vendor-1",
      status: "accepted",
      mode: "two_way",
    })
  })

  it("returns the facility actuals (mode two_way) over an accepted two_way connection — path unchanged", async () => {
    facilityFindFirstMock.mockResolvedValue({
      id: "fac-1",
      name: "Lighthouse Surgical Center",
    })
    connectionFindFirstMock.mockResolvedValue({ id: "conn-1" })
    cogFindManyMock.mockResolvedValue([
      { extendedPrice: 1000 },
      { extendedPrice: 500 },
    ])
    caseFindManyMock.mockResolvedValue([
      {
        totalReimbursement: 12_000,
        primaryCptCode: "27447",
        dateOfSurgery: new Date("2025-06-01"),
        procedures: [],
      },
      {
        totalReimbursement: 0,
        primaryCptCode: "27447",
        dateOfSurgery: new Date("2025-09-01"),
        procedures: [],
      },
    ])
    payorContractFindManyMock.mockResolvedValue([])

    const res = await getFacilityCurrentStateForVendor("fac-1")

    expect(res.mode).toBe("two_way")
    expect(res.currentVendorSpend).toBe(1500)
    // 2 cases spanning <1yr → span clamps to 1 → annualized count = 2.
    expect(res.annualCaseVolume).toBe(2)
    // Stored reimbursement passes through; the $0 case has no payor CPT rate.
    expect(res.measuredReimbursement).toBe(12_000)
    expect(res.reimbursementCoverage).toEqual({ withRate: 1, totalCases: 2 })
    expect(res.hasData).toBe(true)
  })

  it("throws for an unrelated facility (IDOR) before the connection read", async () => {
    facilityFindFirstMock.mockResolvedValue(null)

    await expect(
      getFacilityCurrentStateForVendor("fac-foreign"),
    ).rejects.toThrow(/not related to your organization/)
    expect(connectionFindFirstMock).not.toHaveBeenCalled()
  })
})

describe("runAnalysis persist block — dealAssumptions round-trip (Wave-2 D)", () => {
  it("persists every Step-1 assumption in UI units (whole percents) alongside the score", async () => {
    facilityFindFirstMock.mockResolvedValue({
      id: "fac-1",
      name: "Lighthouse Surgical Center",
      type: "asc",
    })
    pendingFindFirstMock.mockResolvedValue({
      id: "prop-1",
      pricingData: { kind: "vendor_proposal" },
    })
    benchmarkFindManyMock.mockResolvedValue([])
    pendingUpdateMock.mockResolvedValue({})

    await getVendorProspectiveAnalysis({
      facilityId: "fac-1",
      contractVariant: "CAPITAL_TIE_IN",
      pricingScenarios: [
        {
          scenarioName: "Target",
          unitPrice: 100,
          estimatedAnnualVolume: 100,
          rebatePercent: 2,
        },
      ],
      // Analyzer-input FRACTIONS — must persist as whole percents.
      targetGrossMarginPercent: 0.4,
      minimumAcceptableGrossMarginPercent: 0.25,
      internalUnitCost: 55,
      facilityEstimatedAnnualSpend: 500_000,
      facilityCurrentVendorShare: 0.2,
      targetVendorShare: 0.5,
      capitalDetails: {
        equipmentCost: 200_000,
        annualMaintenanceCost: 5_000,
        termMonths: 60,
        interestRate: 0.05,
        discountRate: 0.1,
      },
      constructs: [],
      currentAnnualSpend: 1_000,
      proposalRowId: "prop-1",
    })

    expect(pendingUpdateMock).toHaveBeenCalledOnce()
    const data = pendingUpdateMock.mock.calls[0][0].data as {
      pricingData: Record<string, unknown>
    }
    expect(data.pricingData.dealAssumptions).toEqual({
      targetMarginPct: 40,
      floorMarginPct: 25,
      currentSharePct: 20,
      estimatedSpend: 500_000,
      estimatedSpendCategory: null,
      internalUnitCost: 55,
      contractVariant: "CAPITAL_TIE_IN",
      capital: {
        equipmentCost: 200_000,
        annualMaintenanceCost: 5_000,
        termMonths: 60,
        interestRatePct: 5,
        discountRatePct: 10,
      },
    })
    // The pre-existing persist fields are untouched by the addition.
    expect(data.pricingData.dealFacilityId).toBe("fac-1")
    expect(data.pricingData.dealTargetSharePct).toBe(50)
  })
})
