/**
 * End-to-end test for the COG CSV ingest pipeline.
 *
 * Exercises: parse → column-map → row-transform → bulkImportCOGRecords
 * against realistic fixture files. Mocks prisma + auth + audit + the
 * AI column mapper (which is pinned to deterministic per-test mappings
 * since we can't reproduce Claude's semantic header-matching offline).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

// ─── Mocks (hoisted before the module-under-test import) ────────

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({
        count: data.length,
      })),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
      // Post-import stats aggregation (subsystem 10.1 / Task 5). The
      // CSV ingest action forwards matched/unmatched/onContractRate
      // from bulkImportCOGRecords; we don't assert their values here
      // (covered by lib/actions/__tests__/cog-csv-import.test.ts) — we
      // just need the call to not throw.
      count: vi.fn(async () => 0),
    },
    vendor: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    productBenchmark: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    productCategory: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { name: string } }) => ({ name: data.name })),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
  requireVendor: vi.fn(),
}))

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))

vi.mock("@/lib/vendors/resolve", () => ({
  resolveVendorId: vi.fn(async (name: string | null) =>
    name ? `vendor-${name.replace(/\s+/g, "-").toLowerCase()}` : null,
  ),
  resolveVendorIdsBulk: vi.fn(async (names: string[]) => {
    const m = new Map<string, string>()
    for (const n of names) {
      m.set(
        n.trim().toLowerCase(),
        `vendor-${n.replace(/\s+/g, "-").toLowerCase()}`,
      )
    }
    return m
  }),
}))

vi.mock("next/cache", () => import("@/tests/setup/next-cache-mock"))

// Mock mapColumnsWithAI; per-test override via mockResolvedValueOnce.
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
import { ingestCOGRecordsCSV } from "@/lib/actions/imports/cog-csv-import"
import { mapColumnsWithAI } from "@/lib/actions/imports/shared"
import { prisma } from "@/lib/db"

const fixture = (name: string): string =>
  readFileSync(join(FIXTURE_DIR, name), "utf8")

// The canonical mapping for the v0 COG CSV header shape.
// Pinned per-test because mocking Claude's semantic matching is brittle.
const STANDARD_COG_MAPPING = {
  vendorName: "Vendor",
  transactionDate: "Date Ordered",
  description: "product name",
  refNumber: "Product ref number",
  quantity: "Quantity Ordered",
  unitCost: "Unit Cost",
  extended: "Extended Cost",
  poNumber: "Purchase Order Number",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("ingestCOGRecordsCSV — standard v0 header shape", () => {
  it("imports every row from a standard COG export", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce(STANDARD_COG_MAPPING)

    const csv = fixture("cog-standard.csv")
    const result = await ingestCOGRecordsCSV(csv, "cog-2026-q1.csv")

    expect(result.imported).toBe(4)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
  })

  it("produces COGRecord rows with correct fields", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce(STANDARD_COG_MAPPING)

    await ingestCOGRecordsCSV(fixture("cog-standard.csv"))

    const call = (prisma.cOGRecord.createMany as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { data: Record<string, unknown>[] }
    expect(call.data).toHaveLength(4)

    const first = call.data[0]
    expect(first.facilityId).toBe("fac-test")
    expect(first.vendorName).toBe("Arthrex")
    expect(first.vendorItemNo).toBe("AR-9000")
    expect(first.poNumber).toBe("PO-1001")
    expect(first.quantity).toBe(10)
    expect(Number(first.unitCost)).toBe(125)
    expect(Number(first.extendedPrice)).toBe(1250)
    // transactionDate round-trips as 2026-03-15 (compare via ISO to
    // avoid local-timezone leak)
    expect((first.transactionDate as Date).toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    )
  })

  it("returns zero imported for empty file (short-circuits before mapper)", async () => {
    const result = await ingestCOGRecordsCSV("")
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
  })

  it("skips rows missing required fields (vendor / date)", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      vendorName: "Vendor",
      transactionDate: "Date Ordered",
      quantity: "Quantity Ordered",
      unitCost: "Unit Cost",
      extended: "Extended Cost",
    })

    const csv =
      "Vendor,Date Ordered,Quantity Ordered,Unit Cost,Extended Cost\n" +
      "Arthrex,,5,100,500\n" + // missing date
      ",03/15/2026,5,100,500\n" + // missing vendor
      "Stryker,03/15/2026,5,100,500\n" // valid

    const result = await ingestCOGRecordsCSV(csv)
    // Rows missing required fields are silently dropped during the
    // row→record transformation; only the dedup-skip count surfaces
    // in `skipped`. With all-new records and no dedup collisions,
    // skipped stays 0 here.
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
  })
})

describe("ingestCOGRecordsCSV — dirty-header alias tolerance", () => {
  it("still imports when the mapper resolves non-standard headers", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      vendorName: "Supplier Name",
      transactionDate: "Transaction Date",
      description: "Item Description",
      refNumber: "Catalog",
      quantity: "Qty",
      unitCost: "Unit Price",
      extended: "Total",
      poNumber: "PO#",
    })

    const csv = fixture("cog-dirty-headers.csv")
    const result = await ingestCOGRecordsCSV(csv, "q1-cogs.csv")

    expect(result.imported).toBe(3)
    expect(result.skipped).toBe(0)
  })

  it("falls back to silent skip when the mapper returns {} (no usable columns)", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({})

    const csv = fixture("cog-dirty-headers.csv")
    const result = await ingestCOGRecordsCSV(csv)

    // Every row missing vendor + date → all skipped, zero imports.
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(3)
  })
})

describe("ingestCOGRecordsCSV — computed extendedPrice fallback", () => {
  it("computes extended = unitCost × qty when extended column is missing", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      vendorName: "Vendor",
      transactionDate: "Date Ordered",
      description: "product name",
      refNumber: "Product ref number",
      quantity: "Quantity Ordered",
      unitCost: "Unit Cost",
      // no "extended" key
    })

    const csv =
      "Vendor,Date Ordered,product name,Product ref number,Quantity Ordered,Unit Cost\n" +
      "Arthrex,03/15/2026,Item A,AR-100,3,50.00"

    await ingestCOGRecordsCSV(csv)

    const call = (prisma.cOGRecord.createMany as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { data: Record<string, unknown>[] }
    expect(Number(call.data[0].extendedPrice)).toBe(150) // 50 × 3
  })

  it("prefers explicit extended column when present", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce(STANDARD_COG_MAPPING)

    // Synthetic row where extended != qty × unit (e.g., credit adjustment)
    const csv =
      "Vendor,Purchase Order Number,Date Ordered,product name,Product ref number,Quantity Ordered,Unit Cost,Extended Cost\n" +
      "Arthrex,PO-9,03/15/2026,Item A,AR-100,3,50.00,200.00"

    await ingestCOGRecordsCSV(csv)

    const call = (prisma.cOGRecord.createMany as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { data: Record<string, unknown>[] }
    expect(Number(call.data[0].extendedPrice)).toBe(200)
  })
})

describe("ingestCOGRecordsCSV — vendor resolution through shared resolver", () => {
  it("resolves vendorName to vendorId via resolveVendorIdsBulk", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce(STANDARD_COG_MAPPING)

    await ingestCOGRecordsCSV(fixture("cog-standard.csv"))

    const call = (prisma.cOGRecord.createMany as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { data: Record<string, unknown>[] }
    expect(call.data[0].vendorId).toBe("vendor-arthrex")
    expect(call.data[1].vendorId).toBe("vendor-stryker")
    expect(call.data[2].vendorId).toBe("vendor-medtronic")
    // "Smith & Nephew" → "Smith-&-Nephew" (preserves internal chars)
    expect(call.data[3].vendorId).toContain("smith")
  })
})
