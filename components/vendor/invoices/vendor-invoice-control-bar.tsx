"use client"

import { Building2, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
 * Horizontal control bar for the Vendor Invoices page. Mirrors the
 * facility `InvoiceValidationControlBar` — search, facility filter, and
 * "New invoice" CTA live inline so the tab strip below only owns the
 * status axis (draft / sent / paid / disputed).
 */
interface FacilityOption {
  id: string
  name: string
}

export interface VendorInvoiceControlBarProps {
  facilities: FacilityOption[]
  searchQuery: string
  onSearchQueryChange: (next: string) => void
  facilityFilter: string
  onFacilityFilterChange: (next: string) => void
  onNewInvoiceClick: () => void
}

export function VendorInvoiceControlBar({
  facilities,
  searchQuery,
  onSearchQueryChange,
  facilityFilter,
  onFacilityFilterChange,
  onNewInvoiceClick,
}: VendorInvoiceControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="relative flex min-w-[220px] flex-1 items-center">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search invoices or facilities..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0"
        />
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex min-w-[220px] items-center gap-2">
        <Label
          htmlFor="vi-facility-filter"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          <Building2 className="mr-1 inline h-3.5 w-3.5" />
          Facility
        </Label>
        <Select value={facilityFilter} onValueChange={onFacilityFilterChange}>
          <SelectTrigger
            id="vi-facility-filter"
            className="border-0 shadow-none focus-visible:ring-0"
          >
            <SelectValue placeholder="All facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All facilities</SelectItem>
            {facilities.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" className="gap-2" onClick={onNewInvoiceClick}>
          <Plus className="h-4 w-4" />
          New invoice
        </Button>
      </div>
    </div>
  )
}
