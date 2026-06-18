"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * Lightweight client-side sort + filter for the plain shadcn `<Table>`
 * surfaces in Case Costing (compliance, CPT analysis, financial, …) that
 * aren't built on TanStack Table. Charles 2026-06-18: "All of these lists
 * need to be sortable or filterable."
 *
 * Generic over the row type. The caller supplies:
 *   - `accessors`: how to read each sortable column's comparable value
 *   - `searchFields`: which columns the free-text filter matches against
 *
 * Returns the filtered+sorted rows plus the controls a `<SortableHead>` and a
 * search `<Input>` bind to. Sorting is tri-state per column toggle
 * (asc → desc → asc); numbers and strings both compare correctly.
 */
export type SortDir = "asc" | "desc"

export interface UseTableSortResult<T, K extends string> {
  rows: T[]
  sortKey: K | null
  sortDir: SortDir
  toggleSort: (key: K) => void
  query: string
  setQuery: (q: string) => void
}

export function useTableSort<T, K extends string>(
  data: readonly T[],
  options: {
    accessors: Record<K, (row: T) => string | number | null | undefined>
    searchFields?: Array<(row: T) => string | number | null | undefined>
    initialSort?: { key: K; dir?: SortDir }
  },
): UseTableSortResult<T, K> {
  const { accessors, searchFields, initialSort } = options
  const [sortKey, setSortKey] = useState<K | null>(initialSort?.key ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(initialSort?.dir ?? "asc")
  const [query, setQuery] = useState("")

  function toggleSort(key: K) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = q && searchFields
      ? data.filter((row) =>
          searchFields.some((f) => {
            const v = f(row)
            return v != null && String(v).toLowerCase().includes(q)
          }),
        )
      : [...data]

    if (sortKey) {
      const accessor = accessors[sortKey]
      out = out.sort((a, b) => {
        const av = accessor(a)
        const bv = accessor(b)
        // nulls always sort last regardless of direction
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        let cmp: number
        if (typeof av === "number" && typeof bv === "number") {
          cmp = av - bv
        } else {
          cmp = String(av).localeCompare(String(bv), undefined, {
            numeric: true,
            sensitivity: "base",
          })
        }
        return sortDir === "asc" ? cmp : -cmp
      })
    }
    return out
  }, [data, query, searchFields, sortKey, sortDir, accessors])

  return { rows, sortKey, sortDir, toggleSort, query, setQuery }
}

/* ─── Sortable header cell ────────────────────────────────────────── */

interface SortableHeadProps<K extends string> {
  label: string
  sortKey: K
  state: { sortKey: K | null; sortDir: SortDir; toggleSort: (key: K) => void }
  className?: string
  align?: "left" | "right"
}

export function SortableHead<K extends string>({
  label,
  sortKey,
  state,
  className,
  align = "left",
}: SortableHeadProps<K>) {
  const active = state.sortKey === sortKey
  const Icon = !active ? ChevronsUpDown : state.sortDir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead className={cn(align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => state.toggleSort(sortKey)}
        aria-label={`Sort by ${label}`}
        className={cn(
          "inline-flex items-center gap-1 select-none hover:text-foreground transition-colors",
          align === "right" && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      </button>
    </TableHead>
  )
}
