"use client"

/**
 * Case Costing — Surgeon scorecards column defs for the shared <DataTable>.
 *
 * Per-column filtering (2026-06-19): Surgeon + Specialty are faceted
 * `select`; the numeric columns (Cases, Total/Avg spend, Margin %, Score)
 * are `range` and project a NUMBER via `accessorFn` while the colored
 * badge/cell markup stays in `cell`. Payor mix is text-only (no filter).
 */

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import type { Surgeon } from "@/lib/case-costing/surgeon-derivation"
import type { ScoreColor } from "@/lib/case-costing/score-calc"

const COLOR_CLASSES: Record<ScoreColor, string> = {
  green: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
}

export const surgeonScorecardColumns: ColumnDef<Surgeon>[] = [
  {
    accessorKey: "name",
    header: "Surgeon",
    // `text` (not `select`) so the global search box (searchKey="name") feeds
    // a string into the same column's `includesString` filterFn — a `select`
    // column expects an array filter value and would break under the search.
    meta: { filterVariant: "text", filterLabel: "Surgeon" },
    cell: ({ row }) => (
      <span className="font-medium">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "specialty",
    header: "Specialty",
    meta: { filterVariant: "select", filterLabel: "Specialty" },
    cell: ({ row }) => (
      <Badge variant="outline">{row.original.specialty}</Badge>
    ),
  },
  {
    accessorKey: "caseCount",
    header: "Cases",
    accessorFn: (row) => row.caseCount,
    meta: { filterVariant: "range", filterLabel: "Cases" },
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {row.original.caseCount.toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "totalSpend",
    header: "Total spend",
    accessorFn: (row) => row.totalSpend,
    meta: { filterVariant: "range", filterLabel: "Total spend" },
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {formatCurrency(row.original.totalSpend)}
      </span>
    ),
  },
  {
    accessorKey: "avgSpendPerCase",
    header: "Avg spend",
    accessorFn: (row) => row.avgSpendPerCase,
    meta: { filterVariant: "range", filterLabel: "Avg spend" },
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {formatCurrency(row.original.avgSpendPerCase)}
      </span>
    ),
  },
  {
    accessorKey: "avgMarginPct",
    header: "Margin %",
    accessorFn: (row) => row.avgMarginPct,
    meta: { filterVariant: "range", filterLabel: "Margin %" },
    cell: ({ row }) => {
      const s = row.original
      return (
        <span
          className={cn(
            "text-right tabular-nums",
            s.avgMarginPct >= 30
              ? "text-green-600 dark:text-green-400"
              : s.avgMarginPct > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
          )}
        >
          {s.totalReimbursement > 0 ? formatPercent(s.avgMarginPct) : "—"}
        </span>
      )
    },
  },
  {
    id: "payorMix",
    header: "Payor mix",
    meta: { filterVariant: "none" },
    cell: ({ row }) => {
      const s = row.original
      return s.totalPayors > 0 ? (
        <span className="text-xs text-muted-foreground">
          {s.commercialOrPrivatePayors}/{s.totalPayors} commercial
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">No payor data</span>
      )
    },
  },
  {
    accessorKey: "overallScore",
    header: "Score",
    accessorFn: (row) => row.overallScore,
    meta: { filterVariant: "range", filterLabel: "Score" },
    cell: ({ row }) => {
      const s = row.original
      return (
        <span
          className={cn(
            "inline-flex min-w-[42px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
            COLOR_CLASSES[s.color],
          )}
          aria-label={`Overall score ${s.overallScore}, color ${s.color}`}
        >
          {s.overallScore}
        </span>
      )
    },
  },
]
