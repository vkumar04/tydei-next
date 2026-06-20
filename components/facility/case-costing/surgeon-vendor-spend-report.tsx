"use client"

/**
 * Surgeon × Vendor Spend report (Charles 2026-06-18). Per surgeon, how much
 * they spend with each vendor (from case supplies), with a contract-compliance
 * split. Migrated to the shared <DataTable> with per-column filtering
 * (2026-06-19) so it filters like every other case-costing list. Fed by
 * `getSurgeonVendorSpend` via `useSurgeonVendorSpend`.
 */

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/shared/tables/data-table"
import { formatCurrency } from "@/lib/formatting"
import type { SurgeonVendorSpendRow } from "@/lib/actions/case-costing/surgeon-vendor-spend"

interface SurgeonVendorSpendReportProps {
  rows: SurgeonVendorSpendRow[] | undefined
  isLoading: boolean
}

const surgeonVendorSpendColumns: ColumnDef<SurgeonVendorSpendRow>[] = [
  {
    accessorKey: "surgeonName",
    header: "Surgeon",
    meta: { filterVariant: "select", filterLabel: "Surgeon" },
    cell: ({ row }) => (
      <span className="font-medium">{row.original.surgeonName}</span>
    ),
  },
  {
    accessorKey: "vendorName",
    header: "Vendor",
    meta: { filterVariant: "select", filterLabel: "Vendor" },
    cell: ({ row }) => row.original.vendorName,
  },
  {
    accessorKey: "totalSpend",
    header: "Total spend",
    accessorFn: (row) => row.totalSpend,
    meta: { filterVariant: "range", filterLabel: "Total spend" },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatCurrency(row.original.totalSpend)}
      </span>
    ),
  },
  {
    accessorKey: "onContractSpend",
    header: "On contract",
    accessorFn: (row) => row.onContractSpend,
    meta: { filterVariant: "range", filterLabel: "On contract" },
    cell: ({ row }) => (
      <span className="tabular-nums">
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
      <span className="tabular-nums text-amber-600 dark:text-amber-400">
        {formatCurrency(row.original.offContractSpend)}
      </span>
    ),
  },
  {
    accessorKey: "supplyCount",
    header: "Supplies",
    accessorFn: (row) => row.supplyCount,
    meta: { filterVariant: "range", filterLabel: "Supplies" },
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {row.original.supplyCount}
      </span>
    ),
  },
  {
    accessorKey: "compliancePercent",
    header: "Compliance",
    accessorFn: (row) => row.compliancePercent,
    meta: { filterVariant: "range", filterLabel: "Compliance" },
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.compliancePercent >= 80
            ? "default"
            : row.original.compliancePercent >= 50
              ? "secondary"
              : "destructive"
        }
      >
        {Math.round(row.original.compliancePercent)}%
      </Badge>
    ),
  },
]

export function SurgeonVendorSpendReport({
  rows,
  isLoading,
}: SurgeonVendorSpendReportProps) {
  const data = useMemo(() => rows ?? [], [rows])

  if (isLoading) {
    return <Skeleton className="h-[320px] w-full" />
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No surgeon-vendor spend data available for this window. Import case
        supplies and run enrichment to populate it.
      </p>
    )
  }

  const totalSpend = rows.reduce((s, r) => s + r.totalSpend, 0)
  const onContract = rows.reduce((s, r) => s + r.onContractSpend, 0)
  const overallCompliance = totalSpend > 0 ? (onContract / totalSpend) * 100 : 0

  return (
    <div className="space-y-3">
      <DataTable
        columns={surgeonVendorSpendColumns}
        data={data}
        enableColumnFilters
        searchKey="surgeonName"
        searchPlaceholder="Filter by surgeon…"
        getRowId={(row) => `${row.surgeonName} ${row.vendorName}`}
        pagination
      />

      <div className="flex items-center gap-4 rounded-lg bg-muted/50 p-4">
        <div>
          <p className="text-sm font-medium">Total supply spend</p>
          <p className="text-2xl font-bold tabular-nums">
            {formatCurrency(totalSpend)}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-sm text-muted-foreground">
            {rows.length} surgeon-vendor pairs
          </p>
          <p className="text-sm text-muted-foreground">
            Overall compliance: {Math.round(overallCompliance)}%
          </p>
        </div>
      </div>
    </div>
  )
}
