"use client"

/**
 * Control bar for the vendor Renewals page.
 *
 * Mirrors `components/facility/renewals/renewals-control-bar.tsx` but
 * swaps the vendor filter for a facility filter (vendor-side semantics)
 * and the status options match the page's pipeline tabs.
 */

import { Calendar, Search } from "lucide-react"
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

export type VendorRenewalStage =
  | "all"
  | "upcoming"
  | "in_progress"
  | "renewed"
  | "expired"

export interface VendorRenewalsControlBarProps {
  stage: VendorRenewalStage
  onStageChange: (next: VendorRenewalStage) => void
  facilities: string[]
  facilityFilter: string
  onFacilityFilterChange: (next: string) => void
  search: string
  onSearchChange: (next: string) => void
  onExportCalendar: () => void
  counts: {
    all: number
    upcoming: number
    in_progress: number
    renewed: number
    expired: number
  }
}

export function VendorRenewalsControlBar({
  stage,
  onStageChange,
  facilities,
  facilityFilter,
  onFacilityFilterChange,
  search,
  onSearchChange,
  onExportCalendar,
  counts,
}: VendorRenewalsControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="flex items-center gap-2">
        <Label
          htmlFor="vendor-renewal-stage"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          Status
        </Label>
        <Select
          value={stage}
          onValueChange={(v) => onStageChange(v as VendorRenewalStage)}
        >
          <SelectTrigger
            id="vendor-renewal-stage"
            className="h-9 min-w-[160px] border-0 shadow-none focus-visible:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All ({counts.all})</SelectItem>
            <SelectItem value="upcoming">
              Upcoming ({counts.upcoming})
            </SelectItem>
            <SelectItem value="in_progress">
              In Progress ({counts.in_progress})
            </SelectItem>
            <SelectItem value="renewed">
              Renewed ({counts.renewed})
            </SelectItem>
            <SelectItem value="expired">
              Expired ({counts.expired})
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-2">
        <Label
          htmlFor="vendor-renewal-facility"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          Facility
        </Label>
        <Select
          value={facilityFilter}
          onValueChange={onFacilityFilterChange}
          disabled={facilities.length === 0}
        >
          <SelectTrigger
            id="vendor-renewal-facility"
            className="h-9 min-w-[180px] border-0 shadow-none focus-visible:ring-0"
          >
            <SelectValue placeholder="All facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All facilities</SelectItem>
            {facilities.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="relative min-w-[200px] flex-1">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search contracts or facilities"
          placeholder="Search contract or facility…"
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
      </div>
    </div>
  )
}
