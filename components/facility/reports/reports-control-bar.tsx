"use client"

import { useMemo } from "react"
import { CalendarClock, Filter } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DateRangePicker } from "@/components/shared/forms/date-range-picker"
import type { ReportsContract, ReportsDateRange } from "./reports-types"

/**
 * Flat control bar for the Reports hub — uses a theme-token row
 * that matches the hero-plane vocabulary used by Analysis, Rebate
 * Optimizer, Contracts, and Dashboard.
 *
 * Cascades (unchanged from the old filter bar):
 *   - Vendor selection filters the contract dropdown and resets
 *     `selectedContractId` to "all".
 *   - Contract selection informs the parent (which auto-routes to
 *     the matching per-type tab).
 *
 * Adds a "New Schedule" CTA aligned right.
 */
export interface ReportsControlBarProps {
  dateRange: ReportsDateRange
  onDateRangeChange: (range: ReportsDateRange) => void
  selectedVendorId: string
  onVendorChange: (vendorId: string) => void
  selectedContractId: string
  onContractChange: (contractId: string) => void
  vendors: { id: string; name: string }[]
  contracts: ReportsContract[]
  onOpenScheduledReports: () => void
}

const DATE_PRESETS: { label: string; months: number }[] = [
  { label: "30D", months: 1 },
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "12M", months: 12 },
]

function presetRange(months: number): ReportsDateRange {
  const to = new Date()
  const from = new Date()
  from.setMonth(from.getMonth() - months)
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  }
}

export function ReportsControlBar({
  dateRange,
  onDateRangeChange,
  selectedVendorId,
  onVendorChange,
  selectedContractId,
  onContractChange,
  vendors,
  contracts,
  onOpenScheduledReports,
}: ReportsControlBarProps) {
  const filteredContracts = useMemo(() => {
    if (selectedVendorId === "all") return contracts
    return contracts.filter((c) => c.vendorId === selectedVendorId)
  }, [contracts, selectedVendorId])

  const selectedContract = useMemo(
    () => contracts.find((c) => c.id === selectedContractId) ?? null,
    [contracts, selectedContractId],
  )

  const presets = DATE_PRESETS.map((p) => ({
    label: p.label,
    range: presetRange(p.months),
  }))

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          Filters
        </div>

        <DateRangePicker
          dateRange={dateRange}
          onDateRangeChange={onDateRangeChange}
          presets={presets}
        />

        <Select value={selectedVendorId} onValueChange={onVendorChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Vendors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vendors</SelectItem>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedContractId} onValueChange={onContractChange}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="All Contracts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Contracts</SelectItem>
            {filteredContracts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <div className="flex items-center gap-2">
                  <span>{c.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {c.contractType}
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onOpenScheduledReports}
            className="gap-2"
          >
            <CalendarClock className="h-4 w-4" />
            Schedules
          </Button>
        </div>
      </div>

      {selectedContract && (
        <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Selected:</span>
            <span className="font-medium">{selectedContract.name}</span>
            <Badge
              variant={
                selectedContract.status === "active" ? "default" : "secondary"
              }
            >
              {selectedContract.status}
            </Badge>
          </div>
          <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
            {selectedContract.contractType} Contract
          </Badge>
        </div>
      )}
    </section>
  )
}
