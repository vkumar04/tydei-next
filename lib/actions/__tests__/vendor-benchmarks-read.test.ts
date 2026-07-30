/**
 * `getVendorBenchmarks` — the read side of the Benchmarks import, and the only
 * source the Deal Scorer's benchmark picker has.
 *
 * Vick 2026-07-29: `currentPrice` and `annualUnits` were added to the table so
 * the vendor's own workbook could fill the grid's Current and Volume cells. A
 * column that imports but is left out of THIS mapping is invisible to every
 * surface — the exact shape of the original complaint, one layer down. These
 * tests pin the mapping against the Prisma row, so dropping a field fails here
 * rather than in a screenshot.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: { productBenchmark: { findMany: mocks.findMany } },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireAuth: vi.fn(async () => ({ user: { id: "u-vendor" } })),
  requireVendor: vi.fn(async () => ({
    vendor: { id: "vend-1", name: "Acme Surgical" },
    user: { id: "u-vendor" },
  })),
  requireFacility: vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock("@/lib/actions/division-auth", () => ({
  callerVendorDivisionIds: vi.fn(async () => undefined),
  callerFacilityDivisionIds: vi.fn(async () => undefined),
}))

vi.mock("@/lib/divisions/category-scope", () => ({
  divisionCategoryKeySet: vi.fn(async () => undefined),
  categoryInDivisionScope: vi.fn(() => true),
}))

import { getVendorBenchmarks } from "@/lib/actions/prospective"

/** A stored row as Prisma hands it back: Decimals as objects, NULLs as null. */
function storedRow(over: Record<string, unknown> = {}) {
  return {
    id: "b-1",
    vendorId: "vend-1",
    vendorItemNo: "Cemented Knee",
    description: null,
    category: null,
    nationalAvgPrice: { toString: () => "3300" },
    percentile25: null,
    percentile50: null,
    percentile75: null,
    minPrice: { toString: () => "2850" },
    maxPrice: null,
    currentPrice: { toString: () => "3800" },
    annualUnits: 240,
    sampleSize: null,
    dataDate: null,
    source: "vendor_upload",
    createdAt: new Date("2026-07-29T00:00:00Z"),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getVendorBenchmarks — row mapping", () => {
  it("returns the workbook's current price and annual units", async () => {
    mocks.findMany.mockResolvedValue([storedRow()])
    const [row] = await getVendorBenchmarks()
    expect(row!.currentPrice).toBe(3800)
    expect(row!.annualUnits).toBe(240)
    // …alongside the market columns it always carried.
    expect(row!.nationalAvgPrice).toBe(3300)
    expect(row!.minPrice).toBe(2850)
  })

  it("maps an absent column to 0, the signal every consumer keys off", async () => {
    // seedConstructFromBenchmark and the Benchmarks table both read 0 as "the
    // file didn't carry this". null or NaN leaking through would render as an
    // empty cell in one place and "NaN" in another.
    mocks.findMany.mockResolvedValue([
      storedRow({ currentPrice: null, annualUnits: null }),
    ])
    const [row] = await getVendorBenchmarks()
    expect(row!.currentPrice).toBe(0)
    expect(row!.annualUnits).toBe(0)
    expect(Number.isNaN(row!.currentPrice)).toBe(false)
  })

  it("returns plain numbers, never Decimal objects", async () => {
    // A Decimal that survives serialization renders as "[object Object]" and
    // fails every `> 0` check the seeding rule makes.
    mocks.findMany.mockResolvedValue([storedRow()])
    const [row] = await getVendorBenchmarks()
    expect(typeof row!.currentPrice).toBe("number")
    expect(typeof row!.annualUnits).toBe("number")
  })

  it("stays scoped to the session vendor's own rows", async () => {
    // Tenant isolation: uploaded benchmark rows are vendor-private.
    mocks.findMany.mockResolvedValue([])
    await getVendorBenchmarks()
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { vendorId: "vend-1" } }),
    )
  })
})
