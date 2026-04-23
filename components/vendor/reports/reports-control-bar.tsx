"use client"

import { Building2, FileBarChart, Filter, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ReportType, ReportTypeId } from "./reports-types"

/**
 * Flat control bar for the vendor Reports hub.
 *
 * Row 1 — facility filter, search, "New Report" CTA.
 * Row 2 — category chip group (All / Performance / Rebates / Spend /
 * Compliance) that drives the active tab.
 *
 * Mirrors the theme-token vocabulary used by
 * `components/facility/reports/reports-control-bar.tsx`.
 */
export interface VendorReportsControlBarProps {
  selectedFacility: string
  onFacilityChange: (facility: string) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  category: "all" | ReportTypeId
  onCategoryChange: (category: "all" | ReportTypeId) => void
  reportTypes: ReportType[]
  onNewReport: () => void
}

const FACILITY_OPTIONS = [
  { value: "all", label: "All Facilities" },
  { value: "firsthealth", label: "FirstHealth Regional" },
  { value: "memorial", label: "Memorial Hospital" },
  { value: "clearwater", label: "Clearwater Medical" },
] as const

export function VendorReportsControlBar({
  selectedFacility,
  onFacilityChange,
  searchQuery,
  onSearchChange,
  category,
  onCategoryChange,
  reportTypes,
  onNewReport,
}: VendorReportsControlBarProps) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          Filters
        </div>

        <Select value={selectedFacility} onValueChange={onFacilityChange}>
          <SelectTrigger className="w-[200px]">
            <Building2 className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Facility" />
          </SelectTrigger>
          <SelectContent>
            {FACILITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative w-full sm:w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search reports"
            className="pl-8"
          />
        </div>

        <div className="ml-auto">
          <Button
            type="button"
            size="sm"
            onClick={onNewReport}
            className="gap-2"
          >
            <FileBarChart className="h-4 w-4" />
            New Report
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Category
        </span>
        <CategoryChip
          active={category === "all"}
          onClick={() => onCategoryChange("all")}
        >
          All
        </CategoryChip>
        {reportTypes.map((rt) => (
          <CategoryChip
            key={rt.id}
            active={category === rt.id}
            onClick={() => onCategoryChange(rt.id)}
          >
            {rt.name}
          </CategoryChip>
        ))}
      </div>
    </section>
  )
}

interface CategoryChipProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

function CategoryChip({ active, onClick, children }: CategoryChipProps) {
  return (
    <button type="button" onClick={onClick} className="group">
      <Badge
        variant={active ? "default" : "outline"}
        className={
          active
            ? "cursor-pointer bg-primary text-primary-foreground"
            : "cursor-pointer hover:bg-accent"
        }
      >
        {children}
      </Badge>
    </button>
  )
}
