/**
 * Tests for `ingestCOGRecordsCSV` — the CSV entry point for COG import.
 *
 * The action parses CSV + runs an AI column mapper, then delegates to
 * `bulkImportCOGRecords` which owns vendor resolution + dedup. We mock
 * both the delegate and the AI mapper so these tests exercise the
 * action's own control flow (parse → map → delegate → forward stats).
 *
 * The v0 parity wave (plan: 2026-04-19-v0-parity-wave-1, Task 5) added
 * matched / unmatched / onContractRate to the return shape. The test
 * here asserts those flow through unchanged from the delegate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const bulkImportMock = vi.fn()
const mapColumnsWithAIMock = vi.fn()
const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})
const revalidatePathMock = vi.fn()

vi.mock("@/lib/actions/cog-import", () => ({
  bulkImportCOGRecords: (args: unknown) => bulkImportMock(args),
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

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}))

// We only need a mapping helper + a few utilities. Re-implement the
// shared helpers with minimal behaviour; the real implementations call
// out to AI / Prisma which we don't want to hit here.
vi.mock("@/lib/actions/imports/shared", () => ({
  parseCSV: (text: string): Record<string, string>[] => {
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) return []
    const headers = lines[0]!.split(",").map((h) => h.trim())
    return lines.slice(1).map((line) => {
      const cells = line.split(",")
      const row: Record<string, string> = {}
      headers.forEach((h, i) => {
        row[h] = (cells[i] ?? "").trim()
      })
      return row
    })
  },
  parseMoney: (v: string) => {
    const cleaned = v?.replace(/[^0-9.-]/g, "") ?? ""
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : 0
  },
  parseDate: (v: string) => {
    if (!v) return null
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  },
  mapColumnsWithAI: (
    headers: string[],
    _targets: unknown,
    rows: unknown,
  ) => mapColumnsWithAIMock(headers, _targets, rows),
  get: (
    row: Record<string, string>,
    mapping: Record<string, string>,
    key: string,
  ) => {
    const source = mapping[key]
    if (!source) return ""
    return row[source] ?? ""
  },
}))

import { ingestCOGRecordsCSV } from "@/lib/actions/imports/cog-csv-import"

beforeEach(() => {
  vi.clearAllMocks()
  // Default mapping: columns are already named to match target keys.
  mapColumnsWithAIMock.mockResolvedValue({
    vendorName: "vendorName",
    transactionDate: "transactionDate",
    description: "description",
    refNumber: "refNumber",
    quantity: "quantity",
    unitCost: "unitCost",
    extended: "extended",
    poNumber: "poNumber",
  })
})

describe("ingestCOGRecordsCSV", () => {
  it("returns zeros for empty CSV without calling the bulk importer", async () => {
    const result = await ingestCOGRecordsCSV("", "empty.csv")

    expect(result).toEqual({
      imported: 0,
      skipped: 0,
      errors: 0,
      matched: 0,
      unmatched: 0,
      onContractRate: 0,
    })
    expect(bulkImportMock).not.toHaveBeenCalled()
  })

  it("forwards matched / unmatched / onContractRate stats from the delegate", async () => {
    // The bulk importer is what computes the enrichment stats in the
    // real implementation; here we just assert the CSV action propagates
    // them back to the caller (dialog) unchanged.
    bulkImportMock.mockResolvedValue({
      imported: 3,
      skipped: 0,
      errors: 0,
      matched: 2,
      unmatched: 1,
      onContractRate: 2 / 3,
    })

    const csv = [
      "vendorName,transactionDate,description,refNumber,quantity,unitCost,extended,poNumber",
      "Stryker,2026-01-15,Hip Implant,STK-001,1,4500,4500,PO-1",
      "Medtronic,2026-01-16,Spinal Screw,MDT-002,2,520,1040,PO-2",
      "Zimmer,2026-01-17,Knee Implant,ZB-003,1,4800,4800,PO-3",
    ].join("\n")

    const result = await ingestCOGRecordsCSV(csv, "cog.csv")

    expect(bulkImportMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      imported: 3,
      skipped: 0,
      errors: 0,
      matched: 2,
      unmatched: 1,
    })
    expect(result.onContractRate).toBeCloseTo(2 / 3, 5)
    // Shape contract with the import dialog — must include all three fields.
    expect(result).toHaveProperty("matched")
    expect(result).toHaveProperty("unmatched")
    expect(result).toHaveProperty("onContractRate")
  })
})
