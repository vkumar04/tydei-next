"use client"

/**
 * Control bar for the facility Renewals page.
 *
 * Mirrors the shape used by the Analysis and Rebate-Optimizer pages —
 * a single horizontal `rounded-lg border bg-card` strip that carries
 * the page-level filters (status, vendor) plus the search input and
 * the secondary actions (Export Calendar, Alert Settings). Sits below
 * the hero and above the tabs.
 */

import {
  Calendar,
  Search,
  Settings2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import type { StatusFilter } from "./renewals-filter-bar"

export interface RenewalsControlBarProps {
  status: StatusFilter
  onStatusChange: (next: StatusFilter) => void
  vendors: string[]
  vendorFilter: string
  onVendorFilterChange: (next: string) => void
  search: string
  onSearchChange: (next: string) => void
  onExportCalendar: () => void
  onOpenSettings: () => void
  counts: {
    all: number
    critical: number
    warning: number
    upcoming: number
    ok: number
  }
}

export function RenewalsControlBar({
  status,
  onStatusChange,
  vendors,
  vendorFilter,
  onVendorFilterChange,
  search,
  onSearchChange,
  onExportCalendar,
  onOpenSettings,
  counts,
}: RenewalsControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="flex items-center gap-2">
        <Label
          htmlFor="renewal-status"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          Status
        </Label>
        <Select
          value={status}
          onValueChange={(v) => onStatusChange(v as StatusFilter)}
        >
          <SelectTrigger
            id="renewal-status"
            className="h-9 min-w-[160px] border-0 shadow-none focus-visible:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({counts.all})</SelectItem>
            <SelectItem value="critical">
              Critical ({counts.critical})
            </SelectItem>
            <SelectItem value="warning">Warning ({counts.warning})</SelectItem>
            <SelectItem value="upcoming">
              Upcoming ({counts.upcoming})
            </SelectItem>
            <SelectItem value="ok">On Track ({counts.ok})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-2">
        <Label
          htmlFor="renewal-vendor"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          Vendor
        </Label>
        <Select
          value={vendorFilter}
          onValueChange={onVendorFilterChange}
          disabled={vendors.length === 0}
        >
          <SelectTrigger
            id="renewal-vendor"
            className="h-9 min-w-[180px] border-0 shadow-none focus-visible:ring-0"
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

      <div className="relative min-w-[200px] flex-1">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search contracts or vendors"
          placeholder="Search contract or vendor…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9 border-0 pl-8 shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onExportCalendar}>
          <Calendar className="mr-2 h-4 w-4" />
          Export Calendar
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <Settings2 className="mr-2 h-4 w-4" />
          Alert Settings
        </Button>
      </div>
    </div>
  )
}
