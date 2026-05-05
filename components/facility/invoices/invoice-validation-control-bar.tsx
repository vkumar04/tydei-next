"use client"

import { Flag, Package, Search, Upload } from "lucide-react"
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
 * Horizontal control bar for the Invoice Validation page. Mirrors
 * `OptimizerControlBar` — search, vendor filter, dispute-only toggle,
 * "Upload invoice" + "Export" CTAs live inline so the tabs below don't
 * carry a per-panel filter row.
 *
 * The tab strip itself owns the status axis (awaiting / flagged /
 * approved / disputed); the top-level `statusFilter` from the old
 * layout is consumed by the tab handler.
 */
interface Vendor {
  id: string
  name: string
}

export interface InvoiceValidationControlBarProps {
  vendors: Vendor[]
  searchQuery: string
  onSearchQueryChange: (next: string) => void
  vendorFilter: string
  onVendorFilterChange: (next: string) => void
  disputeFilter: "all" | "disputed"
  onDisputeFilterChange: (next: "all" | "disputed") => void
  onImportClick: () => void
}

export function InvoiceValidationControlBar({
  vendors,
  searchQuery,
  onSearchQueryChange,
  vendorFilter,
  onVendorFilterChange,
  disputeFilter,
  onDisputeFilterChange,
  onImportClick,
}: InvoiceValidationControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="relative flex min-w-[220px] flex-1 items-center">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search invoices or vendors..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          className="border-0 bg-transparent pl-9 shadow-none focus-visible:ring-0"
        />
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex min-w-[200px] items-center gap-2">
        <Label
          htmlFor="iv-vendor-filter"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          <Package className="mr-1 inline h-3.5 w-3.5" />
          Vendor
        </Label>
        <Select value={vendorFilter} onValueChange={onVendorFilterChange}>
          <SelectTrigger
            id="iv-vendor-filter"
            className="border-0 shadow-none focus-visible:ring-0"
          >
            <SelectValue placeholder="All vendors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vendors</SelectItem>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex min-w-[180px] items-center gap-2">
        <Label
          htmlFor="iv-dispute-filter"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          <Flag className="mr-1 inline h-3.5 w-3.5" />
          Dispute
        </Label>
        <Select
          value={disputeFilter}
          onValueChange={(v) =>
            onDisputeFilterChange(v as "all" | "disputed")
          }
        >
          <SelectTrigger
            id="iv-dispute-filter"
            className="border-0 shadow-none focus-visible:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="disputed">Disputed only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={onImportClick}>
          <Upload className="h-4 w-4" />
          Upload invoice
        </Button>
      </div>
    </div>
  )
}
