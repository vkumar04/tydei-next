"use client"

import { Download, Plus, ScanLine, Search } from "lucide-react"
import type { POStatus } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Horizontal control bar for the PO list. Consolidates what used to be
 * a separate Filters card and a header CTA row into one elevated toolbar:
 *
 *   [Search] [Vendor filter] [Status filter] [Scan] [Export] [New PO]
 *
 * Status tabs live above the control bar as the primary navigation; the
 * status Select here is retained for granular filtering (e.g., Draft,
 * Cancelled) that isn't surfaced by the top-level tabs.
 */
export interface POVendorOption {
  id: string
  name: string
}

export interface POControlBarProps {
  searchQuery: string
  onSearchQueryChange: (next: string) => void
  status: POStatus | "all"
  onStatusChange: (next: POStatus | "all") => void
  vendorId: string
  onVendorIdChange: (next: string) => void
  vendors: POVendorOption[]
  onScan: () => void
  onExport: () => void
  onNewPO: () => void
}

const STATUS_OPTIONS: { label: string; value: POStatus | "all" }[] = [
  { label: "All Status", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Sent", value: "sent" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
]

export function POControlBar({
  searchQuery,
  onSearchQueryChange,
  status,
  onStatusChange,
  vendorId,
  onVendorIdChange,
  vendors,
  onScan,
  onExport,
  onNewPO,
}: POControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search purchase orders"
          placeholder="Search by PO ID or vendor..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={vendorId} onValueChange={onVendorIdChange}>
          <SelectTrigger className="w-[180px]">
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

        <Select
          value={status}
          onValueChange={(v) => onStatusChange(v as POStatus | "all")}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Status" />
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

        <Button variant="outline" size="sm" onClick={onScan}>
          <ScanLine className="mr-2 h-4 w-4" />
          Scan PO
        </Button>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
        <Button size="sm" onClick={onNewPO}>
          <Plus className="mr-2 h-4 w-4" />
          New PO
        </Button>
      </div>
    </div>
  )
}
