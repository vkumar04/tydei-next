"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"

interface ExportPDFOptions {
  type: "contract" | "rebate" | "surgeon"
  id?: string
  facilityId?: string
  surgeonName?: string
  dateRange?: { from: string; to: string }
}

export function useExportPDF() {
  const [isExporting, setIsExporting] = useState(false)

  const exportPDF = useCallback(async (options: ExportPDFOptions) => {
    setIsExporting(true)
    try {
      const response = await fetch("/api/reports/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Export failed" }))
        throw new Error((error as { error?: string }).error ?? "Export failed")
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get("Content-Disposition")
      const filenameMatch = contentDisposition?.match(/filename="?([^"]+)"?/)
      const filename = filenameMatch?.[1] ?? `report-${options.type}.pdf`

      // Trigger browser download
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success("PDF exported successfully")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to export PDF"
      toast.error(message)
    } finally {
      setIsExporting(false)
    }
  }, [])

  return { exportPDF, isExporting }
}
