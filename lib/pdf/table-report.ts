import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { addFooter, addHeader, toBytes } from "./shared"

// ─── Generic tabular report ───────────────────────────────────────

export interface TableReportInput {
  title: string
  subtitle?: string
  /**
   * Plain-English explainer rendered above the table — tells the story of the
   * numbers (totals, counts) instead of leaving the reader to add up columns.
   */
  intro?: string
  /** Column headers, left → right. */
  head: string[]
  /** Pre-formatted string cells (caller applies $/%/date formatting). */
  rows: string[][]
  /** Indices of columns to right-align (numeric/currency). */
  numericColumns?: number[]
}

/**
 * One generic table → PDF, reusing the branded header/footer. Backs the vendor
 * Reports cards (Rebate Statement / Performance Summary / Contract Roster) so
 * they emit a real PDF server-side instead of only a CSV (Vick 2026-06-22).
 * Empty result sets render an explicit "No data for this period." row so the
 * PDF is never blank. Wide tables (>6 cols, e.g. the roster) go landscape.
 */
export function generateTableReportPDF(input: TableReportInput): Uint8Array {
  const doc = new jsPDF(
    input.head.length > 6 ? { orientation: "landscape" } : {},
  )
  addHeader(doc, input.title, input.subtitle)

  // Narrative explainer above the table — tells the story before the numbers.
  let startY = 56
  if (input.intro) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(60, 60, 60)
    const lines = doc.splitTextToSize(
      input.intro,
      doc.internal.pageSize.getWidth() - 28,
    ) as string[]
    doc.text(lines, 14, startY)
    startY += lines.length * 4.6 + 6
    doc.setTextColor(0, 0, 0)
  }

  const columnStyles: Record<number, { halign: "right" }> = {}
  for (const i of input.numericColumns ?? []) columnStyles[i] = { halign: "right" }

  autoTable(doc, {
    startY,
    head: [input.head],
    body:
      input.rows.length > 0
        ? input.rows
        : [["No data for this period.", ...input.head.slice(1).map(() => "")]],
    theme: "striped",
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    columnStyles,
  })

  addFooter(doc)
  return toBytes(doc)
}
