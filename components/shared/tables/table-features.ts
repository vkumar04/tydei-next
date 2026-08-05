/**
 * Shared TanStack Table v9 feature set + app-level type aliases.
 *
 * v9 made features explicit (`tableFeatures`) and threaded a `TFeatures`
 * generic through every public type. This module is the ONE place that
 * decides which features the shared <DataTable> registers, so the ~20
 * column-definition files can keep writing `ColumnDef<Row>` — the alias
 * below pins the features generic for them. Import table types from here,
 * not from "@tanstack/react-table".
 *
 * Registered functions: the full `sortFns` registry (the default `'auto'`
 * sort only resolves fns that are registered) plus exactly the three filter
 * fns the DataTable auto-assigns from `meta.filterVariant`.
 */
import {
  tableFeatures,
  rowSortingFeature,
  columnFilteringFeature,
  columnFacetingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  createSortedRowModel,
  createFilteredRowModel,
  createPaginatedRowModel,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFacetedMinMaxValues,
  sortFns,
  filterFn_includesString,
  filterFn_arrIncludesSome,
  filterFn_inNumberRange,
  type RowData,
  type ColumnDef as TanStackColumnDef,
  type Column as TanStackColumn,
  type CellContext as TanStackCellContext,
} from "@tanstack/react-table"

/**
 * Typed `columnDef.meta` for every app table (v9 `columnMeta` slot —
 * replaces the v8 global `declare module` ColumnMeta augmentation).
 */
export interface AppColumnMeta {
  filterVariant?: "text" | "select" | "range" | "none"
  filterLabel?: string
}

/**
 * Scalar-aware "is any of" for the select filter variant.
 *
 * v9's built-in `filterFn_arrIncludesSome` gates on `Array.isArray(cell)` and
 * returns false for everything else — but every select-variant column in this
 * app projects a SCALAR string (vendor name, status, category…), so wiring
 * the built-in made every select filter render "No results found" while the
 * facet dropdown looked healthy (upgrade review 2026-08-05, runtime-confirmed).
 * This reproduces the v8 semantics for both scalar and array cell values.
 * Pinned by data-table-filter-parity.test.ts.
 */
function selectAnyOfImpl(
  row: { getValue: (columnId: string) => unknown },
  columnId: string,
  filterValue: unknown,
): boolean {
  const selected = Array.isArray(filterValue) ? filterValue.map(String) : []
  const value = row.getValue(columnId)
  if (Array.isArray(value)) {
    return value.some((v) => selected.includes(String(v)))
  }
  return value != null && selected.includes(String(value))
}
selectAnyOfImpl.autoRemove = (value: unknown) =>
  !Array.isArray(value) || value.length === 0

export const filterFn_selectAnyOf = selectAnyOfImpl

/**
 * The filterFn registry key the shared DataTable auto-assigns for each
 * `meta.filterVariant`. ONE definition — the component and the parity test
 * both read it, so the mapping cannot drift from what is registered.
 */
export function filterFnForVariant(
  variant: AppColumnMeta["filterVariant"],
): "selectAnyOf" | "inNumberRange" | "includesString" {
  if (variant === "select") return "selectAnyOf"
  if (variant === "range") return "inNumberRange"
  return "includesString"
}

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  columnFacetingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  columnSizingFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  facetedMinMaxValues: createFacetedMinMaxValues(),
  sortFns,
  filterFns: {
    includesString: filterFn_includesString,
    arrIncludesSome: filterFn_arrIncludesSome,
    inNumberRange: filterFn_inNumberRange,
    selectAnyOf: filterFn_selectAnyOf,
  },
  columnMeta: {} as AppColumnMeta,
})

export type DataTableFeatures = typeof dataTableFeatures

/** App-level ColumnDef — features generic pre-applied. */
export type ColumnDef<TData extends RowData, TValue = unknown> = TanStackColumnDef<
  DataTableFeatures,
  TData,
  TValue
>

/** App-level Column — features generic pre-applied. */
export type TableColumn<TData extends RowData, TValue = unknown> = TanStackColumn<
  DataTableFeatures,
  TData,
  TValue
>

/** App-level CellContext — features generic pre-applied. */
export type TableCellContext<TData extends RowData, TValue = unknown> = TanStackCellContext<
  DataTableFeatures,
  TData,
  TValue
>
