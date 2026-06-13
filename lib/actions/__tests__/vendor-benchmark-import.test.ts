/**
 * Tests for importVendorBenchmarks — the vendor Benchmarks-tab upload
 * entry point ("Need to be able to add data for the benchmarks",
 * Vick 2026-06-12).
 *
 * Scoping invariant: a vendor session can ONLY write rows stamped with its
 * own vendorId + source "vendor_upload" — caller-supplied vendorId/source
 * are overwritten, never trusted. Dedupe invariant: re-importing an item
 * replaces the vendor's prior vendor_upload row (matched via normalizeSku,
 * never raw ===), leaving national rows and other vendors untouched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  benchmarkFindMany: vi.fn(),
  benchmarkCreateMany: vi.fn(),
  benchmarkDeleteMany: vi.fn(),
}))

vi.mock("@/lib/db", () => {
  const productBenchmark = {
    findMany: mocks.benchmarkFindMany,
    createMany: mocks.benchmarkCreateMany,
    deleteMany: mocks.benchmarkDeleteMany,
  }
  return {
    prisma: {
      productBenchmark,
      // Interactive transaction: hand the callback a tx that exposes the
      // same mocked delegates so the delete/insert assertions still see calls.
      $transaction: async (
        fn: (tx: { productBenchmark: typeof productBenchmark }) => Promise<unknown>,
      ) => fn({ productBenchmark }),
    },
  }
})

vi.mock("@/lib/actions/auth", () => ({
  requireAuth: vi.fn(async () => ({ user: { id: "u-1" } })),
  requireVendor: vi.fn(async () => ({
    vendor: { id: "vend-1", name: "Acme Surgical" },
    user: { id: "u-vendor" },
  })),
}))

import { importVendorBenchmarks } from "@/lib/actions/benchmarks"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.benchmarkFindMany.mockResolvedValue([])
  mocks.benchmarkCreateMany.mockImplementation(
    async ({ data }: { data: unknown[] }) => ({ count: data.length }),
  )
  mocks.benchmarkDeleteMany.mockResolvedValue({ count: 0 })
})

describe("importVendorBenchmarks — vendor scoping", () => {
  it("stamps the session vendorId and source vendor_upload on every row", async () => {
    const res = await importVendorBenchmarks([
      { vendorItemNo: "AR-1", nationalAvgPrice: 10 },
      { vendorItemNo: "AR-2", percentile50: 5 },
    ])

    expect(mocks.benchmarkCreateMany).toHaveBeenCalledTimes(1)
    const rows = mocks.benchmarkCreateMany.mock.calls[0]![0].data as Array<{
      vendorId: string
      source: string
    }>
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.vendorId).toBe("vend-1")
      expect(row.source).toBe("vendor_upload")
    }
    expect(res).toMatchObject({ inserted: 2, replaced: 0 })
  })

  it("overwrites a forged vendorId/source from the payload", async () => {
    await importVendorBenchmarks([
      // A vendor must never write rows tagged to another vendor — the
      // type omits vendorId/source, but the wire payload could carry them.
      {
        vendorItemNo: "EVIL-1",
        nationalAvgPrice: 1,
        vendorId: "vend-OTHER",
        source: "national_benchmark",
      } as unknown as Parameters<typeof importVendorBenchmarks>[0][number],
    ])

    const rows = mocks.benchmarkCreateMany.mock.calls[0]![0].data as Array<{
      vendorId: string
      source: string
    }>
    expect(rows[0]!.vendorId).toBe("vend-1")
    expect(rows[0]!.source).toBe("vendor_upload")
  })

  it("only ever reads/deletes within the session vendor's vendor_upload rows", async () => {
    await importVendorBenchmarks([{ vendorItemNo: "AR-1", minPrice: 2 }])
    expect(mocks.benchmarkFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vendorId: "vend-1", source: "vendor_upload" },
      }),
    )
  })
})

describe("importVendorBenchmarks — replace-on-reimport dedupe", () => {
  it("deletes the vendor's prior vendor_upload rows for re-imported SKUs (normalizeSku match)", async () => {
    mocks.benchmarkFindMany.mockResolvedValue([
      // Same SKU modulo case + whitespace — raw === would miss it.
      { id: "old-1", vendorItemNo: " ar-1 " },
      { id: "old-2", vendorItemNo: "UNRELATED-9" },
    ])

    const res = await importVendorBenchmarks([
      { vendorItemNo: "AR-1", nationalAvgPrice: 12 },
    ])

    expect(mocks.benchmarkDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["old-1"] } },
    })
    expect(res).toMatchObject({ inserted: 1, replaced: 1 })
  })

  it("does not delete anything when no prior rows match", async () => {
    mocks.benchmarkFindMany.mockResolvedValue([
      { id: "old-2", vendorItemNo: "UNRELATED-9" },
    ])
    await importVendorBenchmarks([{ vendorItemNo: "AR-1", maxPrice: 3 }])
    expect(mocks.benchmarkDeleteMany).not.toHaveBeenCalled()
  })

  it("dedupes within the batch — last row wins per normalized SKU", async () => {
    await importVendorBenchmarks([
      { vendorItemNo: "AR-1", nationalAvgPrice: 10 },
      { vendorItemNo: "ar-1", nationalAvgPrice: 99 },
    ])
    const rows = mocks.benchmarkCreateMany.mock.calls[0]![0].data as Array<{
      vendorItemNo: string
      nationalAvgPrice: number
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0]!.nationalAvgPrice).toBe(99)
  })
})

describe("importVendorBenchmarks — chunk idempotency (feature 5)", () => {
  // Feature 5 chunks a big file into per-2000-row importVendorBenchmarks
  // calls. Each call's replace is self-contained (deletes only its OWN
  // chunk's SKUs' priors), so importing the SAME file twice must land
  // identically — no duplicate rows accumulate. We model a tiny stateful
  // store across two calls to prove the second call replaces, not appends.
  it("re-importing the same SKUs replaces prior rows instead of duplicating", async () => {
    let store: Array<{ id: string; vendorItemNo: string }> = []
    let idSeq = 0

    mocks.benchmarkFindMany.mockImplementation(async () => store)
    mocks.benchmarkDeleteMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) => {
        const ids = new Set(where.id.in)
        const before = store.length
        store = store.filter((r) => !ids.has(r.id))
        return { count: before - store.length }
      },
    )
    mocks.benchmarkCreateMany.mockImplementation(
      async ({ data }: { data: Array<{ vendorItemNo: string }> }) => {
        for (const row of data) {
          store.push({ id: `id-${idSeq++}`, vendorItemNo: row.vendorItemNo })
        }
        return { count: data.length }
      },
    )

    const file = [
      { vendorItemNo: "AR-1", nationalAvgPrice: 10 },
      { vendorItemNo: "AR-2", nationalAvgPrice: 20 },
    ]

    const first = await importVendorBenchmarks(file)
    expect(first).toMatchObject({ inserted: 2, replaced: 0 })
    expect(store).toHaveLength(2)

    // Same file again — should delete the 2 priors then insert 2, NOT append.
    const second = await importVendorBenchmarks(file)
    expect(second).toMatchObject({ inserted: 2, replaced: 2 })
    expect(store).toHaveLength(2)
    // Still exactly one row per SKU (no duplicates accrued).
    const skus = store.map((r) => r.vendorItemNo).sort()
    expect(skus).toEqual(["AR-1", "AR-2"])
  })
})

describe("importVendorBenchmarks — input handling", () => {
  it("returns zeros for an empty batch without touching the DB", async () => {
    const res = await importVendorBenchmarks([])
    expect(res).toEqual({ inserted: 0, replaced: 0 })
    expect(mocks.benchmarkFindMany).not.toHaveBeenCalled()
    expect(mocks.benchmarkCreateMany).not.toHaveBeenCalled()
  })

  it("coerces an ISO dataDate string to a Date for Prisma", async () => {
    await importVendorBenchmarks([
      { vendorItemNo: "AR-1", nationalAvgPrice: 10, dataDate: "2026-01-15" },
    ])
    const rows = mocks.benchmarkCreateMany.mock.calls[0]![0].data as Array<{
      dataDate?: Date
    }>
    expect(rows[0]!.dataDate).toBeInstanceOf(Date)
    expect(rows[0]!.dataDate!.toISOString().slice(0, 10)).toBe("2026-01-15")
  })

  it("throws a named error for an invalid row instead of a bare ZodError", async () => {
    await expect(
      importVendorBenchmarks([
        { vendorItemNo: "", nationalAvgPrice: 10 },
      ]),
    ).rejects.toThrow(/Benchmark import rejected an invalid row/)
  })
})
