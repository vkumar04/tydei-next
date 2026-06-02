/**
 * Regression — Bug 1/10 (Vick 2026-06-02): "when you upload a price file it
 * needs to map categories ... like Cogs." The Category Mapping dialog
 * listed only COGRecord categories, so a category that lives only in a
 * price file (ContractPricing.category) never appeared to be mapped.
 * getCOGCategoryMappings must union both sources.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const FACILITY_ID = "f_lighthouse"

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      groupBy: vi.fn(async () => [
        { category: "JOINT", _count: { _all: 4 }, _sum: { extendedPrice: 1000 } },
      ]),
    },
    contractPricing: {
      // Lives only in a price file — must still surface.
      groupBy: vi.fn(async () => [
        { category: "Joints-Ortho", _count: { _all: 7 } },
      ]),
    },
    categoryMapping: {
      findMany: vi.fn(async () => []),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: FACILITY_ID },
    user: { id: "u1" },
  })),
}))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.resetModules())

describe("getCOGCategoryMappings unions price-file categories (Bug 1/10)", () => {
  it("surfaces a category that exists only in ContractPricing", async () => {
    const { getCOGCategoryMappings } = await import(
      "@/lib/actions/cog-category-mapping"
    )
    const rows = await getCOGCategoryMappings()
    const labels = rows.map((r) => r.category)
    expect(labels).toContain("JOINT")
    expect(labels).toContain("Joints-Ortho")
    const priceOnly = rows.find((r) => r.category === "Joints-Ortho")
    expect(priceOnly!.recordCount).toBe(7)
    expect(priceOnly!.totalSpend).toBe(0)
  })
})
