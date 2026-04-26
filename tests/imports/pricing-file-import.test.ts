/**
 * End-to-end test for the pricing file ingest pipeline.
 *
 * Exercises: vendor hint resolution (code → name → manufacturer column
 * → fallback) + row transform + per-row PricingFile.create calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Mocks (hoisted) ────────────────────────────────────────────

const vendorCreates: Array<Record<string, unknown>> = []
const pricingCreates: Array<Record<string, unknown>> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    vendor: {
      findMany: vi.fn(
        async (): Promise<
          Array<{
            id: string
            name: string
            displayName: string | null
            code: string | null
          }>
        > => [
          { id: "v-arthrex", name: "Arthrex", displayName: "Arthrex Inc", code: "ART" },
          { id: "v-stryker", name: "Stryker", displayName: "Stryker Corp", code: "STR" },
          {
            id: "v-medtronic",
            name: "Medtronic",
            displayName: "Medtronic Inc",
            code: "MDT",
          },
        ],
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        name: `Vendor(${where.id})`,
      })),
      update: vi.fn(async () => ({})),
    },
    pricingFile: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        pricingCreates.push(data)
        return { id: `p-${pricingCreates.length}` }
      }),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))

vi.mock("@/lib/vendors/resolve", () => ({
  resolveVendorId: vi.fn(async (name: string | null) => {
    if (!name) return "v-unknown"
    return `v-${name.replace(/\s+/g, "-").toLowerCase()}`
  }),
  resolveVendorIdsBulk: vi.fn(async () => new Map()),
}))

vi.mock("next/cache", () => import("@/tests/setup/next-cache-mock"))

vi.mock("@/lib/actions/imports/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/actions/imports/shared")
  >("@/lib/actions/imports/shared")
  return {
    ...actual,
    mapColumnsWithAI: vi.fn(async () => ({})),
  }
})

// Import AFTER mocks
import { ingestPricingFile } from "@/lib/actions/imports/pricing-import"
import { mapColumnsWithAI } from "@/lib/actions/imports/shared"

const STANDARD_PRICING_MAPPING = {
  vendorItemNo: "Vendor Item Number",
  productDescription: "Product Description",
  contractPrice: "Contract Price",
  listPrice: "List Price",
  category: "Category",
  uom: "UOM",
}

beforeEach(() => {
  vi.clearAllMocks()
  pricingCreates.length = 0
  vendorCreates.length = 0
})

describe("ingestPricingFile — vendor hint resolution", () => {
  it("resolves vendor from filename-embedded code (pass 1: vendor.code)", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue(STANDARD_PRICING_MAPPING)

    const result = await ingestPricingFile({
      rows: [
        {
          "Vendor Item Number": "AR-100",
          "Product Description": "Anchor",
          "Contract Price": "50.00",
          "List Price": "75.00",
          Category: "Ortho",
          UOM: "EA",
        },
      ],
      fileName: "CogsART01012024.csv",
    })

    expect(result.imported).toBe(1)
    // Resolved to Arthrex via the "ART" code in the filename
    expect(pricingCreates[0].vendorId).toBe("v-arthrex")
  })

  it("resolves vendor from filename full-name token (pass 2)", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue(STANDARD_PRICING_MAPPING)

    await ingestPricingFile({
      rows: [
        {
          "Vendor Item Number": "STR-1",
          "Product Description": "X",
          "Contract Price": "1",
          "List Price": "2",
          Category: "",
          UOM: "EA",
        },
      ],
      fileName: "stryker_prices_2026.csv",
    })

    expect(pricingCreates[0].vendorId).toBe("v-stryker")
  })

  it("resolves vendor from Manufacturer column when filename hint missing", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue(STANDARD_PRICING_MAPPING)

    await ingestPricingFile({
      rows: [
        {
          Manufacturer: "Acme Medical",
          "Vendor Item Number": "AC-1",
          "Product Description": "Thing",
          "Contract Price": "10",
          "List Price": "15",
          Category: "",
          UOM: "EA",
        },
      ],
      fileName: "unknown-vendor.csv",
    })

    // Falls through to findOrCreateVendorByName("Acme Medical")
    expect(pricingCreates[0].vendorId).toBe("v-acme-medical")
  })

  it("falls back to 'unknown vendor' when no hint + no Manufacturer column", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue(STANDARD_PRICING_MAPPING)

    await ingestPricingFile({
      rows: [
        {
          "Vendor Item Number": "X-1",
          "Product Description": "Mystery",
          "Contract Price": "1",
          "List Price": "2",
          Category: "",
          UOM: "EA",
        },
      ],
      fileName: "random.csv",
    })

    expect(pricingCreates[0].vendorId).toBe("v-unknown")
  })

  it("SKIP_TOKENS prevents false-positive filename matches like 'cogs.csv'", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue(STANDARD_PRICING_MAPPING)

    // No vendor code in hint + filename starts with "cog" (skipped) →
    // falls through to Manufacturer column resolution or unknown.
    await ingestPricingFile({
      rows: [
        {
          "Vendor Item Number": "Y-1",
          "Product Description": "Thing",
          "Contract Price": "1",
          "List Price": "2",
          Category: "",
          UOM: "EA",
        },
      ],
      fileName: "cog_export.csv",
    })

    // "cog" is in SKIP_TOKENS, vendor code pass didn't match → falls to
    // unknown-vendor path (no Manufacturer col).
    expect(pricingCreates[0].vendorId).toBe("v-unknown")
  })
})

describe("ingestPricingFile — row transformation", () => {
  it("populates every PricingFile column from the mapped row", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue(STANDARD_PRICING_MAPPING)

    await ingestPricingFile({
      rows: [
        {
          "Vendor Item Number": "AR-9000",
          "Product Description": "Disposable Knee Jig",
          "Contract Price": "$112.50",
          "List Price": "$150.00",
          Category: "Orthopedics",
          UOM: "EA",
        },
      ],
      fileName: "arthrex_2026.csv",
    })

    const row = pricingCreates[0]
    expect(row.vendorId).toBe("v-arthrex")
    expect(row.vendorItemNo).toBe("AR-9000")
    expect(row.productDescription).toBe("Disposable Knee Jig")
    expect(Number(row.contractPrice)).toBe(112.5)
    expect(Number(row.listPrice)).toBe(150)
    expect(row.category).toBe("Orthopedics")
    expect(row.uom).toBe("EA")
  })

  it("falls back listPrice to contractPrice when only contractPrice is populated", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue(STANDARD_PRICING_MAPPING)

    await ingestPricingFile({
      rows: [
        {
          "Vendor Item Number": "AR-100",
          "Product Description": "Item",
          "Contract Price": "100",
          "List Price": "",
          Category: "",
          UOM: "EA",
        },
      ],
      fileName: "arthrex.csv",
    })

    // listPrice || contractPrice → falls back to 100
    expect(Number(pricingCreates[0].listPrice)).toBe(100)
  })

  it("skips rows with missing vendorItemNo (required field)", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue(STANDARD_PRICING_MAPPING)

    const result = await ingestPricingFile({
      rows: [
        {
          "Vendor Item Number": "",
          "Product Description": "Missing catalog",
          "Contract Price": "10",
          "List Price": "15",
          Category: "",
          UOM: "EA",
        },
        {
          "Vendor Item Number": "VALID-1",
          "Product Description": "Ok",
          "Contract Price": "10",
          "List Price": "15",
          Category: "",
          UOM: "EA",
        },
      ],
      fileName: "arthrex.csv",
    })

    expect(result.imported).toBe(1)
    expect(result.failed).toBe(1)
  })

  it("defaults productDescription to vendorItemNo when missing", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue(STANDARD_PRICING_MAPPING)

    await ingestPricingFile({
      rows: [
        {
          "Vendor Item Number": "ONLY-CATALOG-001",
          "Product Description": "",
          "Contract Price": "10",
          "List Price": "15",
          Category: "",
          UOM: "EA",
        },
      ],
      fileName: "arthrex.csv",
    })

    expect(pricingCreates[0].productDescription).toBe("ONLY-CATALOG-001")
  })
})

describe("ingestPricingFile — empty input", () => {
  it("handles zero rows gracefully", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValue({})

    const result = await ingestPricingFile({
      rows: [],
      fileName: "empty.csv",
    })

    expect(result.imported).toBe(0)
    expect(result.failed).toBe(0)
  })
})
