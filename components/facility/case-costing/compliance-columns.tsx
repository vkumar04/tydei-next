"use client"

/**
 * Case Costing — per-case compliance column defs for the shared <DataTable>.
 *
 * Per-column filtering (2026-06-19): Surgeon is faceted `select`; the spend
 * columns + Compliance % are `range` (number accessor + formatted cell). The
 * "supplies on/total" column is text-only (no filter). Built-in DataTable
 * sorting replaces the old `useTableSort`/`SortableHead`; data arrives
 * pre-sorted by compliance ascending so the worst cases surface first.
 */

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import type { CaseComplianceWithNumber } from "@/lib/actions/case-costing/compliance"

export const complianceColumns: ColumnDef<CaseComplianceWithNumber>[] = [
  {
    accessorKey: "caseNumber",
    header: "Case",
    meta: { filterVariant: "text", filterLabel: "Case" },
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.caseNumber}</span>
    ),
  },
  {
    accessorKey: "surgeonName",
    header: "Surgeon",
    meta: { filterVariant: "select", filterLabel: "Surgeon" },
    cell: ({ row }) =>
      row.original.surgeonName ?? (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "totalSupplySpend",
    header: "Total supply spend",
    accessorFn: (row) => row.totalSupplySpend,
    meta: { filterVariant: "range", filterLabel: "Total supply spend" },
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {formatCurrency(row.original.totalSupplySpend)}
      </span>
    ),
  },
  {
    accessorKey: "onContractSpend",
    header: "On contract",
    accessorFn: (row) => row.onContractSpend,
    meta: { filterVariant: "range", filterLabel: "On contract" },
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {formatCurrency(row.original.onContractSpend)}
      </span>
    ),
  },
  {
    accessorKey: "offContractSpend",
    header: "Off contract",
    accessorFn: (row) => row.offContractSpend,
    meta: { filterVariant: "range", filterLabel: "Off contract" },
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {formatCurrency(row.original.offContractSpend)}
      </span>
    ),
  },
  {
    id: "supplies",
    header: "Supplies",
    meta: { filterVariant: "none" },
    cell: ({ row }) => (
      <span className="text-right tabular-nums text-muted-foreground">
        {row.original.suppliesOnContract}/{row.original.suppliesTotal}
      </span>
    ),
  },
  {
    accessorKey: "compliancePercent",
    header: "Compliance",
    accessorFn: (row) => row.compliancePercent,
    meta: { filterVariant: "range", filterLabel: "Compliance %" },
    cell: ({ row }) => {
      const pct = row.original.compliancePercent
      return (
        <Badge
          variant={
            pct >= 80 ? "default" : pct >= 50 ? "secondary" : "destructive"
          }
        >
          {formatPercent(pct, 0)}
        </Badge>
      )
    },
  },
]
