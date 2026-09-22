/**
 * Regression for the skip-dedup key in `bulkImportCOGRecords`.
 *
 * 2026-09-22: the existing-row side of the duplicate key was built from
 * `e.transactionDate.toISOString().slice(0, 10)` ("2026-08-01") while the
 * incoming-record side used `record.transactionDate` verbatim. The dialog
 * sends a plain "YYYY-MM-DD" and matched; the CSV/XLSX importer behind
 * /api/import-cog and Mass Upload sends `toISOString()`
 * ("2026-08-01T00:00:00.000Z") and never matched, so `skip` silently
 * imported every duplicate. Three identical uploads produced nine rows.
 *
 * Both formats must now dedupe against the same stored row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { BulkImportInput } from "@/lib/validators/cog-records"

type ExistingRow = {
  id: string
  inventoryNumber: string
  transactionDate: Date
  vendorItemNo: string | null
}

const createManyMock = vi.fn<(args: unknown) => Promise<{ count: number }>>(
  async (args) => ({
    count: (args as { data: unknown[] }).data.length,
  }),
)
const findManyMock = vi.fn<(args: unknown) => Promise<ExistingRow[]>>(
  async () => [],
)
const countMock = vi.fn<(args: unknown) => Promise<number>>(async () => 0)
const txMock = vi.fn<(arg: unknown) => Promise<unknown[]>>(async () => [])
const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})
const resolveVendorIdsBulkMock = vi.fn(
  async (_names: string[]) => new Map<string, string>(),
)
const recomputeMock = vi.fn(async (..._args: unknown[]) => undefined)

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      createMany: (args: unknown) => createManyMock(args),
      findMany: (args: unknown) => findManyMock(args),
      count: (args: unknown) => countMock(args),
      groupBy: vi.fn(async () => []),
      update: (args: unknown) => args,
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
    categoryMapping: { findMany: vi.fn(async () => []) },
    fileImport: { create: vi.fn(async () => ({ id: "fi-1" })) },
    $transaction: (arg: unknown) => txMock(arg),
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  }),
}))
vi.mock("@/lib/audit", () => ({
  logAudit: (args: Record<string, unknown>) => logAuditMock(args),
}))
vi.mock("@/lib/vendors/resolve", () => ({
  resolveVendorIdsBulk: (names: string[]) => resolveVendorIdsBulkMock(names),
}))
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: (...args: unknown[]) =>
    recomputeMock(...args),
}))

import { bulkImportCOGRecords } from "@/lib/actions/cog-import"

const STORED: ExistingRow[] = [
  {
    id: "existing-1",
    inventoryNumber: "SYK-1001",
    transactionDate: new Date("2026-08-01T00:00:00.000Z"),
    vendorItemNo: "SYK-1001",
  },
  {
    id: "existing-2",
    inventoryNumber: "SYK-1002",
    transactionDate: new Date("2026-08-03T00:00:00.000Z"),
    vendorItemNo: "SYK-1002",
  },
]

function makeInput(
  transactionDates: [string, string],
  duplicateStrategy: BulkImportInput["duplicateStrategy"] = "skip",
): BulkImportInput {
  return {
    facilityId: "fac-1",
    duplicateStrategy,
    records: [
      {
        inventoryNumber: "SYK-1001",
        inventoryDescription: "Hip Stem",
        vendorName: "Stryker",
        vendorItemNo: "SYK-1001",
        unitCost: 1250,
        quantity: 4,
        transactionDate: transactionDates[0],
      },
      {
        inventoryNumber: "SYK-1002",
        inventoryDescription: "Acetabular Cup",
        vendorName: "Stryker",
        vendorItemNo: "SYK-1002",
        unitCost: 980.5,
        quantity: 2,
        transactionDate: transactionDates[1],
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  findManyMock.mockResolvedValue(STORED)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("bulkImportCOGRecords — skip-dedup key normalizes transactionDate", () => {
  it("skips duplicates when records carry the importer's ISO datetime (the /api/import-cog path)", async () => {
    const result = await bulkImportCOGRecords(
      makeInput(["2026-08-01T00:00:00.000Z", "2026-08-03T00:00:00.000Z"]),
    )
    expect(result.skipped).toBe(2)
    expect(result.imported).toBe(0)
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it("skips duplicates when records carry a plain date (the dialog path)", async () => {
    const result = await bulkImportCOGRecords(
      makeInput(["2026-08-01", "2026-08-03"]),
    )
    expect(result.skipped).toBe(2)
    expect(result.imported).toBe(0)
    expect(createManyMock).not.toHaveBeenCalled()
  })

  it("still imports rows that are genuinely new", async () => {
    const result = await bulkImportCOGRecords(
      makeInput(["2026-08-02T00:00:00.000Z", "2026-08-03T00:00:00.000Z"]),
    )
    expect(result.skipped).toBe(1)
    expect(result.imported).toBe(1)
    expect(createManyMock).toHaveBeenCalledTimes(1)
  })
})
