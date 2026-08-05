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
import { UNCATEGORIZED_CATEGORY } from "@/lib/contracts/category-canonical"

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
    // The picker still sees everything in the window, incl. the bucket.
    expect(d.availableCategories.length).toBe(3)
  })

  it("no filter: uncategorized spend joins the '(uncategorized)' bucket", async () => {
    const d = await getFacilityAnalysisData()
    expect(d.currentVendorSpend).toBe(1400)
    expect(d.availableCategories).toContain(UNCATEGORIZED_CATEGORY)
    const bucket = d.categories.find((c) => c.category === UNCATEGORIZED_CATEGORY)
    expect(bucket?.spendShare).toBeCloseTo(100 / 1400, 6)
    // Shares reconcile to the headline: they sum to exactly 1.
    const shareSum = d.categories.reduce((s2, c) => s2 + c.spendShare, 0)
    expect(shareSum).toBeCloseTo(1, 6)
  })

  it("categories that canonicalize to nothing join the bucket, never a blank '' row", async () => {
    cogFindManyMock.mockResolvedValue([
      cogRow({ category: "Spine", extendedPrice: 600 }),
      cogRow({ category: "-", extendedPrice: 50 }),
      cogRow({ category: "The", extendedPrice: 25 }),
      cogRow({ category: null, extendedPrice: 100 }),
    ])
    const d = await getFacilityAnalysisData()
    expect(d.availableCategories).not.toContain("")
    const bucket = d.categories.find(
      (c) => c.category === UNCATEGORIZED_CATEGORY,
    )
    expect(bucket?.spendShare).toBeCloseTo(175 / 775, 6)
  })

  it("real cases never annualize down to zero on long windows", async () => {
    caseFindManyMock.mockResolvedValue([
      {
        totalSpend: 500,
        totalReimbursement: 300,
        primaryCptCode: null,
        dateOfSurgery: new Date("2025-06-01"),
        procedures: [],
      },
    ])
    // 36-month window: 1 case × 12/36 = 0.33 → would round to 0.
    const d = await getFacilityAnalysisData({
      start: "2023-08-05T00:00:00.000Z",
      end: "2026-08-05T00:00:00.000Z",
    })
    expect(d.annualCaseVolume).toBe(1)
  })

  it("the '(uncategorized)' bucket is selectable like any category", async () => {
    const d = await getFacilityAnalysisData({
      categories: [UNCATEGORIZED_CATEGORY],
    })
    expect(d.currentVendorSpend).toBe(100)
    expect(d.categories).toHaveLength(1)
    expect(d.categories[0].category).toBe(UNCATEGORIZED_CATEGORY)
  })

  it("revenue gate and case figures share the window's time base", async () => {
    // Window reimbursement $300 over ~3 months annualizes to ~$1.2K — still
    // below the ~$5.6K annualized spend run rate, so revenue stays IMPLIED.
    caseFindManyMock.mockResolvedValue([
      {
        totalSpend: 500,
        totalReimbursement: 300,
        primaryCptCode: null,
        dateOfSurgery: new Date("2026-06-01"),
        procedures: [],
      },
    ])
    const d = await getFacilityAnalysisData({
      start: "2026-05-05T00:00:00.000Z",
      end: "2026-08-05T00:00:00.000Z",
    })
    // Cases honor the same window as spend.
    const caseWhere = caseFindManyMock.mock.calls[0][0].where
    expect(caseWhere.dateOfSurgery.gte.toISOString()).toBe(
      "2026-05-05T00:00:00.000Z",
    )
    expect(caseWhere.dateOfSurgery.lte.toISOString()).toBe(
      "2026-08-05T00:00:00.000Z",
    )
    expect(d.revenueIsImplied).toBe(true)
    // The implied proxy is annual too: annualized-unfiltered spend ÷ 0.3.
    const annualizedUnfiltered = (1400 / d.windowMonths) * 12
    expect(d.netRevenue).toBeCloseTo(annualizedUnfiltered / 0.3, 6)
    expect(d.netRevenue).toBeGreaterThan(d.annualizedVendorSpend)
    // Summed figures annualize; per-case and coverage stay raw.
    expect(d.measuredReimbursement).toBeCloseTo(300 * (12 / d.windowMonths), 4)
    expect(d.annualCaseVolume).toBe(Math.round(1 * (12 / d.windowMonths)))
    expect(d.reimbursementCoverage).toEqual({ withRate: 1, totalCases: 1 })
    expect(d.avgCoveredCaseReimbursement).toBe(300)
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
