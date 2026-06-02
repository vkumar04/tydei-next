/**
 * Regression — Bug 7/11 (Vick 2026-06-02): "for group contract it is not
 * counting the other groups it is only counting the main vendor" and
 * "it is messing with the market share ... showing very little now."
 *
 * `getCategoryMarketShareForVendor` previously passed only the single
 * input vendorId to the share engine, so a GROUPED contract's share
 * numerator dropped every additional vendor. When a contractId is
 * supplied and the contract is grouped, the numerator must sum spend
 * across the full vendor set (vendorId + additionalVendorIds), while the
 * denominator stays the whole category market.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const FACILITY_ID = "f_lighthouse"
const MAIN_VENDOR = "v_main"
const GROUP_VENDOR = "v_group"
const OTHER_VENDOR = "v_other"

// All three compete in one category. Group (main + additional) = 90 of 100.
const fixture = [
  {
    vendorId: MAIN_VENDOR,
    category: "Joints-Ortho",
    extendedPrice: 60,
    contractId: null,
    facilityId: FACILITY_ID,
    transactionDate: new Date(),
  },
  {
    vendorId: GROUP_VENDOR,
    category: "Joints-Ortho",
    extendedPrice: 30,
    contractId: null,
    facilityId: FACILITY_ID,
    transactionDate: new Date(),
  },
  {
    vendorId: OTHER_VENDOR,
    category: "Joints-Ortho",
    extendedPrice: 10,
    contractId: null,
    facilityId: FACILITY_ID,
    transactionDate: new Date(),
  },
]

const groupedContract = {
  id: "c_group",
  vendorId: MAIN_VENDOR,
  additionalVendorIds: [GROUP_VENDOR],
  marketShareCommitmentByCategory: null,
}

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      findMany: vi.fn(async () => fixture),
    },
    contract: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => groupedContract),
    },
  },
}))

vi.mock("@/lib/serialize", () => ({ serialize: <T>(v: T) => v }))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: FACILITY_ID },
    user: { id: "u1" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
  contractsOwnedByFacility: () => ({}),
}))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.resetModules())

describe("market-share group widening (Bug 7/11)", () => {
  it("sums additional group vendors into the numerator when contractId is grouped", async () => {
    const { getCategoryMarketShareForVendor } = await import(
      "@/lib/actions/cog/category-market-share"
    )
    const result = await getCategoryMarketShareForVendor({
      vendorId: MAIN_VENDOR,
      contractId: "c_group",
    })
    const ortho = result.rows.find((r) => r.category === "Joints-Ortho")
    expect(ortho).toBeDefined()
    // Group = main (60) + additional (30) = 90 of 100 = 90%.
    expect(ortho!.vendorSpend).toBe(90)
    expect(ortho!.categoryTotal).toBe(100)
    expect(ortho!.sharePct).toBeCloseTo(90, 6)
  })

  it("counts only the main vendor when no contractId is supplied", async () => {
    const { getCategoryMarketShareForVendor } = await import(
      "@/lib/actions/cog/category-market-share"
    )
    const result = await getCategoryMarketShareForVendor({ vendorId: MAIN_VENDOR })
    const ortho = result.rows.find((r) => r.category === "Joints-Ortho")
    expect(ortho!.vendorSpend).toBe(60)
    expect(ortho!.sharePct).toBeCloseTo(60, 6)
  })
})
