"use client"

/**
 * Status + search filter bar for the facility renewals list.
 *
 * Status values mirror `RenewalStatus` from lib/renewals/engine.ts,
 * plus an "all" sentinel. Search is a free-text contract/vendor match
 * — plain string.includes(), case-insensitive, applied client-side.
 */

import { Input } from "@/components/ui/input"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Search } from "lucide-react"

export type StatusFilter = "all" | "critical" | "warning" | "upcoming" | "ok"

interface RenewalsFilterBarProps {
  status: StatusFilter
  onStatusChange: (next: StatusFilter) => void
  search: string
  onSearchChange: (next: string) => void
  counts: {
    all: number
    critical: number
    warning: number
    upcoming: number
    ok: number
  }
}

export function RenewalsFilterBar({
  status,
  onStatusChange,
  search,
  onSearchChange,
  counts,
}: RenewalsFilterBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Tabs
        value={status}
        onValueChange={(v) => onStatusChange(v as StatusFilter)}
        className="w-full sm:w-auto"
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="critical">Critical ({counts.critical})</TabsTrigger>
          <TabsTrigger value="warning">Warning ({counts.warning})</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming ({counts.upcoming})</TabsTrigger>
          <TabsTrigger value="ok">On Track ({counts.ok})</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search contracts or vendors"
          placeholder="Search contract or vendor…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8"
        />
      </div>
    </div>
  )
}
