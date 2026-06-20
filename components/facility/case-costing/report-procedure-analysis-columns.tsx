"use client"

/**
 * Case Costing → Reports — Procedure Analysis (CPT breakdown) column defs for
 * the shared <DataTable> (per-column filtering, 2026-06-19).
 *
 * CPT code is the `select`/search column; Case Count / Avg / Min / Max cost use
 * `range` projecting a NUMBER via `accessorFn`.
 */

import type { ColumnDef } from "@tanstack/react-table"

export interface ProcedureAnalysisRow {
  code: string
  count: number
  avgCost: number
  minCost: number
  maxCost: number
}

export const procedureAnalysisColumns: ColumnDef<ProcedureAnalysisRow>[] = [
  {
    accessorKey: "code",
    header: "CPT Code",
    meta: { filterVariant: "select", filterLabel: "CPT Code" },
    cell: ({ row }) => (
      <span className="font-medium font-mono">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "count",
    header: "Case Count",
    accessorFn: (row) => row.count,
    meta: { filterVariant: "range", filterLabel: "Case Count" },
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.count}</span>
    ),
  },
  {
    accessorKey: "avgCost",
    header: "Avg Cost",
    accessorFn: (row) => row.avgCost,
    meta: { filterVariant: "range", filterLabel: "Avg Cost" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        ${Math.round(row.original.avgCost).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "minCost",
    header: "Min Cost",
    accessorFn: (row) => row.minCost,
    meta: { filterVariant: "range", filterLabel: "Min Cost" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        ${Math.round(row.original.minCost).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "maxCost",
    header: "Max Cost",
    accessorFn: (row) => row.maxCost,
    meta: { filterVariant: "range", filterLabel: "Max Cost" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        ${Math.round(row.original.maxCost).toLocaleString()}
      </span>
    ),
  },
]
