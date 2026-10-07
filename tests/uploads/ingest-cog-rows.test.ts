import { describe, expect, it, vi, beforeEach } from "vitest"
import { revalidatePath } from "next/cache"

const { requireFacility, bulkImportCOGRecords, mapColumnsWithAI, auditLogCreate } = vi.hoisted(() => ({
  requireFacility: vi.fn(),
  bulkImportCOGRecords: vi.fn(),
  mapColumnsWithAI: vi.fn(),
  auditLogCreate: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ prisma: { auditLog: { create: auditLogCreate } } }))
vi.mock("@/lib/actions/auth", () => ({ requireFacility }))
vi.mock("@/lib/actions/cog-import", () => ({ bulkImportCOGRecords }))
vi.mock("@/lib/actions/imports/shared", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/actions/imports/shared")>()
  return { ...actual, mapColumnsWithAI }
})

import { ingestCOGRecordsCSV, ingestCOGRecordsRows } from "@/lib/actions/imports/cog-csv-import"

const FULL_MAPPING = {
  vendorName: "Vendor",
  transactionDate: "Transaction Date",
  description: "Description",
  refNumber: "Vendor Item No",
  quantity: "Quantity",
  unitCost: "Unit Cost",
  extended: "Extended Price",
  poNumber: "PO Number",
  multiplier: "",
  category: "Category",
}

const BULK_RESULT = { imported: 2, overwritten: 0, skipped: 0, errors: 0, matched: 1, unmatched: 1, onContractRate: 50 }

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "PO Number": "PO-1001",
    "Transaction Date": "03/15/2026",
    "Vendor Item No": "STK-6260-4",
    Description: "Triathlon Tibial Insert",
    Vendor: "Stryker",
    Category: "Joint Replacement",
    Quantity: "2",
    "Unit Cost": "$1,250.00",
    "Extended Price": "$2,500.00",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireFacility.mockResolvedValue({ user: { id: "user-fac-1" }, facility: { id: "fac-1" } })
  bulkImportCOGRecords.mockResolvedValue(BULK_RESULT)
  mapColumnsWithAI.mockResolvedValue(FULL_MAPPING)
  auditLogCreate.mockResolvedValue({ id: "audit-1" })
})

function bulkInput(): { facilityId: string; records: Record<string, unknown>[]; duplicateStrategy: string } {
  const call = bulkImportCOGRecords.mock.calls[0]
  if (!call) throw new Error("bulkImportCOGRecords was not called")
  return call[0] as { facilityId: string; records: Record<string, unknown>[]; duplicateStrategy: string }
}

