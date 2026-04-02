"use client"

import { Button } from "@/components/ui/button"
import { Clock, Download } from "lucide-react"

/* ─── Props ──────────────────────────────────────────────────── */

export interface ReportsHeaderProps {
  isExporting: boolean
  onScheduleClick: () => void
  onExportClick: () => void
}

/* ─── Component ──────────────────────────────────────────────── */

export function ReportsHeader({
  isExporting,
  onScheduleClick,
  onExportClick,
}: ReportsHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
        <p className="text-muted-foreground">
          Contract performance reports with scheduled delivery
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="gap-2" onClick={onScheduleClick}>
          <Clock className="h-4 w-4" />
          Schedule Report
        </Button>
        <Button
          className="gap-2"
          disabled={isExporting}
          onClick={onExportClick}
        >
          <Download className="h-4 w-4" />
          {isExporting ? "Exporting..." : "Export PDF"}
        </Button>
      </div>
    </div>
  )
}
