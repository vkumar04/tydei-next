"use client"

import { useMemo } from "react"
import { Filter } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DateRangePicker } from "@/components/shared/forms/date-range-picker"
import type {
  ReportsDateRange,
  VendorReportsContract,
} from "./vendor-reports-types"

/**
 * Flat control bar for the Vendor Reports Hub — mirror of the facility
 * `ReportsControlBar`, vendor-scoped.
 *
 * Differences from the facility original:
 *   - The FIRST filter is **Facility** (replacing the facility hub's
 *     "Vendor" filter) — a vendor's contracts span multiple facilities.
 *     Options come from `getVendorRelatedFacilities()`.
 *   - The SECOND filter is **Contract**, which cascades: changing the
 *     facility filters the contract dropdown and resets the contract
 *     selection to "all".
 *   - No schedules CTA (the vendor hub has no schedule surface yet).
 */
export interface VendorReportsControlBarProps {
  dateRange: ReportsDateRange
  onDateRangeChange: (range: ReportsDateRange) => void
  selectedFacilityId: string
  onFacilityChange: (facilityId: string) => void
  selectedContractId: string
  onContractChange: (contractId: string) => void
  facilities: { id: string; name: string }[]
  contracts: VendorReportsContract[]
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

export function VendorReportsControlBar({
  dateRange,
  onDateRangeChange,
  selectedFacilityId,
  onFacilityChange,
  selectedContractId,
  onContractChange,
  facilities,
  contracts,
}: VendorReportsControlBarProps) {
  const filteredContracts = useMemo(() => {
    if (selectedFacilityId === "all") return contracts
    return contracts.filter((c) => c.facilityId === selectedFacilityId)
  }, [contracts, selectedFacilityId])

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

        <Select value={selectedFacilityId} onValueChange={onFacilityChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
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
      </div>

      {selectedContract && (
        <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Selected:</span>
            <span className="font-medium">{selectedContract.name}</span>
            <span className="text-muted-foreground">
              · {selectedContract.facilityName}
            </span>
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
