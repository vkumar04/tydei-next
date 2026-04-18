import { describe, it, expect } from "vitest"
import {
  formatImportRow,
  formatImportHistory,
  type FileImportRow,
} from "../import-history-formatter"

const baseRow = (overrides: Partial<FileImportRow> = {}): FileImportRow => ({
  id: "imp-1",
  fileType: "cog",
  fileName: "cog-2026-q1.csv",
  recordCount: 1000,
  onContractSpend: 50_000,
  offContractSpend: 10_000,
  totalSavings: 5_000,
  matchedRecords: 900,
  unmatchedRecords: 100,
  errorCount: 0,
  warningCount: 0,
  status: "completed",
  createdAt: new Date("2026-03-15T12:00:00Z"),
  createdBy: "user-123",
  processingDurationMs: 12_500,
  ...overrides,
})

describe("formatImportRow", () => {
  it("formats a completed row with full stats", () => {
    const r = formatImportRow(baseRow())
    expect(r).toMatchObject({
      id: "imp-1",
      fileName: "cog-2026-q1.csv",
      fileType: "cog",
      status: "completed",
      statusLabel: "Completed",
      recordCount: 1000,
      matchRate: 90, // 900/1000
      processingDurationSec: 12.5,
      savingsLabel: "Saved $5,000",
    })
  })

  it("appends errors + warnings to statusLabel", () => {
    const r = formatImportRow(
      baseRow({ errorCount: 3, warningCount: 2 }),
    )
    expect(r.statusLabel).toBe("Completed · 3 errors, 2 warnings")
  })

  it("shows only errors when only errors present", () => {
    const r = formatImportRow(baseRow({ errorCount: 5 }))
    expect(r.statusLabel).toBe("Completed · 5 errors")
  })

  it("handles processing status", () => {
    const r = formatImportRow(
      baseRow({ status: "processing", totalSavings: null }),
    )
    expect(r.status).toBe("processing")
    expect(r.statusLabel).toBe("Processing")
    expect(r.savingsLabel).toBeNull()
  })

  it("handles failed status", () => {
    const r = formatImportRow(
      baseRow({ status: "failed", errorCount: 1, recordCount: 0 }),
    )
    expect(r.status).toBe("failed")
    expect(r.statusLabel).toBe("Failed · 1 errors")
    expect(r.matchRate).toBeNull()
  })

  it("null recordCount treated as zero", () => {
    const r = formatImportRow(
      baseRow({ recordCount: null, matchedRecords: null }),
    )
    expect(r.recordCount).toBe(0)
    expect(r.matchRate).toBeNull()
  })

  it("formats negative totalSavings as Overspent", () => {
    const r = formatImportRow(baseRow({ totalSavings: -2_500 }))
    expect(r.savingsLabel).toBe("Overspent $2,500")
  })

  it("null totalSavings → null savingsLabel", () => {
    const r = formatImportRow(baseRow({ totalSavings: null }))
    expect(r.savingsLabel).toBeNull()
  })

  it("null processingDurationMs → null processingDurationSec", () => {
    const r = formatImportRow(baseRow({ processingDurationMs: null }))
    expect(r.processingDurationSec).toBeNull()
  })

  it("matchRate exact computation", () => {
    const r = formatImportRow(
      baseRow({ recordCount: 200, matchedRecords: 150 }),
    )
    expect(r.matchRate).toBe(75) // 150/200
  })
})

describe("formatImportHistory", () => {
  it("returns [] for empty input", () => {
    expect(formatImportHistory([])).toEqual([])
  })

  it("sorts newest first by createdAt", () => {
    const rows = [
      baseRow({ id: "old", createdAt: new Date("2026-01-01") }),
      baseRow({ id: "newest", createdAt: new Date("2026-04-18") }),
      baseRow({ id: "mid", createdAt: new Date("2026-03-15") }),
    ]
    const result = formatImportHistory(rows)
    expect(result.map((r) => r.id)).toEqual(["newest", "mid", "old"])
  })

  it("does not mutate input array", () => {
    const rows = [baseRow()]
    const ref = rows
    formatImportHistory(rows)
    expect(rows).toBe(ref)
    expect(rows).toHaveLength(1)
  })
})
