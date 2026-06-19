"use client"

/**
 * Case Costing — cases-list filter bar.
 *
 * Exposes the date-range preset dropdown (delegates to pure helper
 * `@/lib/case-costing/date-range-presets.ts::resolveDateRange`), which drives
 * the SERVER query via `onChange` (it sets `dateFrom`/`dateTo` on the
 * `GetCasesForFacilityFilters` object passed up to the orchestrator).
 *
 * The surgeon / CPT multi-select buttons that used to live here were removed
 * (2026-06-19) — that filtering is now per-column on the shared <DataTable>.
 *
 * Stateless w.r.t. data fetching — emits new filter objects to the parent
 * via `onChange`.
 */

import { useState } from "react"
import { CalendarRange } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { GetCasesForFacilityFilters } from "@/lib/actions/case-costing/cases-list"
import {
  resolveDateRange,
  type DateRangePreset,
} from "@/lib/case-costing/date-range-presets"

type PresetOption = { value: DateRangePreset | "all"; label: string }

const PRESETS: PresetOption[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "last_12_months", label: "Last 12 months" },
]

interface CasesListFiltersProps {
  filters: GetCasesForFacilityFilters
  onChange: (next: GetCasesForFacilityFilters) => void
}

export function CasesListFilters({ filters, onChange }: CasesListFiltersProps) {
  const [preset, setPreset] = useState<DateRangePreset | "all">("all")

  function applyPreset(value: DateRangePreset | "all") {
    setPreset(value)
    if (value === "all") {
      const { dateFrom: _from, dateTo: _to, ...rest } = filters
      void _from
      void _to
      onChange(rest)
      return
    }
    const range = resolveDateRange(value)
    onChange({
      ...filters,
      dateFrom: range.from.toISOString(),
      dateTo: range.to.toISOString(),
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-muted-foreground" />
        <Select
          value={preset}
          onValueChange={(v) => applyPreset(v as DateRangePreset | "all")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
