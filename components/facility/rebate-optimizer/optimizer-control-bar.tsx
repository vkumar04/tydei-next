"use client"

import Link from "next/link"
import { FileBarChart } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

/**
 * Horizontal control bar for the rebate-optimizer page. Mirrors
 * `AnalysisControlBar` — the vendor filter lives inline here so the
 * tabs below don't carry a per-panel filter row.
 */
export interface OptimizerControlBarProps {
  vendors: string[]
  vendorFilter: string
  onVendorFilterChange: (next: string) => void
  contractCount: number
}

export function RebateOptimizerControlBar({
  vendors,
  vendorFilter,
  onVendorFilterChange,
  contractCount,
}: OptimizerControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="flex min-w-[240px] flex-1 items-center gap-2">
        <Label
          htmlFor="vendor-filter"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          Vendor
        </Label>
        <Select value={vendorFilter} onValueChange={onVendorFilterChange}>
          <SelectTrigger
            id="vendor-filter"
            className="border-0 shadow-none focus-visible:ring-0"
          >
            <SelectValue placeholder="All vendors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vendors</SelectItem>
            {vendors.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
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
      </div>

      <Button variant="outline" size="sm" className="ml-auto gap-2" asChild>
        <Link href="/dashboard/reports">
          <FileBarChart className="h-4 w-4" />
          Rebate reports
        </Link>
      </Button>
    </div>
  )
}
