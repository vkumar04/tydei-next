"use client"

import Link from "next/link"
import { Download, Plus, Search } from "lucide-react"
import type { ContractStatus, ContractType } from "@prisma/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ContractFilters } from "@/components/contracts/contract-filters"
import type { FacilityScope } from "@/lib/actions/contracts-auth"

/**
 * Horizontal control bar for the contracts-list page. Consolidates what
 * used to be a nested Tabs row, a standalone Filters card, and a header
 * CTA into one elevated toolbar:
 *
 *   [Scope toggle] [Search] [Status/Type filters] [CSV] [New contract]
 *
 * The 3-way Facility Scope is demoted from nested Tabs to a segmented
 * Tabs-as-toggle control because the tabs had no unique body — all three
 * scopes render the same table with different data.
 */
export interface ContractsControlBarProps {
  facilityScope: FacilityScope
  onFacilityScopeChange: (next: FacilityScope) => void
  searchQuery: string
  onSearchQueryChange: (next: string) => void
  statusFilter: ContractStatus | "all"
  onStatusFilterChange: (next: ContractStatus | "all") => void
  typeFilter: ContractType | "all"
  onTypeFilterChange: (next: ContractType | "all") => void
  facilities: { id: string; name: string }[]
  facilityFilter: string
  onFacilityFilterChange: (next: string) => void
  onDownloadCsv: () => void
  canDownload: boolean
}

export function ContractsControlBar({
  facilityScope,
  onFacilityScopeChange,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  facilities,
  facilityFilter,
  onFacilityFilterChange,
  onDownloadCsv,
  canDownload,
}: ContractsControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <Tabs
        value={facilityScope}
        onValueChange={(v) => onFacilityScopeChange(v as FacilityScope)}
      >
        <TabsList>
          <TabsTrigger value="this">This Facility</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="shared">Shared</TabsTrigger>
        </TabsList>
      </Tabs>

      <Separator orientation="vertical" className="hidden h-6 sm:block" />

      <div className="relative min-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="contract-search"
          aria-label="Search contracts"
          placeholder="Search contracts, vendors, IDs..."
          className="pl-9"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ContractFilters
          status={statusFilter}
          onStatusChange={onStatusFilterChange}
          type={typeFilter}
          onTypeChange={onTypeFilterChange}
          facilities={facilities}
          facilityFilter={facilityFilter}
          onFacilityChange={onFacilityFilterChange}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={onDownloadCsv}
          disabled={!canDownload}
        >
          <Download className="mr-2 h-4 w-4" /> CSV
        </Button>
        <Button asChild size="sm">
          <Link href="/dashboard/contracts/new">
            <Plus className="mr-2 h-4 w-4" />
            New Contract
          </Link>
        </Button>
      </div>
    </div>
  )
}
