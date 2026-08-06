import { jsPDF } from "jspdf"
import { formatCurrency } from "@/lib/formatting"

// ─── jspdf-autotable extends the doc with lastAutoTable ──────────

interface AutoTableDoc extends jsPDF {
  lastAutoTable?: { finalY: number }
}

export function getFinalY(doc: jsPDF, fallback: number): number {
  return (doc as AutoTableDoc).lastAutoTable?.finalY ?? fallback
}

export function toBytes(doc: jsPDF): Uint8Array {
  const buf = doc.output("arraybuffer")
  return new Uint8Array(buf)
}

// ─── Helpers ──────────────────────────────────────────────────────

export const fmtCurrency = formatCurrency

export function fmtDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date))
}

export function addHeader(doc: jsPDF, title: string, subtitle?: string) {
  // Brand header bar
  doc.setFillColor(15, 23, 42) // slate-900
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 28, "F")

  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.setTextColor(255, 255, 255)
  doc.text("TYDEi", 14, 14)

  doc.setFontSize(9)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(200, 200, 200)
  doc.text(`Generated ${fmtDate(new Date())}`, doc.internal.pageSize.getWidth() - 14, 14, {
    align: "right",
  })

  // Title
  doc.setTextColor(15, 23, 42)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  doc.text(title, 14, 40)

  if (subtitle) {
    doc.setFont("helvetica", "normal")
    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text(subtitle, 14, 48)
  }
}

export function addFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150, 150, 150)
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: "center" }
    )
    doc.text(
      "Confidential - TYDEi Platform",
      14,
      doc.internal.pageSize.getHeight() - 10
    )
  }
}
