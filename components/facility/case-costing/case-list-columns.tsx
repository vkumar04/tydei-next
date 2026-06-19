"use client"

/**
 * Case Costing — Cases tab column defs for the shared <DataTable>.
 *
 * Per-column filtering (2026-06-19): categorical columns (Surgeon, CPT) use
 * the faceted `select` variant; numeric columns (Spend, Reimb., Margin,
 * Compliance) use `range` and project a NUMBER via `accessorFn` while keeping
 * the formatted/colored markup in `cell`. The old "Surgeons" / "CPT codes"
 * filter buttons are removed in favor of these column filters.
 */

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting"

/** Row shape produced by the cases-list-tab row mapper. */
export interface CaseListRow {
  id: string
  caseNumber: string
  surgeon: string
  date: string | Date
  cpt: string
  totalSpend: number
  totalReimbursement: number
  marginPct: number
  grossMargin: number
  trend: string
  compliancePct: number
  supplyCount: number
  onContractCount: number
}

export const caseListColumns: ColumnDef<CaseListRow>[] = [
  {
    accessorKey: "caseNumber",
    header: "Case #",
    meta: { filterVariant: "text", filterLabel: "Case #" },
    cell: ({ row }) => (
      <span className="font-medium">{row.original.caseNumber}</span>
    ),
  },
  {
    accessorKey: "date",
    header: "Date",
    meta: { filterVariant: "none" },
    cell: ({ row }) => formatDate(row.original.date),
  },
  {
    accessorKey: "surgeon",
    header: "Surgeon",
    meta: { filterVariant: "select", filterLabel: "Surgeon" },
    cell: ({ row }) => row.original.surgeon,
  },
  {
    accessorKey: "cpt",
    header: "CPT",
    meta: { filterVariant: "select", filterLabel: "CPT" },
    cell: ({ row }) => <Badge variant="outline">{row.original.cpt}</Badge>,
  },
  {
    accessorKey: "totalSpend",
    header: "Spend",
    accessorFn: (row) => row.totalSpend,
    meta: { filterVariant: "range", filterLabel: "Spend" },
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {formatCurrency(row.original.totalSpend)}
      </span>
    ),
  },
  {
    accessorKey: "totalReimbursement",
    header: "Reimb.",
    accessorFn: (row) => row.totalReimbursement,
    meta: { filterVariant: "range", filterLabel: "Reimb." },
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {row.original.totalReimbursement > 0
          ? formatCurrency(row.original.totalReimbursement)
          : "—"}
      </span>
    ),
  },
  {
    id: "margin",
    header: "Margin",
    accessorFn: (row) => row.marginPct,
    meta: { filterVariant: "range", filterLabel: "Margin %" },
    cell: ({ row }) => {
      const r = row.original
      return (
        <span
          className={cn(
            "text-right font-medium tabular-nums",
            r.totalReimbursement === 0
              ? "text-muted-foreground"
              : r.grossMargin >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400",
          )}
        >
          {r.totalReimbursement > 0
            ? `${formatPercent(r.marginPct)} · ${formatCurrency(r.grossMargin)}`
            : "—"}
        </span>
      )
    },
  },
  {
    id: "compliance",
    header: "Compliance",
    accessorFn: (row) => row.compliancePct,
    meta: { filterVariant: "range", filterLabel: "Compliance %" },
    cell: ({ row }) => {
      const r = row.original
      if (r.supplyCount === 0) {
        return (
          <span className="text-xs text-muted-foreground">No supplies</span>
        )
      }
      return (
        <div className="flex items-center gap-2">
          <Badge
            variant={
              r.compliancePct >= 80
                ? "default"
                : r.compliancePct >= 50
                  ? "secondary"
                  : "destructive"
            }
          >
            {formatPercent(r.compliancePct, 0)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {r.onContractCount}/{r.supplyCount} on contract
          </span>
        </div>
      )
    },
  },
]
