/**
 * COG import history formatter.
 *
 * Reference: docs/superpowers/specs/2026-04-18-cog-data-rewrite.md §4.5
 *
 * Pure function: takes FileImport rows from the DB and formats them
 * into the UI-friendly shape used by the COG page's "Import History"
 * section. No DB access; caller loads the rows.
 */

export type FileImportStatus = "processing" | "completed" | "failed"

export interface FileImportRow {
  id: string
  fileType: "cog" | "pricing" | "invoice"
  fileName: string
  recordCount: number | null
  onContractSpend: number | null
  offContractSpend: number | null
  totalSavings: number | null
  matchedRecords: number | null
  unmatchedRecords: number | null
  errorCount: number
  warningCount: number
  status: FileImportStatus
  createdAt: Date
  createdBy: string | null
  processingDurationMs: number | null
}

export interface ImportHistoryRow {
  id: string
  fileName: string
  fileType: FileImportRow["fileType"]
  uploadedAt: Date
  uploadedBy: string | null
  status: FileImportStatus
  /** Human-readable status label with warning/error counts when present. */
  statusLabel: string
  recordCount: number
  matchRate: number | null   // matched / recordCount × 100; null when recordCount is 0
  processingDurationSec: number | null
  savingsLabel: string | null
}

/**
 * Format a single FileImport row into the list shape.
 */
export function formatImportRow(row: FileImportRow): ImportHistoryRow {
  const recordCount = row.recordCount ?? 0
  const matchRate =
    recordCount > 0
      ? ((row.matchedRecords ?? 0) / recordCount) * 100
      : null

  const baseStatus =
    row.status === "completed"
      ? "Completed"
      : row.status === "processing"
        ? "Processing"
        : "Failed"

  const statusSuffix: string[] = []
  if (row.errorCount > 0) statusSuffix.push(`${row.errorCount} errors`)
  if (row.warningCount > 0) statusSuffix.push(`${row.warningCount} warnings`)
  const statusLabel =
    statusSuffix.length > 0
      ? `${baseStatus} · ${statusSuffix.join(", ")}`
      : baseStatus

  const processingDurationSec =
    row.processingDurationMs === null ? null : row.processingDurationMs / 1000

  const savingsLabel =
    row.totalSavings === null
      ? null
      : row.totalSavings >= 0
        ? `Saved $${Math.round(row.totalSavings).toLocaleString("en-US")}`
        : `Overspent $${Math.round(Math.abs(row.totalSavings)).toLocaleString("en-US")}`

  return {
    id: row.id,
    fileName: row.fileName,
    fileType: row.fileType,
    uploadedAt: row.createdAt,
    uploadedBy: row.createdBy,
    status: row.status,
    statusLabel,
    recordCount,
    matchRate,
    processingDurationSec,
    savingsLabel,
  }
}

/**
 * Format + sort a list of FileImport rows (newest first by uploadedAt).
 */
export function formatImportHistory(rows: FileImportRow[]): ImportHistoryRow[] {
  return rows
    .map(formatImportRow)
    .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
}
