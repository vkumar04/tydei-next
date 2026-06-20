"use client"

/**
 * Case Costing → Reports — Rebate Contribution (per-surgeon) column defs for the
 * shared <DataTable> (per-column filtering, 2026-06-19).
 *
 * Surgeon is the `select`/search column; Cases / Spend / Est. Rebate /
 * Compliance % use `range` projecting a NUMBER via `accessorFn`.
 */

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"

export interface RebateContributionRow {
  name: string
  cases: number
  spend: number
  estRebate: number
  complianceRate: number
}

export const rebateContributionColumns: ColumnDef<RebateContributionRow>[] = [
  {
    accessorKey: "name",
    header: "Surgeon",
    meta: { filterVariant: "select", filterLabel: "Surgeon" },
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
    accessorKey: "spend",
    header: "Spend",
    accessorFn: (row) => row.spend,
    meta: { filterVariant: "range", filterLabel: "Spend" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        ${Math.round(row.original.spend).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "estRebate",
    header: "Est. Rebate",
    accessorFn: (row) => row.estRebate,
    meta: { filterVariant: "range", filterLabel: "Est. Rebate" },
    cell: ({ row }) => (
      <span className="tabular-nums text-green-600 dark:text-green-400">
        ${Math.round(row.original.estRebate).toLocaleString()}
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
]
