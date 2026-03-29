"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/shared/tables/data-table"
import { Badge } from "@/components/ui/badge"
import type { ItemComparison } from "@/lib/actions/prospective"

const columns: ColumnDef<ItemComparison>[] = [
  { accessorKey: "vendorItemNo", header: "Item #" },
  { accessorKey: "description", header: "Description" },
  {
    accessorKey: "currentPrice",
    header: "Current Price",
    cell: ({ row }) => `$${row.original.currentPrice.toFixed(2)}`,
  },
  {
    accessorKey: "proposedPrice",
    header: "Proposed Price",
    cell: ({ row }) => `$${row.original.proposedPrice.toFixed(2)}`,
  },
  {
    accessorKey: "savings",
    header: "Savings",
    cell: ({ row }) => {
      const val = row.original.savings
      return (
        <span className={val >= 0 ? "text-emerald-600" : "text-red-600"}>
          ${Math.abs(val).toFixed(2)} {val < 0 ? "loss" : ""}
        </span>
      )
    },
  },
  {
    accessorKey: "savingsPercent",
    header: "% Change",
    cell: ({ row }) => {
      const val = row.original.savingsPercent
      return (
        <Badge variant={val >= 0 ? "default" : "destructive"}>
          {val >= 0 ? "-" : "+"}
          {Math.abs(val).toFixed(1)}%
        </Badge>
      )
    },
  },
]

interface ProposalComparisonTableProps {
  comparisons: ItemComparison[]
}

export function ProposalComparisonTable({ comparisons }: ProposalComparisonTableProps) {
  return (
    <DataTable
      columns={columns}
      data={comparisons}
      searchKey="vendorItemNo"
      searchPlaceholder="Search items..."
    />
  )
}