describe("ingestCOGRecordsRows", () => {
  it("returns an all-zero result for no rows without mapping, auth, or writes", async () => {
    expect(await ingestCOGRecordsRows([], "empty.csv")).toEqual({
      imported: 0,
      overwritten: 0,
      skipped: 0,
      errors: 0,
      matched: 0,
      unmatched: 0,
      onContractRate: 0,
    })
    expect(mapColumnsWithAI).not.toHaveBeenCalled()
    expect(requireFacility).not.toHaveBeenCalled()
    expect(bulkImportCOGRecords).not.toHaveBeenCalled()
  })

  it("asks the column mapper for every COG target field using the first row's headers and all rows", async () => {
    const rows = [row(), row({ "PO Number": "PO-1002" })]
    await ingestCOGRecordsRows(rows, "cog.csv")
    expect(mapColumnsWithAI).toHaveBeenCalledTimes(1)
    const [headers, targets, sample] = mapColumnsWithAI.mock.calls[0]! as [string[], { key: string; required: boolean }[], unknown]
    expect(headers).toEqual(Object.keys(rows[0]!))
    expect(targets.map((t) => t.key)).toEqual([
      "vendorName",
      "transactionDate",
      "description",
      "refNumber",
      "quantity",
      "unitCost",
      "extended",
      "poNumber",
      "multiplier",
      "category",
    ])
    expect(targets.filter((t) => t.required).map((t) => t.key)).toEqual(["vendorName", "transactionDate"])
    expect(sample).toBe(rows)
  })

  it("converts mapped rows into bulk-import records with money, date, and quantity parsing", async () => {
    await ingestCOGRecordsRows(
      [row(), row({ "Transaction Date": "2026-01-05T00:00:00.000Z", Quantity: "1", "Unit Cost": "99.5", "Extended Price": "", Category: "" })],
      "cog.xlsx",
    )
    expect(bulkImportCOGRecords).toHaveBeenCalledWith({
      facilityId: "fac-1",
      duplicateStrategy: "skip",
      records: [
        {
          vendorName: "Stryker",
          inventoryNumber: "STK-6260-4",
          inventoryDescription: "Triathlon Tibial Insert",
          vendorItemNo: "STK-6260-4",
          poNumber: "PO-1001",
          category: "Joint Replacement",
          unitCost: 1250,
          extendedPrice: 2500,
          quantity: 2,
          transactionDate: "2026-03-15T00:00:00.000Z",
        },
        {
          vendorName: "Stryker",
          inventoryNumber: "STK-6260-4",
          inventoryDescription: "Triathlon Tibial Insert",
          vendorItemNo: "STK-6260-4",
          poNumber: "PO-1001",
          category: undefined,
          unitCost: 99.5,
          extendedPrice: 99.5,
          quantity: 1,
          transactionDate: "2026-01-05T00:00:00.000Z",
        },
      ],
    })
  })

  it("multiplies unit cost by quantity and a mapped multiplier when no extended column is present", async () => {
    mapColumnsWithAI.mockResolvedValue({ ...FULL_MAPPING, extended: "", multiplier: "Conversion Factor Ordered" })
    await ingestCOGRecordsRows([row({ Quantity: "3", "Unit Cost": "10.50", "Conversion Factor Ordered": "x4" })])
    expect(bulkInput().records[0]).toMatchObject({ unitCost: 10.5, quantity: 3, extendedPrice: 126 })
  })

  it("lets an explicit extended price win over the multiplier", async () => {
    mapColumnsWithAI.mockResolvedValue({ ...FULL_MAPPING, multiplier: "Conversion Factor Ordered" })
    await ingestCOGRecordsRows([row({ "Conversion Factor Ordered": "10" })])
    expect(bulkInput().records[0]).toMatchObject({ extendedPrice: 2500 })
  })

  it("defaults a blank or non-numeric quantity to 1 and truncates a fractional one", async () => {
    await ingestCOGRecordsRows([row({ Quantity: "" }), row({ Quantity: "each" }), row({ Quantity: "2.7" })])
    expect(bulkInput().records.map((r) => r.quantity)).toEqual([1, 1, 2])
  })

  it("falls back from a missing catalog number to the description, and from both to placeholders", async () => {
    await ingestCOGRecordsRows([
      row({ "Vendor Item No": "" }),
      row({ "Vendor Item No": "", Description: "" }),
    ])
    const [descOnly, neither] = bulkInput().records
    expect(descOnly).toMatchObject({
      inventoryNumber: "Triathlon Tibial Insert",
      inventoryDescription: "Triathlon Tibial Insert",
      vendorItemNo: undefined,
    })
    expect(neither).toMatchObject({ inventoryNumber: "Stryker", inventoryDescription: "Unknown item", vendorItemNo: undefined })
  })

  it("drops rows without a vendor or a parseable date", async () => {
    await ingestCOGRecordsRows([row({ Vendor: "" }), row({ "Transaction Date": "TBD" }), row({ "PO Number": "PO-KEEP" })])
    expect(bulkInput().records).toHaveLength(1)
    expect(bulkInput().records[0]).toMatchObject({ poNumber: "PO-KEEP" })
  })

  it("reports every row skipped and never authenticates or writes when no row is importable", async () => {
    const result = await ingestCOGRecordsRows([row({ Vendor: "" }), row({ "Transaction Date": "" })])
    expect(result).toEqual({ imported: 0, overwritten: 0, skipped: 2, errors: 0, matched: 0, unmatched: 0, onContractRate: 0 })
    expect(requireFacility).not.toHaveBeenCalled()
    expect(bulkImportCOGRecords).not.toHaveBeenCalled()
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  it("imports into the caller's own facility and returns the bulk-import result", async () => {
    requireFacility.mockResolvedValue({ user: { id: "user-x" }, facility: { id: "fac-lighthouse" } })
    expect(await ingestCOGRecordsRows([row()], "cog.csv")).toEqual(BULK_RESULT)
    expect(bulkInput().facilityId).toBe("fac-lighthouse")
  })

  it("writes an audit log with the result, file name, and source row count", async () => {
    await ingestCOGRecordsRows([row(), row(), row({ Vendor: "" })], "Primary COG.xlsx")
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-fac-1",
        action: "cog.imported_via_mass_upload",
        entityType: "cog_record",
        entityId: null,
        metadata: { ...BULK_RESULT, fileName: "Primary COG.xlsx", rowCount: 3 },
        ipAddress: null,
      },
    })
  })

  it("records a null file name in the audit log when none is given", async () => {
    await ingestCOGRecordsRows([row()])
    const arg = auditLogCreate.mock.calls[0]![0] as { data: { metadata: { fileName: string | null } } }
    expect(arg.data.metadata.fileName).toBeNull()
  })

  it("revalidates the COG data page after a successful import", async () => {
    await ingestCOGRecordsRows([row()])
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/cog-data")
  })

  it("propagates a bulk-import failure without writing an audit log", async () => {
    bulkImportCOGRecords.mockRejectedValue(new Error("Import failed: unique constraint"))
    await expect(ingestCOGRecordsRows([row()])).rejects.toThrow("Import failed: unique constraint")
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  it("propagates a requireFacility denial without importing", async () => {
    requireFacility.mockRejectedValue(new Error("Your account isn't linked to a facility yet."))
    await expect(ingestCOGRecordsRows([row()])).rejects.toThrow("linked to a facility")
    expect(bulkImportCOGRecords).not.toHaveBeenCalled()
  })

  it.fails("authenticates before calling the AI column mapper (an unauthenticated direct action call spends an Anthropic request)", async () => {
    requireFacility.mockRejectedValue(new Error("Your session has expired."))
    await expect(ingestCOGRecordsRows([row()])).rejects.toThrow()
    expect(mapColumnsWithAI).not.toHaveBeenCalled()
  })

  it.fails("counts rows dropped for a missing vendor or date in the skipped total when other rows import", async () => {
    const result = await ingestCOGRecordsRows([row(), row({ Vendor: "" }), row({ "Transaction Date": "" })])
    expect(result.skipped).toBe(BULK_RESULT.skipped + 2)
  })
})

describe("ingestCOGRecordsCSV", () => {
  it("parses CSV text and runs it through the same row pipeline", async () => {
    const csv = "Vendor,Transaction Date,Unit Cost,Quantity\nArthrex,2026-02-01,\"$1,000.00\",3\n"
    mapColumnsWithAI.mockResolvedValue({ vendorName: "Vendor", transactionDate: "Transaction Date", unitCost: "Unit Cost", quantity: "Quantity" })
    await ingestCOGRecordsCSV(csv, "a.csv")
    expect(mapColumnsWithAI.mock.calls[0]![0]).toEqual(["Vendor", "Transaction Date", "Unit Cost", "Quantity"])
    expect(bulkInput().records).toEqual([
      {
        vendorName: "Arthrex",
        inventoryNumber: "Arthrex",
        inventoryDescription: "Unknown item",
        vendorItemNo: undefined,
        poNumber: undefined,
        category: undefined,
        unitCost: 1000,
        extendedPrice: 3000,
        quantity: 3,
        transactionDate: "2026-02-01T00:00:00.000Z",
      },
    ])
  })
})
