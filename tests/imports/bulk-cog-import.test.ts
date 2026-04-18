/**
 * Tests for bulkImportCOGRecords — the core batched COG import action.
 *
 * Covers the 3 dedup strategies (skip / overwrite / keep_both) and
 * the vendor-resolution integration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const createManyCalls: Array<{ data: Record<string, unknown>[] }> = []
const updateCalls: Array<{ id: string; data: Record<string, unknown> }> = []
let existingRows: Array<{
  id: string
  inventoryNumber: string
  transactionDate: Date
  vendorItemNo: string | null
}> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        createManyCalls.push({ data })
        return { count: data.length }
      }),
      findMany: vi.fn(async () => existingRows),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Record<string, unknown>
        }) => {
          updateCalls.push({ id: where.id, data })
          return { id: where.id }
        },
      ),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
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
  resolveVendorIdsBulk: vi.fn(async (names: string[]) => {
    const m = new Map<string, string>()
    for (const n of names) {
      m.set(n.trim().toLowerCase(), `v-${n.replace(/\s+/g, "-").toLowerCase()}`)
    }
    return m
  }),
}))

import { bulkImportCOGRecords } from "@/lib/actions/cog-import"

const recordSeed = (overrides: Partial<Record<string, unknown>> = {}) => ({
  vendorId: undefined,
  vendorName: "Arthrex",
  inventoryNumber: "INV-1",
  inventoryDescription: "Item A",
  vendorItemNo: "AR-100",
  manufacturerNo: undefined,
  poNumber: "PO-1",
  unitCost: 100,
  extendedPrice: 500,
  quantity: 5,
  transactionDate: "2026-03-15",
  category: undefined,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  createManyCalls.length = 0
  updateCalls.length = 0
  existingRows = []
})

describe("bulkImportCOGRecords — duplicateStrategy: 'keep_both'", () => {
  it("inserts every record unconditionally (no dedup check)", async () => {
    const result = await bulkImportCOGRecords({
      facilityId: "fac-test",
      records: [recordSeed(), recordSeed({ inventoryNumber: "INV-2" })],
      duplicateStrategy: "keep_both",
    })

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
    expect(createManyCalls).toHaveLength(1)
    expect(createManyCalls[0].data).toHaveLength(2)
  })

  it("does not call findMany for dedup check in keep_both mode", async () => {
    const { prisma } = await import("@/lib/db")
    await bulkImportCOGRecords({
      facilityId: "fac-test",
      records: [recordSeed()],
      duplicateStrategy: "keep_both",
    })

    expect(prisma.cOGRecord.findMany).not.toHaveBeenCalled()
  })
})

describe("bulkImportCOGRecords — duplicateStrategy: 'skip'", () => {
  it("skips rows that match an existing record on (invNo, date, vendorItemNo)", async () => {
    existingRows = [
      {
        id: "existing-1",
        inventoryNumber: "INV-1",
        transactionDate: new Date("2026-03-15"),
        vendorItemNo: "AR-100",
      },
    ]

    const result = await bulkImportCOGRecords({
      facilityId: "fac-test",
      records: [
        recordSeed(), // dup of existing
        recordSeed({ inventoryNumber: "INV-NEW" }), // new
      ],
      duplicateStrategy: "skip",
    })

    expect(result.skipped).toBe(1)
    expect(result.imported).toBe(1)
  })

  it("inserts every record when no existing matches", async () => {
    const result = await bulkImportCOGRecords({
      facilityId: "fac-test",
      records: [recordSeed(), recordSeed({ inventoryNumber: "INV-2" })],
      duplicateStrategy: "skip",
    })

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)
  })
})

describe("bulkImportCOGRecords — duplicateStrategy: 'overwrite'", () => {
  it("updates existing records + inserts new ones", async () => {
    existingRows = [
      {
        id: "existing-1",
        inventoryNumber: "INV-1",
        transactionDate: new Date("2026-03-15"),
        vendorItemNo: "AR-100",
      },
    ]

    const result = await bulkImportCOGRecords({
      facilityId: "fac-test",
      records: [
        recordSeed({ unitCost: 999, extendedPrice: 4995 }), // overwrite
        recordSeed({ inventoryNumber: "INV-NEW" }), // new
      ],
      duplicateStrategy: "overwrite",
    })

    expect(result.imported).toBe(2) // 1 overwrite + 1 new
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].id).toBe("existing-1")
    expect(Number(updateCalls[0].data.unitCost)).toBe(999)
  })
})

describe("bulkImportCOGRecords — vendor resolution", () => {
  it("resolves vendorName → vendorId via the shared resolver", async () => {
    await bulkImportCOGRecords({
      facilityId: "fac-test",
      records: [
        recordSeed({ vendorName: "Stryker", vendorId: undefined }),
        recordSeed({ vendorName: "Medtronic Inc", vendorId: undefined }),
      ],
      duplicateStrategy: "keep_both",
    })

    const data = createManyCalls[0].data
    expect(data[0].vendorId).toBe("v-stryker")
    expect(data[1].vendorId).toBe("v-medtronic-inc")
  })

  it("respects explicit vendorId on record (skips resolver)", async () => {
    await bulkImportCOGRecords({
      facilityId: "fac-test",
      records: [recordSeed({ vendorId: "v-preresolved", vendorName: "Acme" })],
      duplicateStrategy: "keep_both",
    })

    expect(createManyCalls[0].data[0].vendorId).toBe("v-preresolved")
  })
})

describe("bulkImportCOGRecords — extendedPrice fallback", () => {
  it("computes extendedPrice = unitCost × quantity when not provided", async () => {
    await bulkImportCOGRecords({
      facilityId: "fac-test",
      records: [
        recordSeed({ extendedPrice: undefined, unitCost: 50, quantity: 3 }),
      ],
      duplicateStrategy: "keep_both",
    })

    expect(Number(createManyCalls[0].data[0].extendedPrice)).toBe(150)
  })

  it("uses explicit extendedPrice over computed", async () => {
    await bulkImportCOGRecords({
      facilityId: "fac-test",
      records: [
        recordSeed({ extendedPrice: 999, unitCost: 50, quantity: 3 }),
      ],
      duplicateStrategy: "keep_both",
    })

    expect(Number(createManyCalls[0].data[0].extendedPrice)).toBe(999)
  })
})

describe("bulkImportCOGRecords — batching", () => {
  it("splits into 500-row batches", async () => {
    const records = Array.from({ length: 1200 }, (_, i) =>
      recordSeed({ inventoryNumber: `INV-${i}` }),
    )

    const result = await bulkImportCOGRecords({
      facilityId: "fac-test",
      records,
      duplicateStrategy: "keep_both",
    })

    expect(result.imported).toBe(1200)
    // 500 + 500 + 200 = 3 createMany calls
    expect(createManyCalls).toHaveLength(3)
    expect(createManyCalls[0].data).toHaveLength(500)
    expect(createManyCalls[1].data).toHaveLength(500)
    expect(createManyCalls[2].data).toHaveLength(200)
  })
})
