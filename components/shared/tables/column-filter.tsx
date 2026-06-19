"use client"

import { useState } from "react"
import type { Column } from "@tanstack/react-table"
import { Check, Filter, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import { cn } from "@/lib/utils"

/**
 * Per-column filter controls for the shared <DataTable> (uniform table
 * filtering, 2026-06-19). Driven by each column's
 * `meta.filterVariant` — `text` (case-insensitive contains), `select`
 * (faceted multi-select from the column's actual values), or `range`
 * (numeric min/max). Built on TanStack Table v8's column filter +
 * faceted row-model APIs (`getFacetedUniqueValues` /
 * `getFacetedMinMaxValues`), verified against v8.21.3 docs.
 *
 * The DataTable auto-assigns the matching built-in `filterFn`
 * (`includesString` / `arrIncludesSome` / `inNumberRange`) from the
 * variant, so a column only needs `meta: { filterVariant: "select" }`.
 */

// Augment TanStack's ColumnMeta so column defs can declare a filter
// variant + optional label in a type-safe way.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends import("@tanstack/react-table").RowData, TValue> {
    filterVariant?: "text" | "select" | "range" | "none"
    filterLabel?: string
  }
}

export type FilterVariant = "text" | "select" | "range" | "none"

export function columnFilterVariant<TData>(column: Column<TData, unknown>): FilterVariant {
  const declared = column.columnDef.meta?.filterVariant
  if (declared) return declared
  // Display/action columns (no accessor) can't be filtered.
  return column.getCanFilter() ? "text" : "none"
}

export function ColumnFilter<TData>({ column }: { column: Column<TData, unknown> }) {
  const variant = columnFilterVariant(column)
  if (variant === "none" || !column.getCanFilter()) return null
  if (variant === "range") return <RangeFilter column={column} />
  if (variant === "select") return <SelectFilter column={column} />
  return <TextFilter column={column} />
}

function TextFilter<TData>({ column }: { column: Column<TData, unknown> }) {
  const value = (column.getFilterValue() as string) ?? ""
  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => column.setFilterValue(e.target.value || undefined)}
        placeholder="Filter…"
        aria-label={`Filter ${columnLabel(column)}`}
        className="h-7 w-full min-w-[90px] text-xs"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => column.setFilterValue(undefined)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

function RangeFilter<TData>({ column }: { column: Column<TData, unknown> }) {
  const [min, max] = (column.getFilterValue() as [number | "", number | ""]) ?? ["", ""]
  const setRange = (next: [number | "", number | ""]) => {
    column.setFilterValue(next[0] === "" && next[1] === "" ? undefined : next)
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        inputMode="numeric"
        value={min === "" ? "" : String(min)}
        onChange={(e) =>
          setRange([e.target.value === "" ? "" : Number(e.target.value), max])
        }
        placeholder="Min"
        aria-label={`Minimum ${columnLabel(column)}`}
        className="h-7 w-full min-w-[56px] text-xs"
      />
      <span className="text-muted-foreground text-xs">–</span>
      <Input
        type="number"
        inputMode="numeric"
        value={max === "" ? "" : String(max)}
        onChange={(e) =>
          setRange([min, e.target.value === "" ? "" : Number(e.target.value)])
        }
        placeholder="Max"
        aria-label={`Maximum ${columnLabel(column)}`}
        className="h-7 w-full min-w-[56px] text-xs"
      />
    </div>
  )
}

function SelectFilter<TData>({ column }: { column: Column<TData, unknown> }) {
  const [open, setOpen] = useState(false)
  const selected = (column.getFilterValue() as string[]) ?? []
  // Faceted unique values: Map<value, count>. Empty/nullish values dropped.
  const options = Array.from(column.getFacetedUniqueValues().keys())
    .filter((v): v is string | number => v !== null && v !== undefined && v !== "")
    .map((v) => String(v))
    .sort((a, b) => a.localeCompare(b))

  const toggle = (val: string) => {
    const next = selected.includes(val)
      ? selected.filter((v) => v !== val)
      : [...selected, val]
    column.setFilterValue(next.length ? next : undefined)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full justify-start gap-1 px-2 text-xs font-normal"
        >
          <Filter className="size-3 shrink-0" />
          {selected.length === 0 ? (
            <span className="text-muted-foreground">All</span>
          ) : (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Filter ${columnLabel(column)}…`} className="h-8" />
          <CommandList>
            <CommandEmpty>No values.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isSel = selected.includes(opt)
                return (
                  <CommandItem key={opt} value={opt} onSelect={() => toggle(opt)}>
                    <Check className={cn("mr-2 size-4", isSel ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{opt}</span>
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

function columnLabel<TData>(column: Column<TData, unknown>): string {
  const meta = column.columnDef.meta
  if (meta?.filterLabel) return meta.filterLabel
  const header = column.columnDef.header
  return typeof header === "string" ? header : column.id
}
