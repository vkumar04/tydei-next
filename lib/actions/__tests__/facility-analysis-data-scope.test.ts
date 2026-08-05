import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Analysis data scope — date window + category filter (2026-08-05).
 *
 * The Current State dashboard's vendor-spend figure is scoped by a date range
 * and an optional category selection. Pins:
 *   - default window annualizes to exactly the raw total (12-month snap)
 *   - a custom window's months/avg/annualized math
 *   - the category filter drops out-of-selection rows from every total while
 *     `availableCategories` still lists everything in the window
 *   - category matching is canonicalized, never raw equality
 */

const { cogFindManyMock, caseFindManyMock, payorFindManyMock } = vi.hoisted(
  () => ({
    cogFindManyMock: vi.fn(),
    caseFindManyMock: vi.fn(),
    payorFindManyMock: vi.fn(),
  }),
)

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: { findMany: cogFindManyMock },
    case: { findMany: caseFindManyMock },
    payorContract: { findMany: payorFindManyMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({ facility: { id: "fac-1" } }),
}))

import { getFacilityAnalysisData } from "@/lib/actions/facility-analysis-data"

function cogRow(over: {
  category?: string | null
  extendedPrice: number
  quantity?: number
  vendorId?: string
  vendorName?: string
}) {
  return {
    category: over.category ?? null,
    quantity: over.quantity ?? 1,
    extendedPrice: over.extendedPrice,
    vendorId: over.vendorId ?? null,
    vendor: over.vendorId
      ? { name: over.vendorName ?? "V", displayName: null }
      : null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  caseFindManyMock.mockResolvedValue([])
  payorFindManyMock.mockResolvedValue([])
  cogFindManyMock.mockResolvedValue([
    cogRow({ category: "Spine", extendedPrice: 600, quantity: 2, vendorId: "v1", vendorName: "Alpha" }),
    cogRow({ category: "spine", extendedPrice: 400, quantity: 1, vendorId: "v1", vendorName: "Alpha" }),
    cogRow({ category: "Trauma", extendedPrice: 300, quantity: 3, vendorId: "v2", vendorName: "Beta" }),
    cogRow({ category: null, extendedPrice: 100 }),
  ])
})

describe("getFacilityAnalysisData — scope", () => {
  it("default window: annualized equals the raw total exactly", async () => {
    const d = await getFacilityAnalysisData()
    expect(d.currentVendorSpend).toBe(1400)
    expect(d.windowMonths).toBe(12)
    expect(d.annualizedVendorSpend).toBe(1400)
    expect(d.avgMonthlySpend).toBeCloseTo(1400 / 12, 6)
  })

  it("custom window: months come from the span, annualized = avg × 12", async () => {
    const d = await getFacilityAnalysisData({
      start: "2026-05-05T00:00:00.000Z",
      end: "2026-08-05T00:00:00.000Z",
    })
    // ~3 months of span.
    expect(d.windowMonths).toBeGreaterThan(2.9)
    expect(d.windowMonths).toBeLessThan(3.1)
    expect(d.annualizedVendorSpend).toBeCloseTo(d.avgMonthlySpend * 12, 6)
    // The window is passed through to the COG query.
    const where = cogFindManyMock.mock.calls[0][0].where
    expect(where.transactionDate.gte.toISOString()).toBe(
      "2026-05-05T00:00:00.000Z",
    )
    expect(where.transactionDate.lte.toISOString()).toBe(
      "2026-08-05T00:00:00.000Z",
    )
  })

  it("rejects an inverted window", async () => {
    await expect(
      getFacilityAnalysisData({ start: "2026-08-05", end: "2026-05-05" }),
    ).rejects.toThrow(/start must be before/)
  })

  it("category filter scopes every total, canonicalized on both sides", async () => {
    const d = await getFacilityAnalysisData({ categories: ["SPINE"] })
    // Both spellings of spine count; trauma and uncategorized do not.
    expect(d.currentVendorSpend).toBe(1000)
    expect(d.categories).toHaveLength(1)
    expect(d.categories[0].spendShare).toBe(1)
    // Vendor breakdown follows the same subset (Beta only sold trauma).
    expect(d.vendors).toHaveLength(1)
    expect(d.vendors[0].vendor).toBe("Alpha")
    // The picker still sees everything in the window.
    expect(d.availableCategories.length).toBe(2)
  })

  it("no filter: uncategorized spend still counts toward the total", async () => {
    const d = await getFacilityAnalysisData()
    expect(d.currentVendorSpend).toBe(1400)
    expect(d.availableCategories.length).toBe(2)
  })

  it("revenue gate compares against ANNUALIZED UNFILTERED spend, not the scoped slice", async () => {
    // Lifetime measured reimbursement $2,000: more than a 3-month window's
    // $1,400 of spend, but far less than the ~$5,600 annualized run rate —
    // still implausibly low, so revenue must stay IMPLIED. Pre-fix this
    // flipped to "actuals" and rendered spend > revenue (review 2026-08-05).
    caseFindManyMock.mockResolvedValue([
      {
        totalSpend: 500,
        totalReimbursement: 2000,
        primaryCptCode: null,
        dateOfSurgery: new Date("2026-06-01"),
        procedures: [],
      },
    ])
    const d = await getFacilityAnalysisData({
      start: "2026-05-05T00:00:00.000Z",
      end: "2026-08-05T00:00:00.000Z",
    })
    expect(d.revenueIsImplied).toBe(true)
    // The implied proxy is annual too: annualized-unfiltered spend ÷ 0.3.
    const annualizedUnfiltered = (1400 / d.windowMonths) * 12
    expect(d.netRevenue).toBeCloseTo(annualizedUnfiltered / 0.3, 6)
    expect(d.netRevenue).toBeGreaterThan(d.annualizedVendorSpend)
  })

  it("category filter never redefines the facility top line", async () => {
    caseFindManyMock.mockResolvedValue([
      {
        totalSpend: 500,
        totalReimbursement: 1200,
        primaryCptCode: null,
        dateOfSurgery: new Date("2026-06-01"),
        procedures: [],
      },
    ])
    // Reimbursement $1,200 > trauma-only spend $300, but < the facility's
    // unfiltered $1,400 — the gate must not flip just because the user
    // narrowed the category selection.
    const d = await getFacilityAnalysisData({ categories: ["Trauma"] })
    expect(d.currentVendorSpend).toBe(300)
    expect(d.revenueIsImplied).toBe(true)
    expect(d.netRevenue).toBeCloseTo(1400 / 0.3, 6)
  })
})
