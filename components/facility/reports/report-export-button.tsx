"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Download, Loader2 } from "lucide-react"
import { exportReportCSV } from "@/lib/actions/reports"
import { toast } from "sonner"

interface ReportExportButtonProps {
  facilityId: string
  reportType: string
  dateFrom: string
  dateTo: string
}

export function ReportExportButton({ facilityId, reportType, dateFrom, dateTo }: ReportExportButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const csv = await exportReportCSV({ facilityId, reportType, dateFrom, dateTo })
      const blob = new Blob([csv], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${reportType}-report-${dateFrom}-${dateTo}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Report exported successfully")
    } catch {
      toast.error("Failed to export report")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
      {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Download className="mr-2 size-4" />}
      Export CSV
    </Button>
  )
}
