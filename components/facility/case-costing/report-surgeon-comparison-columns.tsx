"use client"

/**
 * Case Costing → Reports — Surgeon Comparison column defs for the shared
 * <DataTable> (per-column filtering, 2026-06-19).
 *
 * Surgeon name is the `select`/search column; the numeric columns (Cases,
 * Total Spend, Avg Margin, Compliance %) use `range` and project a NUMBER via
 * `accessorFn` while keeping the colored/badge markup in `cell`. The Trend
 * icon column is `none`.
 */

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown } from "lucide-react"

export interface SurgeonComparisonRow {
  name: string
  cases: number
  totalSpend: number
  avgMargin: number
  complianceRate: number
  totalReimbursement: number
}

export const surgeonComparisonColumns: ColumnDef<SurgeonComparisonRow>[] = [
  {
    accessorKey: "name",
    header: "Surgeon",
    // "text", NOT "select". DataTable assigns the filterFn from this variant
    // (data-table.tsx:85-99): "select" maps to `arrIncludesSome`, which does
    // `filterValue.some(...)`. The table also passes `searchKey="name"`, and the
    // search box sets a plain STRING as this column's filter value — so
    // `arrIncludesSome` called `.some` on a string and threw
    // `TypeError: filterValue.some is not a function` inside getFilteredRowModel,
    // which runs during render. One character typed into "Search surgeon…" took
    // the whole Reports page down to the error boundary. Verified against the
    // installed @tanstack/table-core. Charles 2026-07-28 sweep.
    meta: { filterVariant: "text", filterLabel: "Surgeon" },
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "cases",
    header: "Cases",
    accessorFn: (row) => row.cases,
    meta: { filterVariant: "range", filterLabel: "Cases" },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.cases}</span>
    ),
  },
  {
    accessorKey: "totalSpend",
    header: "Total Spend",
    accessorFn: (row) => row.totalSpend,
    meta: { filterVariant: "range", filterLabel: "Total Spend" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        ${Math.round(row.original.totalSpend).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "avgMargin",
    header: "Avg Margin",
    accessorFn: (row) => row.avgMargin,
    meta: { filterVariant: "range", filterLabel: "Avg Margin" },
    cell: ({ row }) => (
      <span
        className={
          row.original.avgMargin >= 0
            ? "tabular-nums text-green-600 dark:text-green-400"
            : "tabular-nums text-red-600 dark:text-red-400"
        }
      >
        ${Math.round(row.original.avgMargin).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "complianceRate",
    header: "Compliance %",
    accessorFn: (row) => row.complianceRate,
    meta: { filterVariant: "range", filterLabel: "Compliance %" },
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.complianceRate >= 80
            ? "default"
            : row.original.complianceRate >= 50
              ? "secondary"
              : "destructive"
        }
      >
        {Math.round(row.original.complianceRate)}%
      </Badge>
    ),
  },
  {
    id: "trend",
    header: "Trend",
    enableSorting: false,
    meta: { filterVariant: "none" },
    cell: ({ row }) =>
      row.original.avgMargin >= 0 ? (
        <TrendingUp className="size-4 text-green-600 dark:text-green-400" />
      ) : (
        <TrendingDown className="size-4 text-red-600 dark:text-red-400" />
      ),
  },
]
