"use client"

import { Download, FileSpreadsheet, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PO_STATUSES } from "@/lib/purchase-orders/status-flow"
import { poStatusConfig } from "./types"

/**
 * Horizontal control bar for the vendor PO list. Top-level status tabs
 * cover the common partitions; this bar carries search, a facility
 * filter, a granular status Select (for Draft / Cancelled / etc. that
 * aren't in the tabs), export, and the primary "Add PO" CTA.
 */
export interface POFacilityOption {
  id: string
  name: string
}

export interface VendorPOControlBarProps {
  searchQuery: string
  onSearchQueryChange: (next: string) => void
  facilityId: string
  onFacilityIdChange: (next: string) => void
  facilities: POFacilityOption[]
  statusFilter: string
  onStatusFilterChange: (next: string) => void
  onExportCSV: () => void
  onAddPO: () => void
}

// M10 (2026-06-09 audit): options are derived from the real POStatus enum
// values (via the canonical status-flow module) — the old hand-rolled list
// carried phantom statuses (pending_approval, acknowledged, processing,
// shipped, fulfilled, rejected) that never exist in the DB and matched
// nothing when selected.
const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: "All Statuses", value: "all" },
  ...PO_STATUSES.map((s) => ({
    label: poStatusConfig[s]?.label ?? s,
    value: s,
  })),
]

export function VendorPOControlBar({
  searchQuery,
  onSearchQueryChange,
  facilityId,
  onFacilityIdChange,
  facilities,
  statusFilter,
  onStatusFilterChange,
  onExportCSV,
  onAddPO,
}: VendorPOControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search purchase orders"
          placeholder="Search by PO ID or facility..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={facilityId} onValueChange={onFacilityIdChange}>
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

        <Select value={statusFilter} onValueChange={onStatusFilterChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Separator orientation="vertical" className="hidden h-6 sm:block" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExportCSV}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Export as CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" onClick={onAddPO} className="gap-2">
          <Plus className="h-4 w-4" />
          Add PO
        </Button>
      </div>
    </div>
  )
}
