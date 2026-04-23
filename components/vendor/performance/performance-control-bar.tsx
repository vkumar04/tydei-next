"use client"

import { Calendar, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Horizontal control bar for the vendor Performance page. Houses the
 * time-range selector and the export action so the tabs below are
 * uncluttered.
 */
export interface PerformanceControlBarProps {
  timeRange: string
  onTimeRangeChange: (next: string) => void
  contractCount: number
  facilityCount: number
}

export function PerformanceControlBar({
  timeRange,
  onTimeRangeChange,
  contractCount,
  facilityCount,
}: PerformanceControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="flex min-w-[220px] items-center gap-2">
        <Label
          htmlFor="perf-time-range"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          <Calendar className="mr-1 inline h-3.5 w-3.5" />
          Range
        </Label>
        <Select value={timeRange} onValueChange={onTimeRangeChange}>
          <SelectTrigger
            id="perf-time-range"
            className="border-0 shadow-none focus-visible:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mtd">Month to Date</SelectItem>
            <SelectItem value="qtd">Quarter to Date</SelectItem>
            <SelectItem value="ytd">Year to Date</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-6">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Contracts
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {contractCount}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Facilities
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {facilityCount}
          </span>
        </div>
      </div>

      <Button variant="outline" size="sm" className="ml-auto gap-2">
        <Download className="h-4 w-4" />
        Export Report
      </Button>
    </div>
  )
}
