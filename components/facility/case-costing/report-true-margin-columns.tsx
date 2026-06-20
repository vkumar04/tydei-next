"use client"

/**
 * Case Costing → Reports — True Margin (per-procedure) column defs for the
 * shared <DataTable> (per-column filtering, 2026-06-19).
 *
 * Procedure (name + case number) is the `select`/search column; the numeric
 * columns (Revenue, Direct Cost, Rebate Allocation, Effective Cost, Standard %,
 * True %, Improvement) use `range` projecting a NUMBER via `accessorFn` while
 * keeping the colored/badge markup in `cell`. Null margin percents project as 0
 * for filtering but still render as "—".
 */

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"

export interface TrueMarginProcedureRow {
  procedureId: string
  procedureName: string
  caseNumber: string
  totalRevenue: number
  directCost: number
  rebateAllocation: number
  effectiveCost: number
  standardMarginPercent: number | null
  trueMarginPercent: number | null
  marginImprovementPercent: number | null
}

export const trueMarginColumns: ColumnDef<TrueMarginProcedureRow>[] = [
  {
    accessorKey: "procedureName",
    header: "Procedure",
    meta: { filterVariant: "select", filterLabel: "Procedure" },
    cell: ({ row }) => (
      <div className="font-medium">
        <div>{row.original.procedureName}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.caseNumber}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "totalRevenue",
    header: "Revenue",
    accessorFn: (row) => row.totalRevenue,
    meta: { filterVariant: "range", filterLabel: "Revenue" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        ${Math.round(row.original.totalRevenue).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "directCost",
    header: "Direct Cost",
    accessorFn: (row) => row.directCost,
    meta: { filterVariant: "range", filterLabel: "Direct Cost" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        ${Math.round(row.original.directCost).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "rebateAllocation",
    header: "Rebate Allocation",
    accessorFn: (row) => row.rebateAllocation,
    meta: { filterVariant: "range", filterLabel: "Rebate Allocation" },
    cell: ({ row }) => (
      <span className="tabular-nums text-green-700 dark:text-green-400">
        +${Math.round(row.original.rebateAllocation).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "effectiveCost",
    header: "Effective Cost",
    accessorFn: (row) => row.effectiveCost,
    meta: { filterVariant: "range", filterLabel: "Effective Cost" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        ${Math.round(row.original.effectiveCost).toLocaleString()}
      </span>
    ),
  },
  {
    id: "standardMarginPercent",
    header: "Standard %",
    accessorFn: (row) => row.standardMarginPercent ?? 0,
    meta: { filterVariant: "range", filterLabel: "Standard %" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.standardMarginPercent != null
          ? `${row.original.standardMarginPercent.toFixed(1)}%`
          : "—"}
      </span>
    ),
  },
  {
    id: "trueMarginPercent",
    header: "True %",
    accessorFn: (row) => row.trueMarginPercent ?? 0,
    meta: { filterVariant: "range", filterLabel: "True %" },
    cell: ({ row }) => (
      <span
        className={
          row.original.trueMarginPercent != null &&
          row.original.trueMarginPercent >= 0
            ? "tabular-nums text-green-600 dark:text-green-400"
            : "tabular-nums text-red-600 dark:text-red-400"
        }
      >
        {row.original.trueMarginPercent != null
          ? `${row.original.trueMarginPercent.toFixed(1)}%`
          : "—"}
      </span>
    ),
  },
  {
    id: "marginImprovementPercent",
    header: "Improvement",
    accessorFn: (row) => row.marginImprovementPercent ?? 0,
    meta: { filterVariant: "range", filterLabel: "Improvement" },
    cell: ({ row }) =>
      row.original.marginImprovementPercent != null ? (
        <Badge variant="secondary">
          +{row.original.marginImprovementPercent.toFixed(2)} pp
        </Badge>
      ) : (
        "—"
      ),
  },
]
