"use client"

import { useMemo, useState } from "react"
import {
  type RowData,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
  type OnChangeFn,
  type FilterFnOption,
  flexRender,
  useTable,
} from "@tanstack/react-table"
import {
  dataTableFeatures,
  type DataTableFeatures,
  type ColumnDef,
} from "@/components/shared/tables/table-features"
import { motion } from "motion/react"
import { Search, ArrowDown, ArrowUp, ChevronsUpDown, FilterX } from "lucide-react"
import { ColumnFilter, columnFilterVariant } from "@/components/shared/tables/column-filter"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const MotionTableRow = motion.create(TableRow)
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ReactNode } from "react"

interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  searchKey?: string
  searchPlaceholder?: string
  filterComponent?: ReactNode
  pagination?: boolean
  pageSize?: number
  onRowClick?: (row: TData) => void
  isLoading?: boolean
  /**
   * Opt-in per-column filter row (uniform table filtering). Each column's
   * control is chosen from its `meta.filterVariant` ("text" | "select" |
   * "range" | "none"); accessor columns default to "text". The matching
   * built-in filterFn is auto-assigned, so column defs only declare the
   * variant.
   */
  enableColumnFilters?: boolean
  /** Optional controlled row selection state (TanStack rowSelection API). */
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  /** When provided, TanStack keys selection by this id (e.g. row.id). */
  getRowId?: (row: TData) => string
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Search...",
  filterComponent,
  pagination = true,
  pageSize = 20,
  onRowClick,
  isLoading,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  enableColumnFilters = false,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  // When per-column filters are enabled, auto-assign the built-in filterFn
  // that matches each column's variant so callers only declare the variant.
  // ("select" → array membership; "range" → numeric range; else contains.)
  const resolvedColumns = useMemo(() => {
    if (!enableColumnFilters) return columns
    return columns.map((col) => {
      const variant = col.meta?.filterVariant
      if (variant === "none") return { ...col, enableColumnFilter: false }
      if (col.filterFn) return col
      const filterFn: FilterFnOption<DataTableFeatures, TData> =
        variant === "select"
          ? "arrIncludesSome"
          : variant === "range"
            ? "inNumberRange"
            : "includesString"
      return { ...col, filterFn }
    })
  }, [columns, enableColumnFilters])

  // v9 registers row models on the shared `features` object, so pagination
  // is always registered. A `pagination={false}` table instead pins a single
  // page sized to the data (controlled pagination state), which reproduces
  // the v8 "no pagination row model" behavior — every row renders.
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns: resolvedColumns,
    // v8 handlers pass through unchanged; the range-select behavior v9
    // turned on by default is disabled to keep selection semantics
    // byte-identical to the v8 tables.
    enableRowRangeSelection: false,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange,
    getRowId,
    state: {
      sorting,
      columnFilters,
      ...(rowSelection !== undefined ? { rowSelection } : {}),
      ...(pagination
        ? {}
        : {
            pagination: {
              pageIndex: 0,
              pageSize: Math.max(1, data.length),
            },
          }),
    },
    initialState: { pagination: { pageIndex: 0, pageSize } },
  })

  return (
    <div className="space-y-4">
      {(searchKey || filterComponent || enableColumnFilters) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchKey && (
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder={searchPlaceholder}
                value={
                  (table.getColumn(searchKey)?.getFilterValue() as string) ?? ""
                }
                onChange={(e) =>
                  table.getColumn(searchKey)?.setFilterValue(e.target.value)
                }
                className="pl-8"
              />
            </div>
          )}
          {filterComponent}
          {enableColumnFilters && columnFilters.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setColumnFilters([])}
              className="h-8 gap-1 text-muted-foreground"
            >
              <FilterX className="size-3.5" />
              Clear filters
              <span className="ml-0.5 rounded bg-muted px-1 text-xs">
                {columnFilters.length}
              </span>
            </Button>
          )}
        </div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : undefined
                    }
                    className={
                      header.column.getCanSort()
                        ? "cursor-pointer select-none hover:text-foreground transition-colors"
                        : ""
                    }
                  >
                    {header.isPlaceholder ? null : (
                      <span className="inline-flex items-center gap-1">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {header.column.getCanSort() &&
                          (header.column.getIsSorted() === "asc" ? (
                            <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <ChevronsUpDown
                              className="size-3.5 shrink-0 text-muted-foreground/50"
                              aria-hidden="true"
                            />
                          ))}
                      </span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
            {enableColumnFilters &&
              table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={`${headerGroup.id}-filters`} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={`${header.id}-filter`} className="py-1.5 align-top">
                      {header.isPlaceholder ||
                      columnFilterVariant(header.column) === "none" ||
                      !header.column.getCanFilter() ? null : (
                        <ColumnFilter column={header.column} />
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <MotionTableRow
                  key={row.id}
                  onClick={() => onRowClick?.(row.original)}
                  className={onRowClick ? "cursor-pointer" : ""}
                  whileHover={{ scale: 1.005 }}
                  transition={{ duration: 0.15 }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </MotionTableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No results found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && table.getPageCount() > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {table.state.pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
