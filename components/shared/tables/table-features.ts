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
