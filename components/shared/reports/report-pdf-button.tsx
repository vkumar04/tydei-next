"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

/**
 * "Download PDF" for the Contract Performance Details report. Shared by the
 * facility and vendor Reports Hubs — POSTs the current view (active per-type
 * tab + date range + optional drilled contract) to /api/reports/pdf, which
 * renders the header band + per-period tables server-side (jsPDF). Charts
 * are not embedded (table-fidelity export).
 *
 * `reportType === null` ⇒ the active tab isn't a contract-performance tab,
 * so the button is disabled.
 */

export type ReportPdfType = "usage" | "service" | "capital" | "tie_in" | "grouped"

interface ReportPdfButtonProps {
  scope: "facility" | "vendor"
  reportType: ReportPdfType | null
  dateRange: { from: string; to: string }
  /** Drill-down: export a single contract instead of all of this type. */
  contractId?: string
}

export function ReportPdfButton({
  scope,
  reportType,
  dateRange,
  contractId,
}: ReportPdfButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    if (!reportType) return
    setLoading(true)
    try {
      const res = await fetch("/api/reports/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "report",
          scope,
          reportType,
          dateRange,
          contractId: contractId && contractId !== "all" ? contractId : undefined,
        }),
      })
      if (!res.ok) {
        const msg = await res.json().catch(() => null)
        throw new Error(msg?.error ?? `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `contract-performance-${reportType}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success("PDF downloaded")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export PDF")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={loading || !reportType}
      title={
        reportType
          ? "Download this report as PDF"
          : "PDF export is available on the contract-performance tabs"
      }
      className="gap-2"
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Download className="size-4" />
      )}
      Download PDF
    </Button>
  )
}

/**
 * Maps a Reports-Hub tab key to the server reportType the PDF supports
 * (pricing-only shares the usage period shape). Returns null for tabs that
 * aren't per-contract-performance (overview / by-rebate-type / calculations).
 */
export function tabToPdfReportType(tab: string): ReportPdfType | null {
  switch (tab) {
    case "usage":
    case "pricing":
      return "usage"
    case "service":
      return "service"
    case "capital":
      return "capital"
    case "tie_in":
      return "tie_in"
    case "grouped":
      return "grouped"
    default:
      return null
  }
}
