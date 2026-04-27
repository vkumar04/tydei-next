/**
 * Parity guard — Spec 2026-04-26-v0-parity-engines-design.md Bucket A1.
 *
 * `getCategoryMarketShareForVendor` (facility-scoped, contract detail card)
 * and `getVendorMarketShareByCategory` (vendor-session, vendor dashboard
 * widget) must produce identical per-category share% for the same vendor
 * when fed the same COG fixture.
 *
 * The two actions emit different shapes — facility returns full
 * MarketShareResult, vendor projects to a UI-shaped row for the chart —
 * so this test compares semantically (match by category, compare share%)
 * rather than shape-for-shape.
 *
 * Fixture covers (1) explicit COG.category and (2) the contract-category
 * fallback (COG.category=null, Contract.productCategory carries the value).
 * The fallback case is what the Task-4 fix unblocked: pre-fix the vendor
 * action's groupBy denominator skipped this fallback, inflating share%.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const FACILITY_ID = "f_lighthouse"
const VENDOR_ID = "v_stryker"
const OTHER_VENDOR_ID = "v_other"

const fixture = [
  // Explicit category — both vendors compete in Spine
  {
    vendorId: VENDOR_ID,
    category: "Spine",
    extendedPrice: 100,
    contractId: null,
    facilityId: FACILITY_ID,
    transactionDate: new Date(),
  },
  {
    vendorId: OTHER_VENDOR_ID,
    category: "Spine",
    extendedPrice: 100,
    contractId: null,
    facilityId: FACILITY_ID,
    transactionDate: new Date(),
  },
  // Fallback path — COG.category null but contract carries Ortho-Extremity (15 chars; no truncation)
  {
    vendorId: VENDOR_ID,
    category: null,
    extendedPrice: 80,
    contractId: "c1",
    facilityId: FACILITY_ID,
    transactionDate: new Date(),
  },
  {
    vendorId: OTHER_VENDOR_ID,
    category: null,
    extendedPrice: 20,
    contractId: "c2",
    facilityId: FACILITY_ID,
    transactionDate: new Date(),
  },
]

const contracts = [
  { id: "c1", productCategory: { name: "Ortho-Extremity" } },
  { id: "c2", productCategory: { name: "Ortho-Extremity" } },
]

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      findMany: vi.fn(async (args: { distinct?: string[] }) => {
        // Vendor action's first call: distinct facilityId probe
        if (args.distinct?.includes("facilityId")) {
          return [{ facilityId: FACILITY_ID }]
        }
        return fixture
      }),
    },
    contract: {
      findMany: vi.fn(async () => contracts),
      findFirst: vi.fn(async () => null),
    },
  },
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T>(v: T) => v,
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: FACILITY_ID },
    user: { id: "u1" },
  })),
  requireVendor: vi.fn(async () => ({
    vendor: { id: VENDOR_ID },
    user: { id: "u1" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
  contractsOwnedByFacility: () => ({}),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.resetModules()
})

describe("market-share parity: facility action vs vendor action", () => {
  it("produces identical per-category share% for the same vendor", async () => {
    const { getCategoryMarketShareForVendor } = await import(
      "@/lib/actions/cog/category-market-share"
    )
    const { getVendorMarketShareByCategory } = await import(
      "@/lib/actions/vendor-dashboard"
    )

    const facilityResult = await getCategoryMarketShareForVendor({
      vendorId: VENDOR_ID,
    })
    const vendorResult = await getVendorMarketShareByCategory()

    // Build category → share% map from each side. Facility uses sharePct,
    // vendor uses share — same units (0–100), different field names.
    const facilityByCategory = new Map(
      facilityResult.rows.map((r) => [r.category, Number(r.sharePct.toFixed(6))]),
    )
    const vendorByCategory = new Map(
      vendorResult.rows.map((r) => [r.category, Number(r.share.toFixed(6))]),
    )

    // Every category that appears in the vendor projection must agree
    // with the facility computation. (Vendor projection is top-5; the
    // fixture has 2 categories so all are included.)
    for (const [cat, share] of vendorByCategory.entries()) {
      expect(facilityByCategory.get(cat)).toBeCloseTo(share, 5)
    }

    // Aggregate fields match field-for-field.
    expect(vendorResult.totalVendorSpend).toBe(facilityResult.totalVendorSpend)
    expect(vendorResult.uncategorizedSpend).toBe(facilityResult.uncategorizedSpend)
  })

  it("applies the contract-category fallback to BOTH numerator and denominator", async () => {
    const { getCategoryMarketShareForVendor } = await import(
      "@/lib/actions/cog/category-market-share"
    )
    const result = await getCategoryMarketShareForVendor({ vendorId: VENDOR_ID })
    const ortho = result.rows.find((r) => r.category === "Ortho-Extremity")
    expect(ortho).toBeDefined()
    expect(ortho!.vendorSpend).toBe(80)
    expect(ortho!.categoryTotal).toBe(100)
    expect(ortho!.sharePct).toBeCloseTo(80, 6)
  })

  it("vendor action sees the same Ortho-Extremity share via fallback", async () => {
    const { getVendorMarketShareByCategory } = await import(
      "@/lib/actions/vendor-dashboard"
    )
    const result = await getVendorMarketShareByCategory()
    const ortho = result.rows.find((r) => r.category === "Ortho-Extremity")
    expect(ortho).toBeDefined()
    // Pre-Task-4 this was 100% (numerator had fallback, denominator
    // didn't, so 80/80 = 100%). Post-fix it's 80% (80/100).
    expect(ortho!.share).toBeCloseTo(80, 6)
  })
})
