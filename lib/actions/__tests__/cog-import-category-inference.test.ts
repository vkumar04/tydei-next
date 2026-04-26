/**
 * Verifies that `bulkImportCOGRecords` and `createCOGRecord` infer a
 * category from `ProductBenchmark.vendorItemNo` when the caller didn't
 * supply one. Prevents regression of the prod-feedback bug where
 * un-categorized COG silently hid the per-category market share card.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi
    .fn()
    .mockResolvedValue({ user: { id: "u1" }, facility: { id: "fac1" } }),
}))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))
vi.mock("@/lib/vendors/resolve", () => ({
  resolveVendorIdsBulk: vi.fn().mockResolvedValue(new Map()),
}))

const cogCreateManyMock = vi.fn(
  async ({ data }: { data: Array<{ category: string | null }> }) => ({
    count: data.length,
  }),
)
const cogCreateMock = vi.fn(
  async ({ data }: { data: { category: string | null } }) => ({
    id: "cog-1",
    ...data,
  }),
)
const cogFindManyMock = vi.fn().mockResolvedValue([])
const benchmarkFindManyMock = vi.fn()
const benchmarkFindFirstMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      createMany: (a: unknown) => cogCreateManyMock(a as never),
      create: (a: unknown) => cogCreateMock(a as never),
      findMany: (a: unknown) => cogFindManyMock(a as never),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    productBenchmark: {
      findMany: (a: unknown) => benchmarkFindManyMock(a as never),
      findFirst: (a: unknown) => benchmarkFindFirstMock(a as never),
    },
    $transaction: vi.fn().mockResolvedValue([0, 0, 0]),
    fileImport: { create: vi.fn().mockResolvedValue({ id: "fi-1" }) },
  },
}))

beforeEach(() => {
  cogCreateManyMock.mockClear()
  cogCreateMock.mockClear()
  benchmarkFindManyMock.mockReset()
  benchmarkFindFirstMock.mockReset()
})

describe("bulkImportCOGRecords category inference", () => {
  it("fills missing category from ProductBenchmark.vendorItemNo", async () => {
    benchmarkFindManyMock.mockResolvedValue([
      { vendorItemNo: "ARTH-7755", category: "Sports Medicine" },
      { vendorItemNo: "STR-J-100", category: "Joint Replacement" },
    ])
    const { bulkImportCOGRecords } = await import("../cog-import")
    await bulkImportCOGRecords({
      facilityId: "fac1",
      records: [
        {
          vendorId: "v1",
          vendorName: "Arthrex",
          inventoryNumber: "INV-1",
          inventoryDescription: "Item",
          vendorItemNo: "ARTH-7755",
          unitCost: 100,
          quantity: 1,
          transactionDate: "2026-01-01",
          // category intentionally omitted — should be filled from benchmark
        },
      ],
      duplicateStrategy: "keep_both",
    } as unknown as Parameters<typeof bulkImportCOGRecords>[0])
    expect(cogCreateManyMock).toHaveBeenCalled()
    const arg = cogCreateManyMock.mock.calls[0][0] as { data: Array<{ category: string | null }> }
    expect(arg.data[0].category).toBe("Sports Medicine")
  })

  it("keeps caller-supplied category over benchmark inference", async () => {
    benchmarkFindManyMock.mockResolvedValue([
      { vendorItemNo: "ARTH-7755", category: "Sports Medicine" },
    ])
    const { bulkImportCOGRecords } = await import("../cog-import")
    await bulkImportCOGRecords({
      facilityId: "fac1",
      records: [
        {
          vendorId: "v1",
          vendorName: "Arthrex",
          inventoryNumber: "INV-1",
          inventoryDescription: "Item",
          vendorItemNo: "ARTH-7755",
          unitCost: 100,
          quantity: 1,
          transactionDate: "2026-01-01",
          category: "Manual Override",
        },
      ],
      duplicateStrategy: "keep_both",
    } as unknown as Parameters<typeof bulkImportCOGRecords>[0])
    const arg = cogCreateManyMock.mock.calls[0][0] as { data: Array<{ category: string | null }> }
    expect(arg.data[0].category).toBe("Manual Override")
  })

  it("leaves category null when neither caller nor benchmark provides one", async () => {
    benchmarkFindManyMock.mockResolvedValue([])
    const { bulkImportCOGRecords } = await import("../cog-import")
    await bulkImportCOGRecords({
      facilityId: "fac1",
      records: [
        {
          vendorId: "v1",
          vendorName: "Arthrex",
          inventoryNumber: "INV-1",
          inventoryDescription: "Item",
          vendorItemNo: "UNKNOWN",
          unitCost: 100,
          quantity: 1,
          transactionDate: "2026-01-01",
        },
      ],
      duplicateStrategy: "keep_both",
    } as unknown as Parameters<typeof bulkImportCOGRecords>[0])
    const arg = cogCreateManyMock.mock.calls[0][0] as { data: Array<{ category: string | null }> }
    expect(arg.data[0].category).toBeFalsy()
  })
})
