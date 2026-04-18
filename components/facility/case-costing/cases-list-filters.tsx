"use client"

/**
 * Case Costing — cases-list filter bar.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.1.
 * Exposes:
 *   - Date-range preset dropdown (delegates to pure helper
 *     `@/lib/case-costing/date-range-presets.ts::resolveDateRange`)
 *   - Surgeon multi-select (Popover + Command)
 *   - CPT code multi-select (Popover + Command)
 *
 * Stateless w.r.t. data fetching — emits new filter objects to the parent
 * via `onChange`.
 */

import { useState } from "react"
import { CalendarRange, Filter, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
  surgeonOptions: string[]
  cptOptions: string[]
}

export function CasesListFilters({
  filters,
  onChange,
  surgeonOptions,
  cptOptions,
}: CasesListFiltersProps) {
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

  const selectedSurgeons = filters.surgeons ?? []
  const selectedCpts = filters.cptCodes ?? []

  function toggleSurgeon(name: string) {
    const next = selectedSurgeons.includes(name)
      ? selectedSurgeons.filter((s) => s !== name)
      : [...selectedSurgeons, name]
    onChange({ ...filters, surgeons: next.length ? next : undefined })
  }

  function toggleCpt(code: string) {
    const next = selectedCpts.includes(code)
      ? selectedCpts.filter((c) => c !== code)
      : [...selectedCpts, code]
    onChange({ ...filters, cptCodes: next.length ? next : undefined })
  }

  function clearAll() {
    setPreset("all")
    onChange({})
  }

  const activeCount =
    (selectedSurgeons.length > 0 ? 1 : 0) +
    (selectedCpts.length > 0 ? 1 : 0) +
    (preset !== "all" ? 1 : 0)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-muted-foreground" />
        <Select value={preset} onValueChange={(v) => applyPreset(v as DateRangePreset | "all")}>
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

      <MultiSelectPopover
        label="Surgeons"
        options={surgeonOptions}
        selected={selectedSurgeons}
        onToggle={toggleSurgeon}
      />

      <MultiSelectPopover
        label="CPT codes"
        options={cptOptions}
        selected={selectedCpts}
        onToggle={toggleCpt}
      />

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="h-8">
          <X className="mr-1 h-3 w-3" />
          Clear filters
          <Badge variant="secondary" className="ml-2">
            {activeCount}
          </Badge>
        </Button>
      )}
    </div>
  )
}

interface MultiSelectPopoverProps {
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
}

function MultiSelectPopover({
  label,
  options,
  selected,
  onToggle,
}: MultiSelectPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Filter className="mr-1 h-3 w-3" />
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-2">
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const active = selected.includes(opt)
                return (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => onToggle(opt)}
                    className="flex items-center justify-between"
                  >
                    <span>{opt}</span>
                    {active && (
                      <Badge variant="default" className="ml-2 h-4 px-1.5 text-[10px]">
                        ✓
                      </Badge>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
