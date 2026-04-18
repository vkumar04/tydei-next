"use client"

import { useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Filter } from "lucide-react"
import { DateRangePicker } from "@/components/shared/forms/date-range-picker"
import type { ReportsDateRange, ReportsContract } from "./reports-types"

/**
 * Vendor + Contract + Date-range cascading filter bar for the reports hub.
 *
 * Cascades:
 *   - Selecting a vendor filters the contract dropdown to that vendor's
 *     contracts and resets `selectedContractId` to "all".
 *   - Selecting a contract informs the orchestrator (which auto-routes
 *     to the matching per-type tab).
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.1
 */
export interface ReportsFilterBarProps {
  dateRange: ReportsDateRange
  onDateRangeChange: (range: ReportsDateRange) => void
  selectedVendorId: string
  onVendorChange: (vendorId: string) => void
  selectedContractId: string
  onContractChange: (contractId: string) => void
  vendors: { id: string; name: string }[]
  contracts: ReportsContract[]
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

export function ReportsFilterBar({
  dateRange,
  onDateRangeChange,
  selectedVendorId,
  onVendorChange,
  selectedContractId,
  onContractChange,
  vendors,
  contracts,
}: ReportsFilterBarProps) {
  // Contracts filtered by selected vendor.
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
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters:</span>
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
        </div>

        {selectedContract && (
          <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Selected:</span>
              <span className="font-medium">{selectedContract.name}</span>
              <Badge
                variant={
                  selectedContract.status === "active"
                    ? "default"
                    : "secondary"
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
      </CardContent>
    </Card>
  )
}
