/**
 * Tests for the error-surface instrumentation in `bulkImportCOGRecords`
 * (Charles W2.C-B). Prior to the fix, a failing `prisma.cOGRecord.
 * createMany` (or the overwrite transaction) was caught with an
 * anonymous `catch {}` that incremented `errors` but swallowed the
 * underlying Prisma exception. Result: Charles saw "144 errors, 0
 * imported" with nothing in the server log to debug.
 *
 * This suite mocks `prisma.cOGRecord.createMany` to throw and asserts
 * BOTH that `errors` is counted correctly AND that `console.error` was
 * called with the error, batchSize, and at least one sample record so
 * ops has a real debugging surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { BulkImportInput } from "@/lib/validators/cog-records"

const createManyMock = vi.fn()
const findManyMock = vi.fn(async () => [])
const countMock = vi.fn(async () => 0)
const txMock = vi.fn()
const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})
const resolveVendorIdsBulkMock = vi.fn(async () => new Map<string, string>())
const recomputeMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      createMany: (args: unknown) => createManyMock(args),
      findMany: (args: unknown) => findManyMock(args),
      count: (args: unknown) => countMock(args),
      update: (args: unknown) => args,
    },
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
  recomputeMatchStatusesForVendor: (...args: unknown[]) => recomputeMock(...args),
}))

import { bulkImportCOGRecords } from "@/lib/actions/cog-import"

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function makeInput(count: number): BulkImportInput {
  const records = Array.from({ length: count }, (_, i) => ({
    inventoryNumber: `INV-${i}`,
    inventoryDescription: `Item ${i}`,
    vendorName: "Acme",
    unitCost: 10,
    quantity: 1,
    transactionDate: "2024-04-04",
  }))
  return {
    facilityId: "fac-1",
    records,
    duplicateStrategy: "keep_both",
  }
}

describe("bulkImportCOGRecords — W2.C-B error surface", () => {
  it("counts every row as an error and logs the underlying Prisma failure when createMany throws", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {})

    const dbErr = new Error("simulated db fail X")
    createManyMock.mockImplementationOnce(() => {
      throw dbErr
    })

    const result = await bulkImportCOGRecords(makeInput(3))

    // All three rows counted as errors.
    expect(result.errors).toBe(3)
    expect(result.imported).toBe(0)

    // Instrumentation must surface the real exception + batch context.
    expect(errorSpy).toHaveBeenCalled()
    const calls = errorSpy.mock.calls
    // Find the [bulkImportCOGRecords] call (there may also be warns).
    const importErr = calls.find((args) =>
      typeof args[0] === "string" &&
      args[0].includes("[bulkImportCOGRecords]"),
    )
    expect(importErr, "[bulkImportCOGRecords] console.error call").toBeDefined()
    // Payload should contain the thrown error + batch size + sample(s).
    const payload = importErr?.[1] as {
      error: unknown
      batchSize: number
      sample: unknown[]
    }
    expect(payload.error).toBe(dbErr)
    expect(payload.batchSize).toBe(3)
    expect(Array.isArray(payload.sample)).toBe(true)
    expect(payload.sample.length).toBeGreaterThan(0)
  })

  it("logs the overwrite-branch failure when the $transaction rejects", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {})

    // Two inputs: findMany returns an 'existing' row for each so they
    // route into the overwrite branch.
    const input: BulkImportInput = {
      facilityId: "fac-1",
      duplicateStrategy: "overwrite",
      records: [
        {
          inventoryNumber: "INV-1",
          inventoryDescription: "A",
          unitCost: 1,
          quantity: 1,
          transactionDate: "2024-04-04",
        },
        {
          inventoryNumber: "INV-2",
          inventoryDescription: "B",
          unitCost: 2,
          quantity: 1,
          transactionDate: "2024-04-04",
        },
      ],
    }

    findManyMock.mockImplementationOnce(async () => [
      {
        id: "ex-1",
        inventoryNumber: "INV-1",
        transactionDate: new Date("2024-04-04"),
        vendorItemNo: null,
      },
      {
        id: "ex-2",
        inventoryNumber: "INV-2",
        transactionDate: new Date("2024-04-04"),
        vendorItemNo: null,
      },
    ])

    const txErr = new Error("simulated tx fail Y")
    txMock.mockImplementationOnce(() => {
      throw txErr
    })

    const result = await bulkImportCOGRecords(input)

    expect(result.errors).toBe(2)
    expect(result.imported).toBe(0)

    const importErr = errorSpy.mock.calls.find((args) =>
      typeof args[0] === "string" &&
      args[0].includes("[bulkImportCOGRecords]"),
    )
    expect(importErr).toBeDefined()
    const payload = importErr?.[1] as {
      error: unknown
      batchSize: number
      sample: unknown[]
    }
    expect(payload.error).toBe(txErr)
    expect(payload.batchSize).toBe(2)
    expect(payload.sample.length).toBeGreaterThan(0)
  })
})
