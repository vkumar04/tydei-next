"use client"

import Link from "next/link"
import { Plus, Search } from "lucide-react"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Horizontal control bar for the vendor contracts-list page. Consolidates
 * search, facility filter, status chip tabs, and the "New contract" CTA
 * into one elevated toolbar:
 *
 *   [Search] [Facility filter] [Status chip group] [New contract]
 *
 * Mirrors the facility-side `ContractsControlBar` shell treatment and
 * component vocabulary.
 */

export type VendorStatusTab =
  | "all"
  | "draft"
  | "submitted"
  | "pending"
  | "active"
  | "rejected"

const STATUS_TABS: { label: string; value: VendorStatusTab }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Submitted", value: "submitted" },
  { label: "Pending", value: "pending" },
  { label: "Active", value: "active" },
  { label: "Rejected", value: "rejected" },
]

export interface VendorContractsControlBarProps {
  searchQuery: string
  onSearchQueryChange: (next: string) => void
  facilityFilter: string
  onFacilityFilterChange: (next: string) => void
  facilities: { id: string; name: string }[]
  statusTab: VendorStatusTab
  onStatusTabChange: (next: VendorStatusTab) => void
}

export function VendorContractsControlBar({
  searchQuery,
  onSearchQueryChange,
  facilityFilter,
  onFacilityFilterChange,
  facilities,
  statusTab,
  onStatusTabChange,
}: VendorContractsControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="vendor-contract-search"
          aria-label="Search contracts"
          placeholder="Search contracts, facilities..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
      </div>

      <Select value={facilityFilter} onValueChange={onFacilityFilterChange}>
        <SelectTrigger className="w-[200px]">
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

      <Separator orientation="vertical" className="hidden h-6 sm:block" />

      <Tabs
        value={statusTab}
        onValueChange={(v) => onStatusTabChange(v as VendorStatusTab)}
      >
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="ml-auto flex items-center gap-2">
        <Button asChild size="sm">
          <Link href="/vendor/contracts/new">
            <Plus className="mr-2 h-4 w-4" />
            New Contract
          </Link>
        </Button>
      </div>
    </div>
  )
}
