/**
 * Regression test for bug 2026-05-18 ("market share calculations").
 *
 * `computeContractMetrics` (which populates `Contract.currentMarketShare`)
 * must use the `effectiveCategoryOf` fallback so COG rows with
 * `category = null` but matched to a contract whose productCategory
 * IS in scope still count toward both numerator AND denominator.
 *
 * Prior impl ran a raw `cOGRecord.aggregate({ category: { in: scope } })`
 * which silently skipped those rows, undercounting market share for
 * any facility whose COG arrived without explicit categories. The
 * per-category card on contract detail already used the canonical
 * helper so the two surfaces drifted — `Contract.currentMarketShare`
 * (used to gate market_share rebates) was the lower of the two.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "f1" },
    user: { id: "u1" },
  })),
}))

const FACILITY_ID = "f1"
const VENDOR_ID = "v_stryker"
const OTHER_VENDOR = "v_other"

const fixture = [
  // Explicit category — both vendors compete in Spine (50/50)
  {
    vendorId: VENDOR_ID,
    category: "Spine",
    extendedPrice: 100,
    contractId: null,
  },
  {
    vendorId: OTHER_VENDOR,
    category: "Spine",
    extendedPrice: 100,
    contractId: null,
  },
  // Fallback path — both rows lack category but matched contracts say "Spine"
  // Pre-fix this $300 ($240 + $60) was invisible to currentMarketShare.
  // Post-fix it resolves to Spine and pushes vendor share from 50% to
  // ($100 + $240) / ($200 + $300) = $340 / $500 = 68%.
  {
    vendorId: VENDOR_ID,
    category: null,
    extendedPrice: 240,
    contractId: "c_v_spine",
  },
  {
    vendorId: OTHER_VENDOR,
    category: null,
    extendedPrice: 60,
    contractId: "c_o_spine",
  },
]

const contracts = [
  { id: "c_v_spine", productCategory: { name: "Spine" } },
  { id: "c_o_spine", productCategory: { name: "Spine" } },
]

const cOGCount = vi.fn()
const cOGFindMany = vi.fn()
const contractFindFirstOrThrow = vi.fn()
const contractFindMany = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      count: cOGCount,
      findMany: cOGFindMany,
    },
    contract: {
      findFirstOrThrow: contractFindFirstOrThrow,
      findMany: contractFindMany,
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  cOGCount.mockResolvedValue(0)
  contractFindFirstOrThrow.mockResolvedValue({
    vendorId: VENDOR_ID,
    effectiveDate: new Date("2025-01-01"),
    expirationDate: new Date("2026-12-31"),
    productCategory: { name: "Spine" },
    terms: [],
  })
  contractFindMany.mockResolvedValue(contracts)
  cOGFindMany.mockResolvedValue(fixture)
})

afterEach(() => {
  vi.resetModules()
})

describe("computeContractMetrics market share fallback", () => {
  it("counts COG rows with category=null + matched contract via effectiveCategoryOf fallback", async () => {
    const { computeContractMetrics } = await import(
      "@/lib/actions/contracts/derived-metrics"
    )

    const result = await computeContractMetrics({ contractId: "c_target" })

    // Vendor: $100 (explicit) + $240 (fallback) = $340
    expect(result.vendorSpendInCategories).toBe(340)
    // Total: $200 (explicit) + $300 (fallback) = $500
    expect(result.totalSpendInCategories).toBe(500)
    // Share: 340 / 500 = 68.0%
    expect(result.currentMarketShare).toBe(68.0)
  })

  it("returns null currentMarketShare when no spend exists in scope", async () => {
    cOGFindMany.mockResolvedValueOnce([])
    const { computeContractMetrics } = await import(
      "@/lib/actions/contracts/derived-metrics"
    )

    const result = await computeContractMetrics({ contractId: "c_target" })

    expect(result.currentMarketShare).toBeNull()
    expect(result.vendorSpendInCategories).toBe(0)
    expect(result.totalSpendInCategories).toBe(0)
  })

  it("ignores spend in categories outside the contract's scope", async () => {
    cOGFindMany.mockResolvedValueOnce([
      ...fixture,
      // Cardiology spend — out of scope, must NOT pollute totals
      {
        vendorId: VENDOR_ID,
        category: "Cardiology",
        extendedPrice: 9_999,
        contractId: null,
      },
      {
        vendorId: OTHER_VENDOR,
        category: "Cardiology",
        extendedPrice: 9_999,
        contractId: null,
      },
    ])
    const { computeContractMetrics } = await import(
      "@/lib/actions/contracts/derived-metrics"
    )

    const result = await computeContractMetrics({ contractId: "c_target" })

    // Same numbers as the first test — Cardiology rows should be ignored
    expect(result.vendorSpendInCategories).toBe(340)
    expect(result.totalSpendInCategories).toBe(500)
    expect(result.currentMarketShare).toBe(68.0)
  })
})
